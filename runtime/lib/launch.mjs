// Bounded launch engine for the interactive task control room (spec 014).
//
// Ownership: this is the ONLY module that starts provider processes. Both the
// CLI and the TUI call it only after an explicit confirmation boundary.
// Every session still runs through worker.mjs's provider-neutral invocation
// and stops at the ATL state gates — the runner never infers permission from
// an LLM response, and state advances only from observed ATL commands.

import fs from "node:fs";
import path from "node:path";
import { paths, loadState, saveState, logEvent, transition } from "./state.mjs";
import { ensureWorkspace } from "./workspace.mjs";
import { buildInvocation, isTerminal, nextRole, queueSelect, runInvocation, workerEnvPolicy, abortActiveWorker } from "./worker.mjs";
import { post as feedPost } from "./feed.mjs";
import { discoverProvider, providerForRole, providerProfile, providerSpec } from "./providers.mjs";
import { credentialContext, validateProviderEntry } from "./userProviders.mjs";
import { loadQueue, QueueError } from "./queue.mjs";
import { pendingFeedback, markFeedback } from "./feedback.mjs";
import { autoRecoverBlockedTask, requiresHumanAction } from "./recovery.mjs";
import { recordUsage, checkUsageThresholds } from "./usage.mjs";
import { assembleContext, buildMap, renderNavigationContext } from "./navigation.mjs";
import { buildContextPack } from "./brain.mjs";
import { probeUiReviewRuntime, uiReviewPrompt } from "./ui-review-runtime.mjs";
import { createWorkerCredential } from "./session-auth.mjs";
import { acquireLease, heartbeatLease, releaseLease } from "./leases.mjs";
import { recordHandoff, readHandoff, deliveryGate, startBaseline, createDeliveryBranch, inspectHandoffChain } from "./handoffs.mjs";
import { dispatchPreflight } from "./dispatch-preflight.mjs";
import { recordBlocker, repairBlocker, validateContracts, selectedContracts } from "./queue-recovery.mjs";
import { recordIntegratedDelivery } from "./delivery.mjs";

const say = (root, from, text, opts = {}) => feedPost(root, { from, text, ...opts });

// Operator abort (control room): stop the current session and the queue run
// without recording a failure. The flag is checked between role sessions and
// right after a killed worker exits, so the interrupted task keeps its gate
// status instead of being containment-blocked for a kill it did not cause.
let runAbortRequested = false;
let sessionInterruptRequested = false;

export function requestRunAbort() {
  runAbortRequested = true;
  abortActiveWorker();
}

export function requestSessionInterrupt() {
  sessionInterruptRequested = true;
  return abortActiveWorker();
}

export function readManagerConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(paths(root).config, "utf8"));
  } catch {
    return {};
  }
}

// Containment block: when a manager-confirmed run stalls or cannot start,
// the blocker must actually land (brief acceptance D). The state contract
// gives no actor to an autonomous runner, so the block is recorded under the
// confirming human's authority with an explicit runner-containment reason.
// (This also makes `overnight --all`'s documented "block stalled tasks and
// move on" real — its old actor:"runner" transition was always rejected.)
export function containmentBlock(state, taskId, reason) {
  const task = state.tasks[taskId];
  if (!task || isTerminal(task.status)) return false;
  if (task.status === "blocked") {
    task.blocker = { ...(task.blocker || {}), reason, since: new Date().toISOString(), actor: "manager" };
    task.updated_at = new Date().toISOString();
    logEvent(state, { task: taskId, actor: "manager", event: "containment", detail: reason });
    return true;
  }
  task.blocker = { ...(task.blocker || {}), reason, since: new Date().toISOString(), actor: "manager" };
  try {
    transition(state, taskId, "blocked", {
      actor: "manager",
      note: `runner containment (manager-confirmed run): ${reason}`,
    });
    return true;
  } catch {
    // Illegal from this status (e.g. escalated) — leave the gate state intact.
    return false;
  }
}

function maxAutoRecoveries(root) {
  const configured = readManagerConfig(root).budgets?.max_auto_recoveries;
  return Number.isFinite(Number(configured)) ? Math.min(2, Math.max(0, Number(configured))) : 2;
}

async function prepareRecovery(root, taskId, outcome) {
  if (!(outcome.failed || outcome.stalled || outcome.status === "blocked")) return;
  const state = loadState(root); const task = state.tasks[taskId];
  if (!task) return;
  const failure = outcome.preflight || { cause: outcome.blocker || "execution", reason: outcome.reason || task.blocker?.reason || "worker stopped" };
  if (requiresHumanAction(failure.reason)) failure.recovery_owner = "owner";
  if (failure.cause === "provider-quota" || failure.cause === "browser_probe_failed" || /provider usage limit|provider quota (?:exhausted|reached)/i.test(failure.reason)) failure.recovery_owner = "owner";
  const record = recordBlocker(task, failure);
  saveState(root, state);
  if (record.recovery_owner === "owner" || record.status === "exhausted" || maxAutoRecoveries(root) === 0) return;
  const recipes = [
    { action: "prepare-verified-inputs", permitted: ["handoff", "missing-artifact", "workspace", "execution"].includes(record.cause), provision: false },
    { action: "provision-locked-local-dependencies", permitted: readManagerConfig(root).workspaces?.provisionLocal === true, provision: true },
  ];
  for (const recipe of recipes) {
    if (!recipe.permitted || record.attempts.some((attempt) => attempt.action === recipe.action && attempt.status !== "repairing")) continue;
    const current = loadState(root).tasks[taskId].recovery;
    const latestCause = [...current.attempts].reverse().find((attempt) => attempt.preflight?.cause)?.preflight.cause || current.cause;
    if (recipe.provision && !["local-dependencies", "local-dependencies-unavailable"].includes(latestCause)) continue;
    const result = await repairBlocker(root, taskId, {
      action: recipe.action,
      maxAttempts: maxAutoRecoveries(root),
      remedy: () => {
        if (!recipe.provision) {
          const latest = loadState(root);
          const predecessors = selectedContracts(latest.tasks, latest.tasks[taskId].plan_depends_on || []);
          for (const predecessor of Object.values(predecessors)) {
            if (predecessor.status !== "done" || !predecessor.handoff_baseline) continue;
            try { readHandoff(root, predecessor); } catch { recordHandoff(root, predecessor); }
          }
          saveState(root, latest);
        }
        return { remedy: recipe.action, network: false };
      },
      preflight: (candidate, tasks) => dispatchPreflight(root, candidate, tasks, { provisionLocal: recipe.provision }),
    });
    if (result.recovered) break;
  }
}

export async function recoverPreparedTasks(root, taskIds = null, { lockHeld = false } = {}) {
  const recoveryRunId = lockHeld ? null : beginQueueRun(root, "supervisor-recovery");
  try {
  const state = loadState(root);
  const ids = taskIds || Object.keys(state.tasks);
  for (const id of ids) {
    const task = loadState(root).tasks[id];
    if (task?.status !== "blocked" || !task.recovery || task.recovery.recovery_owner === "owner" || task.recovery.status === "exhausted") continue;
    const interrupted = task.recovery.attempts.find((attempt) => attempt.status === "repairing");
    if (interrupted) {
      await repairBlocker(root, id, {
        action: interrupted.action,
        remedy: () => { throw new Error("interrupted remedy must not repeat"); },
        preflight: (candidate, tasks) => interrupted.action === "pip-contract-repair" && !candidate.pip_repair ? { ready: false, reason: "interrupted Pip session produced no permitted repair" } : dispatchPreflight(root, candidate, tasks, { provisionLocal: readManagerConfig(root).workspaces?.provisionLocal === true, allowIntegration: true }),
      });
    }
    const current = loadState(root).tasks[id];
    if (current.recovery.status !== "resolved") await prepareRecovery(root, id, { status: "blocked", reason: current.recovery.reason, preflight: current.recovery });
  }
  return recoverDueBlockedTasks(root, { taskIds: ids });
  } finally { if (recoveryRunId) endQueueRun(root, recoveryRunId); }
}

function queueCompletion(root, tasks, { deliver = true } = {}) {
  const integrationTask = tasks.find((task) => task.integrated_delivery);
  let delivery = integrationTask ? deliveryGate(root, tasks, integrationTask) : { version: 1, ready: false, reason: "integrated delivery stage and browser journey required" };
  if (deliver && delivery.ready && tasks.every((task) => task.status === "done")) {
    delivery = createDeliveryBranch(root, tasks, integrationTask);
    delivery.packet_id = recordIntegratedDelivery(root, integrationTask.id, delivery).id;
  }
  const status = tasks.some((task) => task.recovery?.status === "exhausted" || (task.execution_budget && task.execution_budget.used >= task.execution_budget.max_sessions && task.status !== "done")) ? "exhausted"
    : tasks.some((task) => task.recovery?.recovery_owner === "owner" && task.recovery?.status !== "resolved") ? "owner-blocked"
    : tasks.length && tasks.every((task) => task.status === "done") && delivery.ready ? "completed" : "waiting";
  const stopped = tasks.find((task) => status === "owner-blocked" ? task.recovery?.recovery_owner === "owner" && task.recovery.status !== "resolved" : status === "exhausted" ? task.recovery?.status === "exhausted" || (task.execution_budget && task.execution_budget.used >= task.execution_budget.max_sessions && task.status !== "done") : task.status !== "done");
  const reason = stopped?.recovery?.escalation || stopped?.waiting_reason || stopped?.blocker?.reason || (status === "exhausted" ? "persistent execution allowance exhausted" : delivery.reason);
  return { status, delivery, reason };
}

// Plan Studio records a directed task chain. A task with unfinished
// prerequisites is waiting for work, not blocked on the owner. Keep that
// distinction at the scheduler boundary so a high-priority review cannot run
// before the implementation it is meant to inspect.
function unmetDependencies(state, task) {
  return (Array.isArray(task?.plan_depends_on) ? task.plan_depends_on : [])
    .filter((id) => state.tasks[id]?.status !== "done");
}

// Recover only the kind of blocked work that the team can safely retry. This
// is deliberately separate from containmentBlock: recording a failure and
// deciding whether it is retryable are different operations.
export function recoverDueBlockedTasks(root, { taskIds = null, dryRun = false, maxRecoveries = maxAutoRecoveries(root) } = {}) {
  if (dryRun) return [];
  const state = loadState(root);
  const ids = taskIds || Object.keys(state.tasks);
  const recovered = [];
  for (const taskId of ids) {
    const task = state.tasks[taskId];
    if (!task || task.status !== "blocked") continue;
    const result = autoRecoverBlockedTask(root, taskId, {
      maxRecoveries,
      note: "Mira automatically retried a non-human blocker during the bounded queue run",
    });
    if (result.recovered) {
      recovered.push(taskId);
      say(root, "mira", `${taskId} auto-recovered and re-queued after a non-human blocker.`, { task: taskId });
    }
  }
  return recovered;
}

// Apply a worker outcome and, when safe, put the task back through the normal
// assigned -> in_progress gate once. Human-owned capability failures remain
// blocked and are narrated as such instead of being retried pointlessly.
export function recoverAfterOutcome(root, taskId, outcome, { maxRecoveries = maxAutoRecoveries(root) } = {}) {
  if (!(outcome?.status === "blocked" || outcome?.failed || outcome?.stalled)) return { recovered: false, blocked: false };

  let state = loadState(root);
  let task = state.tasks[taskId];
  if (!task) return { recovered: false, blocked: false };
  if ((outcome.failed || outcome.stalled) && task.status !== "blocked") {
    const contained = containmentBlock(state, taskId, outcome.reason);
    if (contained) {
      saveState(root, state);
      task = loadState(root).tasks[taskId];
      say(root, "runner", `${taskId} blocked by the launch queue: ${outcome.reason}.`, { task: taskId });
    }
  }
  task = loadState(root).tasks[taskId];
  if (task?.status !== "blocked") return { recovered: false, blocked: false };

  const result = autoRecoverBlockedTask(root, taskId, {
    maxRecoveries,
    note: "Mira automatically retried a non-human blocker during the bounded queue run",
  });
  if (result.recovered) {
    say(root, "mira", `${taskId} auto-recovered and will re-enter the queue after a non-human blocker.`, { task: taskId });
    return { recovered: true, blocked: true, task: result.task };
  }
  if (result.kind === "human-action" || requiresHumanAction(result.reason || task.blocker?.reason || "")) {
    say(root, "mira", `${taskId} remains blocked: the next action requires owner access or an authority change.`, { task: taskId });
  }
  return { recovered: false, blocked: true, task: loadState(root).tasks[taskId], reason: result.reason, kind: result.kind };
}

// Resolve workspace config the same way the CLI does (relative → absolute).
function workspaceConfig(root, cfg) {
  const wcfg = { ...(cfg.workspaces || {}) };
  if (wcfg.repos) {
    for (const [key, value] of Object.entries(wcfg.repos)) {
      if (value && value.path) wcfg.repos[key] = { path: path.isAbsolute(value.path) ? value.path : path.resolve(root, value.path) };
    }
  }
  return wcfg;
}

// Drive one task through bounded role sessions until a gate, the session
// budget, or the time budget stops it. Moved verbatim from the CLI entry
// (spec 011/013 behavior preserved) with two control-room additions:
//   - `resolveWorker(role)` maps a role to { worker, auth, envPolicy }
//     (per-role provider profiles), defaulting to the fixed CLI flags;
//   - a provider preflight runs before every spawn: a missing executable
//     starts no agent and returns an actionable `blockedLaunch` outcome.
export async function driveTaskUntilGate(root, taskId, budget, {
  overnight, dryRun, worker, auth, envPolicy, resolveWorker, lease = null, onProgress = console.log, onSession = null, pauseAfterSession = false, onReview = null, echo = false, contractRepair = false,
}) {
  const report = typeof onProgress === "function" ? onProgress : console.log;
  const runDir = path.join(root, ".trust", "manager", "overnight", taskId);
  const taskSessions = () => budget.taskSessions?.get(taskId) || 0;
  while (taskSessions() < budget.maxSessions && Date.now() < budget.deadline) {
    if (runAbortRequested) return { status: (loadState(root).tasks[taskId] || {}).status, reason: "run aborted by operator", aborted: true };
    const state = loadState(root);
    const task = state.tasks[taskId];
    if (!task) return { status: "unknown", reason: `unknown task ${taskId}` };
    if (isTerminal(task.status) && !contractRepair) return { status: task.status, reason: task.status === "blocked" ? task.blocker?.reason || "blocked" : `already ${task.status}` };
    task.execution_budget ||= { version: 1, max_sessions: budget.maxSessions, used: 0 };
    task.evidence_contract = 2;
    if (task.execution_budget.used >= task.execution_budget.max_sessions) return { status: task.status, reason: `persistent session budget exhausted (${task.execution_budget.used}/${task.execution_budget.max_sessions}); increase the task budget before resuming`, exhausted: true };
    const role = contractRepair ? "pip" : nextRole(task);
    if (!role) return { status: task.status, reason: `no worker role is defined for status ${task.status}` };

    const evidenceBefore = (task.evidence || []).length;
    const pick = resolveWorker
      ? resolveWorker(role)
      : { worker, auth, envPolicy };
    const useWorker = pick.worker;
    // A user registry provider IS api-key auth: force the api env policy so
    // the claude subscription stripper can never remove injected credentials.
    const useAuth = pick.userProvider ? "api" : (pick.auth ?? "subscription");
    const useProvider = pick.provider || providerSpec({ auth: useAuth, catalog: {} }, useWorker);
    const customUnset = Array.isArray(useProvider.unsetEnv) ? useProvider.unsetEnv : [];
    const customEnvPolicy = customUnset.length
      ? { unset: customUnset, stripped: customUnset.filter((key) => Boolean(process.env[key])) }
      : null;
    const useEnvPolicy = pick.envPolicy ?? customEnvPolicy ?? workerEnvPolicy(useWorker, useAuth);

    // Provider preflight: discovery failure must never spawn anything.
    const disc = discoverProvider(useWorker, { command: useProvider.command });
    if (!disc.available) {
      return { status: task.status, reason: disc.error, failed: true, blockedLaunch: true };
    }

    // User provider preflight: a stored provider must be complete before any
    // agent starts; the actionable error containment-blocks the task.
    let credentialEnv = {};
    if (pick.userProvider) {
      try {
        credentialEnv = credentialContext(pick.userProvider).env;
      } catch (error) {
        return { status: task.status, reason: error.message, failed: true, blockedLaunch: true };
      }
    }

    let workspace = task.workspace || null;
    if (role === "rowan" || (task.plan_depends_on || []).length) {
      const ws = ensureWorkspace(root, workspaceConfig(root, readManagerConfig(root)), task);
      workspace = ws.dir;
      if (task.workspace !== workspace) {
        task.workspace = workspace;
        logEvent(state, { task: task.id, actor: "runner", event: "workspace", detail: `${ws.mode}${ws.from ? ` from ${ws.from}` : ""}${ws.reused ? " (reused)" : ""}` });
        saveState(root, state);
      }
    }

    if (workspace && !dryRun) {
      writeRunMeta(root, { phase: "preparation" });
      task.workspace = workspace;
      const preflightTask = contractRepair ? { ...task, dispatch_contract: { ...task.dispatch_contract, commands: [] } } : task;
      let preflight = dispatchPreflight(root, preflightTask, state.tasks, { provisionLocal: readManagerConfig(root).workspaces?.provisionLocal === true, allowIntegration: role === "rowan" || contractRepair });
      if (!preflight.ready && preflight.cause === "overlapping-edits" && role !== "rowan" && !contractRepair) {
        task.status = "assigned"; task.assigned_worker = "rowan"; task.review_required = true;
        logEvent(state, { task: task.id, actor: "mira", event: "integration-route", detail: preflight.reason });
        saveState(root, state); continue;
      }
      if (preflight.integration && role === "rowan") {
        // Rowan receives every conflicting input inside its sandbox. Integration
        // consumes the same task session budget and must return through review.
        task.integration_inputs.sessions = (task.integration_inputs.sessions || 0) + 1;
        startBaseline(root, task);
        preflight = task.integration_inputs.sessions <= 2 ? preflight : { ready: false, cause: "integration-exhausted", reason: "Rowan integration session budget exhausted" };
      }
      if (!preflight.ready) {
        recordBlocker(task, preflight); saveState(root, state);
        return { status: task.status, reason: preflight.reason, failed: true, blockedLaunch: true, preflight };
      }
      saveState(root, state);
    }

    let uiReviewRuntime = null;
    const isUiReview = role === "sage" && JSON.stringify(task).toLowerCase().includes("ui-review");
    if (isUiReview) {
      const probe = probeUiReviewRuntime(root, workspace || root);
      if (!probe.available) {
        return { status: task.status, reason: probe.reason, failed: true, blockedLaunch: true, blocker: "browser_probe_failed", resumable: true, nextRole: role };
      }
      uiReviewRuntime = { ...probe, prompt: uiReviewPrompt(probe) };
      logEvent(state, { task: task.id, actor: "runner", event: "browser_probe", detail: `available; browser=${probe.browserExecutable}; evidence=${probe.evidenceDir}` });
      saveState(root, state);
    }

    const feedback = pendingFeedback(root, { taskId, role });
    const navigation = readManagerConfig(root).navigation || {};
    let navigationContext = "";
    if (navigation.mode === "on") {
      const mapRoot = workspace || root;
      // Rebuild against the current worktree before composing context. This
      // keeps dirty edits from silently reusing stale locations; incremental
      // parsing can replace this conservative P1 behavior later.
      if (navigation.build_on_launch !== false) buildMap(mapRoot);
      navigationContext = renderNavigationContext(assembleContext(mapRoot, { taskId, query: `${task.title} ${task.objective || ""}`, maxTokens: Number(navigation.max_tokens) || 800, constraints: task.completion_checks || [] }));
    }
    const plan_context = task.plan_draft_id ? Object.values(loadState(root).tasks)
      .filter((peer) => peer.id !== task.id && peer.plan_draft_id === task.plan_draft_id)
      .map((peer) => ({ id: peer.id, objective: peer.objective, completion_checks: peer.completion_checks, depends_on: peer.plan_depends_on || [], status: peer.status })) : [];
    const invocation = buildInvocation(useWorker, { root, workspace, role, task: { ...task, plan_context }, auth: useAuth, provider: useProvider, feedback, navigationContext, uiReviewRuntime });
    invocation.command = disc.path;
    budget.sessions += 1;
    if (budget.taskSessions) budget.taskSessions.set(taskId, taskSessions() + 1);
    const logPath = path.join(runDir, `session-${String(budget.sessions).padStart(2, "0")}-${role}-${Date.now()}.log`);
    const remainingMs = Math.max(1000, budget.deadline - Date.now());
    const timeoutMs = remainingMs;
    report(`[${taskId}] session ${budget.sessions}/${budget.maxSessions} · ${role} · ${useWorker} · ${useProvider.model || "provider default"}`);
    report(`  workspace: ${invocation.cwd}`);
    report(`  transcript: ${logPath}`);
    logEvent(state, { task: task.id, actor: "runner", event: "worker_start", detail: `${useWorker}/${role}; log=${logPath}` });
    say(root, "runner", `starting bounded ${useWorker} session as ${role} for ${taskId}.`, { task: taskId, detail: logPath });
    if (dryRun) {
      report("  phase: preview only — no agent started");
      report("  prompt: role contract + task packet ready (full text is intentionally hidden)");
      return { status: task.status, reason: "dry-run preview" };
    }
    task.execution_budget.used += 1;
    writeRunMeta(root, { phase: "provider-session" });
    // Persist worker_start before the session runs — otherwise the event is
    // logged into a state object that the post-session reload discards, and
    // the history only ever shows worker_exit.
    saveState(root, state);

    let result;
    try {
      const workerCredential = createWorkerCredential({ project: path.resolve(root), task: taskId, role, run: budget.runId || "local", generation: lease?.generation || task.attempt_count || 0, leaseId: lease?.id || null, leaseKey: lease?.key || null });
      result = await runInvocation(invocation, {
        // Workers get the task workspace and a scoped, expiring identity. The
        // manager root is deliberately not added to their tool sandbox.
        env: { ATL_PROJECT: root, ATL_WORKER_CREDENTIAL: JSON.stringify(workerCredential), ...(useEnvPolicy.set || {}), ...credentialEnv },
        unsetEnv: useEnvPolicy.unset,
        logPath,
        timeoutMs,
        stdinText: invocation.prompt,
        echo,
      });
      for (const item of feedback) markFeedback(root, item.id, "applied", `session ${budget.sessions} started for ${role}`);
    } catch (error) {
      for (const item of feedback) markFeedback(root, item.id, "pending", `provider start failed: ${error.message}`);
      throw error;
    }
    const after = loadState(root);
    writeRunMeta(root, { phase: "handoff" });
    const nextTask = after.tasks[taskId];
    if (role === "rowan" && nextTask?.integration_inputs?.status === "required" && ["in_review", "verifying", "done"].includes(nextTask.status)) {
      nextTask.integration_inputs.status = "composed";
      nextTask.review_required = true;
    }
    if (nextTask?.status === "done" && nextTask.handoff_baseline) {
      try { recordHandoff(root, nextTask); }
      catch (error) {
        // A worker's completion claim cannot publish an unverifiable handoff.
        nextTask.status = "blocked";
        nextTask.blocker = { reason: error.message, actor: "mira", since: new Date().toISOString() };
        recordBlocker(nextTask, { cause: "handoff-verification", reason: error.message });
      }
    }
    logEvent(after, { task: taskId, actor: "runner", event: "worker_exit", detail: `${useWorker}/${role}; code=${result.code}; timed_out=${result.timedOut}; log=${logPath}` });
    say(root, "runner", `${role} session ended for ${taskId}: code=${result.code}${result.timedOut ? ", timed out" : ""}.`, { task: taskId, detail: logPath });
    saveState(root, after);
    const summary = {
      taskId, role, worker: useWorker, model: useProvider.model || null,
      session: budget.sessions, logPath, startedAt: result.startedAt, finishedAt: result.finishedAt,
      exitCode: result.code, timedOut: result.timedOut, signal: result.signal || null,
      permissionMismatch: result.permissionMismatch || null,
      providerFailure: result.providerFailure || null,
      statusBefore: task.status, statusAfter: nextTask?.status || task.status,
      checkpoint: nextTask?.last_checkpoint || null,
      evidence: nextTask?.evidence?.slice(evidenceBefore) || [],
      feedback: feedback.map((item) => item.id),
    };
    recordUsage(root, {
      provider: useWorker,
      model: useProvider.model || null,
      source: "atl-session",
      status: "observed",
      confidence: "high",
      used: { sessions: 1, elapsed_ms: Math.max(0, new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime()) },
      remaining: null,
      detail: "local session observed; remote provider quota is not exposed by this adapter",
    });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath.replace(/\.log$/i, ".json"), JSON.stringify(summary, null, 2) + "\n");
    report(`[${taskId}] ${role} session finished · exit ${result.code}${result.timedOut ? " · timed out" : ""}`);
    if (typeof onSession === "function") await onSession(summary);
    if (contractRepair) return { status: nextTask?.status, contractRepaired: Boolean(nextTask?.pip_repair), reason: nextTask?.pip_repair ? "Pip repaired the contract" : "Pip did not produce a permitted contract repair" };
    if (sessionInterruptRequested) {
      sessionInterruptRequested = false;
      return { status: nextTask?.status || task.status, reason: "session interrupted for pending human feedback", interrupted: true };
    }
    if (pauseAfterSession && typeof onReview === "function") {
      const decision = await onReview(summary);
      if (decision === "stop") return { status: nextTask?.status || task.status, reason: "paused after bot by operator", paused: true };
    }

    // An operator-killed session is not a worker failure: keep the task at
    // its gate and let the queue unwind without containment blocks.
    if (runAbortRequested) {
      return { status: nextTask?.status || task.status, reason: "run aborted by operator", aborted: true };
    }
    if (result.permissionMismatch) {
      return { status: nextTask?.status || task.status, reason: result.permissionMismatch, failed: true, blockedLaunch: true, blocker: "runtime_permission_mismatch" };
    }
    if (result.providerFailure && result.code !== 0) {
      return { status: nextTask?.status || task.status, reason: result.providerFailure.reason, failed: true, blockedLaunch: true, blocker: result.providerFailure.kind };
    }
    if (result.timedOut || result.code !== 0) {
      return { status: nextTask?.status || task.status, reason: `worker ended unsuccessfully (code ${result.code}${result.timedOut ? ", timeout" : ""})`, failed: true };
    }
    if (!nextTask || nextTask.status === task.status) {
      return { status: task.status, reason: `worker did not advance ${taskId} from ${task.status}; inspect the log and feed`, stalled: true };
    }
    if (!overnight) return { status: nextTask.status, reason: "one-shot session complete" };
  }
  const finalTask = loadState(root).tasks[taskId];
  if (taskSessions() >= budget.maxSessions) return { status: finalTask?.status, reason: `task session budget reached; next role: ${finalTask ? nextRole(finalTask) || "human gate" : "unknown"}`, exhausted: true, resumable: false, nextRole: finalTask ? nextRole(finalTask) : null };
  return { status: finalTask?.status, reason: "overall time budget reached; task can resume", resumable: true, nextRole: finalTask ? nextRole(finalTask) : null };
}

// ---------- launch plan (the preview contract)

function commandPreview(invocation) {
  const line = [invocation.command, ...invocation.args.map((a) => (/[\s"&|<>]/.test(a) ? `"${a}"` : a))].join(" ");
  return `${line}   (role prompt on stdin)`;
}

const CONTAINMENT_RULES = [
  "sandbox: workspace-write, task workspace only",
  "no merge, push, deploy, spend, policy, or external messages",
  "state advances only via observed atl commands/evidence",
];

// Build the full preview for a set of queued task ids. Pure: starts nothing.
// `discover` is injectable so verification can prove the blocked-launch
// contract (acceptance D) without depending on the host's installed CLIs.
export function buildLaunchPlan(root, { taskIds, maxMinutes = 120, maxSessions = 8, providerDefaults = {}, discover = discoverProvider, preserveOrder = false } = {}) {
  const state = loadState(root);
  const profile = providerProfile(readManagerConfig(root));
  if (providerDefaults.worker) profile.defaultWorker = String(providerDefaults.worker).toLowerCase();
  if (providerDefaults.auth) profile.authOverride = String(providerDefaults.auth).toLowerCase();
  if (providerDefaults.model) profile.modelOverride = String(providerDefaults.model);
  const byId = new Map(Object.values(state.tasks).map((t) => [t.id, t]));
  const present = (taskIds || []).map((id) => byId.get(id)).filter(Boolean);
  // Priority ordering is the default; round-robin multi-queue runs preserve
  // their interleaved queue order instead.
  const ordered = queueSelect(present, { preserveOrder });
  const items = [];
  for (const task of ordered) {
    const role = nextRole(task);
    const provider = providerForRole(profile, role);
    const spec = role ? providerSpec(profile, provider.worker) : null;
    const resolvedProvider = spec ? { ...provider, command: spec.command, model: provider.model || spec.model } : provider;
    const resolvedSpec = spec ? { ...spec, model: resolvedProvider.model } : spec;
    const disc = role ? discover(provider.worker, { command: spec.command }) : null;
    const blockers = [];
    if (task.execution_budget && task.execution_budget.used >= task.execution_budget.max_sessions) blockers.push(`persistent session budget exhausted (${task.execution_budget.used}/${task.execution_budget.max_sessions}); increase the task budget before resuming`);
    if ((task.plan_depends_on || []).length) {
      const handoffs = inspectHandoffChain(root, task, state.tasks);
      for (const item of handoffs.items) if (item.handoff !== "verified" && item.status === "done") blockers.push(item.reason);
    }
    const unmet = unmetDependencies(state, task);
    if (unmet.length) blockers.push(`waiting for prerequisite${unmet.length === 1 ? "" : "s"}: ${unmet.join(", ")}`);
    if (!role) blockers.push(`no worker role is defined for status ${task.status}`);
    if (disc && !disc.available) blockers.push(disc.error);
    if (provider.userProvider) blockers.push(...validateProviderEntry(provider.userProvider));
    let invocation = null;
    if (role && disc?.available) {
      try {
        const brainContext = buildContextPack(root, { query: `${task.title} ${task.objective || ""}`, subjects: task.brain_subjects || [], maxClaims: 12 });
        invocation = buildInvocation(provider.worker, {
            root, workspace: task.workspace || root, role, task: { ...task, brain_context: brainContext }, auth: provider.auth, provider: resolvedSpec,
        });
      } catch (error) {
        blockers.push(error.message);
      }
    }
    items.push({
      taskId: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority || "normal",
      role,
      provider: resolvedProvider,
      workspace: task.workspace || null,
      workspaceNote: role === "rowan" && !task.workspace ? "isolated workspace is created on start" : null,
      command: invocation ? commandPreview(invocation) : null,
      sessionLogs: `.trust/manager/overnight/${task.id}/session-NN-${role || "-"}.log`,
      containment: CONTAINMENT_RULES,
      brainContext: invocation ? buildContextPack(root, { query: `${task.title} ${task.objective || ""}`, subjects: task.brain_subjects || [], maxClaims: 12 }) : null,
      blockers,
    });
  }
  return {
    root,
    createdAt: new Date().toISOString(),
    budget: { maxMinutes, maxSessions },
    profile,
    order: items.map((i) => i.taskId),
    items,
    readyCount: items.filter((i) => i.blockers.length === 0).length,
    blockedCount: items.filter((i) => i.blockers.length > 0).length,
    confirmCommand: `atl launch --confirm${providerDefaults.worker ? ` --worker ${providerDefaults.worker}` : ""}${providerDefaults.model ? ` --model ${providerDefaults.model}` : ""}${providerDefaults.auth ? ` --auth ${providerDefaults.auth}` : ""}${maxMinutes !== 120 ? ` --max-minutes ${maxMinutes}` : ""}${maxSessions !== 8 ? ` --max-sessions ${maxSessions}` : ""}`,
  };
}

// ---------- global run gate (named queues, spec 017)
//
// The default global concurrency is ONE active queue run across all queues:
// it prevents accidental token/spend amplification while multi-queue support
// lands. The gate is a lease file (run id + pid + heartbeat timestamp) plus
// the in-process invariant that a synchronous runner cannot nest inside
// itself. A stale lease (dead pid) never blocks the next run.

function runLockPath(root) {
  return path.join(root, ".trust", "manager", "run-lock.json");
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function readRunLock(root) {
  try { return JSON.parse(fs.readFileSync(runLockPath(root), "utf8")); } catch { return null; }
}

export function globalMaxConcurrent(root) {
  const configured = readManagerConfig(root).run?.maxConcurrent;
  return Number.isFinite(Number(configured)) && Number(configured) >= 1 ? Math.floor(Number(configured)) : 1;
}

export function beginQueueRun(root, queueId = null) {
  const lock = readRunLock(root);
  const limit = globalMaxConcurrent(root);
  if (lock && pidAlive(lock.pid)) {
    throw new QueueError(
      lock.pid === process.pid
        ? `a queue run is already active in this process (${lock.queueId || "unknown queue"}); stop it before launching another`
        : `another queue run is active (${lock.queueId || "unknown queue"}, started ${lock.startedAt}); global concurrency is ${limit} — stop it or raise run.maxConcurrent explicitly`,
    );
  }
  const runId = `R-${Date.now()}`;
  const file = runLockPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ runId, queueId: queueId || "default", pid: process.pid, startedAt: new Date().toISOString() }, null, 2) + "\n");
  return runId;
}

export function endQueueRun(root, runId) {
  const lock = readRunLock(root);
  if (lock && lock.runId === runId) {
    try { fs.rmSync(runLockPath(root), { force: true }); } catch { /* a stuck lease file is removable by hand; it never blocks a live run forever */ }
  }
  return readRunLock(root) === null;
}

function writeRunMeta(root, payload) {
  try {
    const runDir = path.join(root, ".trust", "manager", "overnight");
    fs.mkdirSync(runDir, { recursive: true });
    const file = path.join(runDir, "run.json");
    const previous = (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } })();
    const next = { ...previous, ...payload, updatedAt: new Date().toISOString() };
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
    fs.renameSync(tmp, file);
    return next;
  } catch { /* run metadata is helpful but never a launch gate */ }
}

// `run-lock.json` answers "may another runner start?".  This durable ledger
// answers "what, if anything, is safe to recover after the runner died?".
// It deliberately records only completed boundaries as resumable.  A task
// that was in a provider session when the process disappeared is never
// replayed automatically because the provider may have changed its workspace.
export function readOvernightRun(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "overnight", "run.json"), "utf8")); } catch { return null; }
}

export function reconcileOvernightRun(root) {
  const run = readOvernightRun(root);
  if (!run) return { state: "none", run: null, resumableTaskIds: [] };
  if (run.status !== "running") return { state: run.status || "unknown", run, resumableTaskIds: run.resumableTaskIds || [] };
  if (run.runnerPid && pidAlive(run.runnerPid)) return { state: "active", run, resumableTaskIds: [] };
  const completed = Math.max(0, Number(run.cursor) || 0);
  const order = Array.isArray(run.taskOrder) ? run.taskOrder : [];
  // Exclude the in-flight task. Its outcome is unknown, so it is surfaced for
  // a manager rather than included in a later confirmed recovery run.
  const safePhase = ["preparation", "handoff", "recovery"].includes(run.phase);
  const remaining = Array.isArray(run.pendingTaskIds) ? run.pendingTaskIds : order.slice(completed + (run.currentTaskId ? 1 : 0));
  const resumableTaskIds = [...new Set([...(safePhase && run.currentTaskId ? [run.currentTaskId] : []), ...remaining, ...(run.resumableTaskIds || [])])].filter((id) => safePhase || id !== run.currentTaskId);
  const interruptedTaskId = safePhase ? null : run.currentTaskId || null;
  const next = writeRunMeta(root, {
    status: "interrupted",
    interruptedAt: new Date().toISOString(),
    interruptedTaskId,
    currentTaskId: null,
    resumableTaskIds,
    recovery: interruptedTaskId
      ? `provider session for ${interruptedTaskId} was interrupted; inspect it before retrying`
      : "runner ended between safe task boundaries",
  });
  return { state: "interrupted", run: next, interruptedTaskId, resumableTaskIds };
}

// Pure multi-queue preview: what would launch from a named queue right now.
// Starts nothing, mutates nothing, and reports the run gate honestly.
export function queueDryRun(root, { queueId = null, maxMinutes = 120, maxSessions = 8, providerDefaults = {} } = {}) {
  const queue = loadQueue(root, queueId);
  const lock = readRunLock(root);
  const plan = buildLaunchPlan(root, { taskIds: queue.items.map((item) => item.id), maxMinutes, maxSessions, providerDefaults });
  return {
    ...plan,
    queueId: queue.queue_id,
    queueName: queue.name,
    queueStatus: queue.status,
    paused: queue.status === "paused",
    policy: queue.policy,
    globalMaxConcurrent: globalMaxConcurrent(root),
    runGate: lock && pidAlive(lock.pid) ? { active: true, runId: lock.runId, queueId: lock.queueId } : { active: false },
  };
}

// ---------- multi-queue overnight runs (one shared budget, round-robin)
//
// Several queues run as ONE confirmed run: strictly sequential, global
// concurrency 1, one shared session/minute budget, items interleaved
// round-robin so every selected workstream advances. A paused, archived, or
// unknown queue is skipped for that run while the remaining queues continue.

export function mergeQueues(root, queueIds) {
  const ids = [...new Set((Array.isArray(queueIds) ? queueIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) throw new Error("multi-queue runs need at least one queue id");
  if (ids.length > 8) throw new Error("at most 8 queues per run — select fewer queues");
  const selected = [];
  const skipped = [];
  for (const id of ids) {
    let queue = null;
    try { queue = loadQueue(root, id); } catch { skipped.push({ id, reason: "unknown queue — skipped for this run" }); continue; }
    if (queue.status === "paused") { skipped.push({ id, reason: "paused — skipped for this run" }); continue; }
    if (queue.status === "archived") { skipped.push({ id, reason: "archived — skipped for this run" }); continue; }
    selected.push(queue);
  }
  if (!selected.length) {
    throw new Error(`none of the selected queues can run (${skipped.map((entry) => `${entry.id}: ${entry.reason}`).join("; ") || "no queues selected"})`);
  }
  const depth = Math.max(...selected.map((queue) => queue.items.length));
  const items = [];
  for (let index = 0; index < depth; index += 1) {
    for (const queue of selected) {
      const item = queue.items[index];
      if (item) items.push(item);
    }
  }
  return {
    id: selected.map((queue) => queue.queue_id).join("+").slice(0, 120),
    name: selected.map((queue) => queue.name || queue.queue_id).join(" + "),
    items,
    skipped,
    queues: selected.map((queue) => ({ id: queue.queue_id, name: queue.name || queue.queue_id })),
  };
}

export function multiQueueDryRun(root, { queueIds, maxMinutes = 120, maxSessions = 8, providerDefaults = {} } = {}) {
  const merged = mergeQueues(root, queueIds);
  const lock = readRunLock(root);
  const plan = buildLaunchPlan(root, { taskIds: merged.items.map((item) => item.id), maxMinutes, maxSessions, providerDefaults, preserveOrder: true });
  return {
    ...plan,
    queueId: merged.id,
    queueName: merged.name,
    queueStatus: "active",
    paused: false,
    roundRobin: true,
    skipped: merged.skipped,
    queues: merged.queues,
    globalMaxConcurrent: globalMaxConcurrent(root),
    runGate: lock && pidAlive(lock.pid) ? { active: true, runId: lock.runId, queueId: lock.queueId } : { active: false },
  };
}

// ---------- the confirmed sequential queue run

// Execute a persisted execution queue: strictly sequential (brief
// constraint), one shared budget, per-role providers. A task whose provider
// is missing — or that stalls/fails — is recorded with an actionable reason.
// Mira gets one bounded retry for a non-human blocker; capability and owner
// gates remain blocked and are surfaced to the manager. Ends with a saved brief.
// `taskIds` (browser per-task run) bypasses the queue book and runs exactly
// those tasks under the same budget, gates, and narration.
export async function executeLaunchQueue(root, { maxMinutes = 120, maxSessions = 8, dryRun = false, confirm = false, providerDefaults = {}, onProgress = console.log, onSession = null, pauseAfterSession = false, onReview = null, echo = false, queueId = null, queueIds = null, taskIds = null } = {}) {
  let merged = null;
  const queue = Array.isArray(taskIds) && taskIds.length
    ? { queue_id: null, name: "ad-hoc task run", status: "active", items: taskIds.map((id) => ({ id })) }
    : Array.isArray(queueIds) && queueIds.length
      ? ((merged = mergeQueues(root, queueIds)), { queue_id: merged.id, name: merged.name, status: "active", items: merged.items, round_robin: true })
      : loadQueue(root, queueId);
  if (merged?.skipped?.length) {
    for (const entry of merged.skipped) onProgress(`queue ${entry.id}: ${entry.reason}`);
  }
  if (!dryRun && queue.status === "paused") {
    throw new Error(`queue "${queue.queue_id}" is paused — resume it before launching`);
  }
  const initialState = loadState(root);
  validateContracts(selectedContracts(initialState.tasks, queue.items.map((item) => item.id)));
  const initialPresent = queue.items.map((item) => initialState.tasks[item.id]).filter((t) => t && !isTerminal(t.status));
  if (!initialPresent.length && (dryRun || !confirm)) {
    return { results: [], budget: { sessions: 0, maxSessions, deadline: Date.now() }, reason: "the execution queue is empty (queue tasks with `atl queue add <id>`)" };
  }
  if (!dryRun && !confirm) {
    throw new Error("launch requires --confirm; use --dry-run to preview without starting an agent");
  }
  const runId = dryRun ? null : beginQueueRun(root, queue.queue_id);
  const runStartedAt = Date.now();
  try {
  if (!dryRun) {
    const completedState = loadState(root);
    for (const item of queue.items) {
      const task = completedState.tasks[item.id];
      if (task?.status !== "done" || !task.handoff_baseline) continue;
      try { readHandoff(root, task); }
      catch {
        try { recordHandoff(root, task); }
        catch (error) { task.status = "blocked"; task.blocker = { reason: error.message, actor: "mira" }; recordBlocker(task, { cause: "handoff-verification", reason: error.message }); }
      }
    }
    saveState(root, completedState);
    await recoverPreparedTasks(root, queue.items.map((item) => item.id), { lockHeld: true });
  }
  recoverDueBlockedTasks(root, { taskIds: queue.items.map((item) => item.id), dryRun, maxRecoveries: maxAutoRecoveries(root) });
  const state = loadState(root);
  const present = queue.items.map((item) => state.tasks[item.id]).filter((t) => t && !isTerminal(t.status));
  // Round-robin multi-queue runs keep their interleaved order; single queues
  // stay priority-ordered.
  const ordered = queueSelect(present, { preserveOrder: Boolean(queue.round_robin) });
  if (!ordered.length) {
    if (!dryRun && queue.items.length) {
      const tasks = queue.items.map((item) => loadState(root).tasks[item.id]).filter(Boolean);
      const completion = queueCompletion(root, tasks);
      const results = tasks.map((task) => ({ id: task.id, status: task.status, reason: task.waiting_reason || task.blocker?.reason || completion.delivery.reason || "settled" }));
      writeRunMeta(root, { ...completion, currentTaskId: null, results, endedAt: new Date().toISOString(), reason: completion.reason || completion.status });
      return { ...completion, results, budget: { sessions: 0, maxSessions, deadline: Date.now() }, reason: completion.reason || completion.status };
    }
    return { results: [], budget: { sessions: 0, maxSessions, deadline: Date.now() }, reason: "the execution queue is empty (queue tasks with `atl queue add <id>`)" };
  }
  runAbortRequested = false;
  sessionInterruptRequested = false;
  const budget = { sessions: 0, maxSessions, taskSessions: new Map(), deadline: runStartedAt + maxMinutes * 60 * 1000 };
  writeRunMeta(root, {
    version: 2,
    runId,
    queueId: queue.queue_id,
    queueIds: merged?.queues?.map((entry) => entry.id) || (queue.queue_id ? [queue.queue_id] : []),
    status: "running",
    endedAt: null,
    reason: null,
    recovery: null,
    interruptedAt: null,
    interruptedTaskId: null,
    results: [],
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    taskOrder: ordered.map((task) => task.id),
    pendingTaskIds: ordered.map((task) => task.id),
    cursor: 0,
    currentTaskId: null,
    resumableTaskIds: [],
    pauseAfterSession,
    budget: { maxMinutes, maxSessions, scope: "per-task sessions; overall time limit" },
  });
    const results = [];
  const pending = [...ordered];
  const waiting = new Map();
  while (pending.length) {
    const queued = pending.shift();
    writeRunMeta(root, { heartbeatAt: new Date().toISOString(), currentTaskId: queued.id, pendingTaskIds: [...new Set([...pending.map((task) => task.id), ...waiting.keys()])] });
    if (runAbortRequested) {
      results.push({ id: queued.id, status: "queued", reason: "not reached: run aborted by operator" });
      writeRunMeta(root, { cursor: results.length, currentTaskId: null, results });
      continue;
    }
    if (Date.now() >= budget.deadline) {
      results.push({ id: queued.id, status: "queued", reason: "not reached: overall time budget exhausted", resumable: true });
      writeRunMeta(root, { cursor: results.length, currentTaskId: null, results });
      continue;
    }
    const fresh = loadState(root).tasks[queued.id];
    if (!fresh || isTerminal(fresh.status)) {
      results.push({ id: queued.id, status: fresh?.status || "unknown", reason: "skipped: already settled" });
      writeRunMeta(root, { cursor: results.length, currentTaskId: null, results });
      continue;
    }
    const unmet = unmetDependencies(loadState(root), fresh);
    if (unmet.length) {
      const reason = `waiting for prerequisite${unmet.length === 1 ? "" : "s"}: ${unmet.join(", ")}`;
      results.push({ id: fresh.id, status: "queued", reason, waiting: true });
      waiting.set(fresh.id, fresh);
      const waitingState = loadState(root);
      waitingState.tasks[fresh.id].waiting_reason = reason;
      saveState(root, waitingState);
      writeRunMeta(root, { cursor: results.length, currentTaskId: null, results, pendingTaskIds: [...new Set([...pending.map((task) => task.id), ...waiting.keys()])] });
      onProgress(`${fresh.id}: ${reason}`);
      continue;
    }
    say(root, "runner", `launch queue: taking ${fresh.id} — ${fresh.title}`, { task: fresh.id });
    let lease;
    try { lease = acquireLease(root, { project: path.resolve(root), task: fresh.id, role: fresh.assigned_worker || "rowan", run: runId || "preview" }); }
    catch (error) { results.push({ id: fresh.id, status: "queued", reason: error.message, lease: false }); onProgress(`${fresh.id}: ${error.message}`); continue; }
    const leaseHeartbeat = setInterval(() => { try { heartbeatLease(root, lease); } catch { /* expiry is surfaced at the next mutation */ } }, 5000);
    try {
    let outcome = await driveTaskUntilGate(root, fresh.id, budget, {
      overnight: true,
      lease,
      dryRun,
      onProgress,
      onSession,
      pauseAfterSession,
      onReview,
      echo,
      resolveWorker: (role) => {
        const profile = providerProfile(readManagerConfig(root));
        if (providerDefaults.worker) profile.defaultWorker = String(providerDefaults.worker).toLowerCase();
        if (providerDefaults.auth) profile.authOverride = String(providerDefaults.auth).toLowerCase();
        if (providerDefaults.model) profile.modelOverride = String(providerDefaults.model);
        const resolved = providerForRole(profile, role);
        return { ...resolved, provider: { ...providerSpec(profile, resolved.worker), model: resolved.model } };
      },
    }).catch((error) => ({ status: "unknown", reason: `worker could not start: ${error.message}`, failed: true }));
    try { heartbeatLease(root, lease); } catch (error) { outcome = { status: "blocked", reason: `lease fencing failed: ${error.message}`, failed: true }; }
    if (outcome.interrupted && (budget.taskSessions.get(fresh.id) || 0) < budget.maxSessions && Date.now() < budget.deadline) {
      say(root, "runner", `${fresh.id} restarting its gate with the pending human feedback.`, { task: fresh.id });
      outcome = await driveTaskUntilGate(root, fresh.id, budget, {
        overnight: true, dryRun, lease, onProgress, onSession, pauseAfterSession, onReview, echo,
        resolveWorker: (role) => {
          const profile = providerProfile(readManagerConfig(root));
          if (providerDefaults.worker) profile.defaultWorker = String(providerDefaults.worker).toLowerCase();
          if (providerDefaults.auth) profile.authOverride = String(providerDefaults.auth).toLowerCase();
          if (providerDefaults.model) profile.modelOverride = String(providerDefaults.model);
          const resolved = providerForRole(profile, role);
          return { ...resolved, provider: { ...providerSpec(profile, resolved.worker), model: resolved.model } };
        },
      }).catch((error) => ({ status: "unknown", reason: `worker could not restart: ${error.message}`, failed: true }));
    }
    const entry = { id: fresh.id, status: outcome.status || "unknown", reason: outcome.reason, resumable: Boolean(outcome.resumable), nextRole: outcome.nextRole || null, paused: Boolean(outcome.paused), aborted: Boolean(outcome.aborted), blocker: outcome.blocker || null };
    results.push(entry);
    writeRunMeta(root, { heartbeatAt: new Date().toISOString(), cursor: results.length, currentTaskId: null, results });
    if (outcome.aborted) {
      // Keep iterating: the runAbortRequested check at the top of the loop
      // records every untouched task as "not reached: run aborted by operator".
      say(root, "runner", `${fresh.id} keeps its gate status — the queue run was aborted by the operator.`, { task: fresh.id });
    }
    writeRunMeta(root, { phase: "recovery", currentTaskId: fresh.id });
    const contractFailure = outcome.preflight?.cause === "verifier-assumption" || /contract (?:conflict|contradiction)|downstream.*(?:owns|owned)|conflicting.*ownership/i.test(outcome.reason || "");
    const repairState = loadState(root); const repairTask = repairState.tasks[fresh.id];
    let contractRecovered = false;
    if (contractFailure && !repairTask.pip_repair_request && !dryRun && maxAutoRecoveries(root) > 0 && Date.now() < budget.deadline && (repairTask.execution_budget?.used || 0) < budget.maxSessions) {
      recordBlocker(repairTask, { cause: outcome.preflight?.cause || "contract-conflict", reason: outcome.reason, recovery_owner: "pip" });
      repairTask.pip_repair_request = { version: 1, objective: repairTask.objective, reason: outcome.reason, at: new Date().toISOString() };
      saveState(root, repairState);
      const contractRecovery = await repairBlocker(root, fresh.id, {
        action: "pip-contract-repair",
        maxAttempts: maxAutoRecoveries(root),
        remedy: async () => driveTaskUntilGate(root, fresh.id, budget, {
          overnight: true, dryRun, lease, onProgress, onSession, echo, contractRepair: true,
          resolveWorker: (role) => {
            const profile = providerProfile(readManagerConfig(root));
            const resolved = providerForRole(profile, role);
            return { ...resolved, provider: { ...providerSpec(profile, resolved.worker), model: resolved.model } };
          },
        }),
        preflight: (candidate, tasks) => candidate.pip_repair
          ? dispatchPreflight(root, candidate, tasks, { provisionLocal: readManagerConfig(root).workspaces?.provisionLocal === true, allowIntegration: true })
          : { ready: false, reason: "Pip did not repair the contract" },
      });
      contractRecovered = contractRecovery.recovered;
    }
    if (!contractRecovered) await prepareRecovery(root, fresh.id, outcome);
    const recovery = recoverAfterOutcome(root, fresh.id, outcome, { maxRecoveries: maxAutoRecoveries(root) });
    entry.status = loadState(root).tasks[fresh.id]?.status || entry.status;
    if (recovery.recovered) {
      pending.push(loadState(root).tasks[fresh.id]);
      results.push({ id: fresh.id, status: "requeued", reason: "Mira auto-recovered a non-human blocker" });
    }
    if (entry.status === "done" || recovery.recovered) {
      const latest = loadState(root);
      for (const [id, task] of waiting) {
        if (!unmetDependencies(latest, latest.tasks[id]).length) {
          pending.push(task); waiting.delete(id);
          latest.tasks[id].waiting_reason = null;
          for (let i = results.length - 1; i >= 0; i--) if (results[i].id === id && results[i].waiting) results.splice(i, 1);
        }
      }
      const pendingIds = new Set(pending.map((task) => task.id));
      for (const item of queue.items) {
        const task = latest.tasks[item.id];
        if (task?.revalidation_requested && !isTerminal(task.status) && !pendingIds.has(task.id) && task.id !== fresh.id && !waiting.has(task.id)) { pending.push(task); pendingIds.add(task.id); }
      }
      saveState(root, latest);
    }
    writeRunMeta(root, { phase: "boundary", currentTaskId: null, results, pendingTaskIds: [...new Set([...pending.map((task) => task.id), ...waiting.keys()])] });
    } finally {
      clearInterval(leaseHeartbeat);
      releaseLease(root, lease);
    }
  }
  let completionReason = runAbortRequested ? "operator stopped the run"
    : results.find((entry) => entry.status === "blocked" || entry.status === "unknown" || entry.resumable || entry.waiting)?.reason || "queue run complete";
  const finalState = loadState(root);
  const finalTasks = queue.items.map((item) => finalState.tasks[item.id]).filter(Boolean);
  const { status: queueStatus, delivery, reason: gateReason } = queueCompletion(root, finalTasks, { deliver: !runAbortRequested && !results.some((entry) => entry.paused) });
  if (!runAbortRequested && queueStatus !== "completed" && gateReason) completionReason = gateReason;
  writeRunMeta(root, {
    status: runAbortRequested ? "aborted" : (results.some((entry) => entry.paused) ? "paused" : queueStatus),
    delivery,
    endedAt: new Date().toISOString(),
    reason: completionReason,
    currentTaskId: null,
    resumableTaskIds: [...new Set([...results.filter((entry) => entry.resumable).map((entry) => entry.id), ...waiting.keys()])],
    results,
  });
  // Threshold watch: near-exhaustion or exhaustion at run end posts a
  // deduplicated notification so the manager sees the blocker coming.
  try {
    checkUsageThresholds(root, {
      sessions: budget.sessions,
      maxSessions,
      elapsedMs: Date.now() - runStartedAt,
      maxMinutes,
    });
  } catch { /* telemetry must never fail the run summary */ }
  return { results, budget, runId, reason: completionReason, status: queueStatus, delivery };
  } finally {
    if (runId) endQueueRun(root, runId);
  }
}

// Recovery remains an owner action.  The caller must inspect the interrupted
// task and explicitly confirm before the runner touches only the tasks whose
// prior boundary was durable and whose session never began.
export async function resumeOvernightRun(root, { confirm = false, maxMinutes = 120, maxSessions = 8, providerDefaults = {}, onProgress = console.log } = {}) {
  if (!confirm) throw new Error("overnight recovery requires explicit confirmation");
  const reconciliation = reconcileOvernightRun(root);
  if (reconciliation.state !== "interrupted") throw new Error(`overnight recovery is unavailable while run state is ${reconciliation.state}`);
  if (!reconciliation.resumableTaskIds.length) return { results: [], reason: "no safe task boundary is available to resume", interruptedTaskId: reconciliation.interruptedTaskId || null };
  return executeLaunchQueue(root, {
    confirm: true, taskIds: reconciliation.resumableTaskIds, maxMinutes, maxSessions, providerDefaults, onProgress,
  });
}
