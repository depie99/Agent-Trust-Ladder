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
    task.blocker = { reason, since: new Date().toISOString(), actor: "manager" };
    task.updated_at = new Date().toISOString();
    logEvent(state, { task: taskId, actor: "manager", event: "containment", detail: reason });
    return true;
  }
  task.blocker = { reason, since: new Date().toISOString(), actor: "manager" };
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
  return Number.isFinite(Number(configured)) ? Math.max(0, Number(configured)) : 1;
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
  overnight, dryRun, worker, auth, envPolicy, resolveWorker, onProgress = console.log, onSession = null, pauseAfterSession = false, onReview = null, echo = false,
}) {
  const report = typeof onProgress === "function" ? onProgress : console.log;
  const runDir = path.join(root, ".trust", "manager", "overnight", taskId);
  while (budget.sessions < budget.maxSessions && Date.now() < budget.deadline) {
    if (runAbortRequested) return { status: (loadState(root).tasks[taskId] || {}).status, reason: "run aborted by operator", aborted: true };
    const state = loadState(root);
    const task = state.tasks[taskId];
    if (!task) return { status: "unknown", reason: `unknown task ${taskId}` };
    if (isTerminal(task.status)) return { status: task.status, reason: `already ${task.status}` };
    const role = nextRole(task);
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
    if (role === "rowan") {
      const ws = ensureWorkspace(root, workspaceConfig(root, readManagerConfig(root)), task);
      workspace = ws.dir;
      if (task.workspace !== workspace) {
        task.workspace = workspace;
        logEvent(state, { task: task.id, actor: "runner", event: "workspace", detail: `${ws.mode}${ws.from ? ` from ${ws.from}` : ""}${ws.reused ? " (reused)" : ""}` });
        saveState(root, state);
      }
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
    const invocation = buildInvocation(useWorker, { root, workspace, role, task, auth: useAuth, provider: useProvider, feedback, navigationContext });
    budget.sessions += 1;
    const logPath = path.join(runDir, `session-${String(budget.sessions).padStart(2, "0")}-${role}.log`);
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
    // Persist worker_start before the session runs — otherwise the event is
    // logged into a state object that the post-session reload discards, and
    // the history only ever shows worker_exit.
    saveState(root, state);

    let result;
    try {
      result = await runInvocation(invocation, {
        env: { ATL_PROJECT: root, ...credentialEnv },
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
    const nextTask = after.tasks[taskId];
    logEvent(after, { task: taskId, actor: "runner", event: "worker_exit", detail: `${useWorker}/${role}; code=${result.code}; timed_out=${result.timedOut}; log=${logPath}` });
    say(root, "runner", `${role} session ended for ${taskId}: code=${result.code}${result.timedOut ? ", timed out" : ""}.`, { task: taskId, detail: logPath });
    saveState(root, after);
    const summary = {
      taskId, role, worker: useWorker, model: useProvider.model || null,
      session: budget.sessions, logPath, startedAt: result.startedAt, finishedAt: result.finishedAt,
      exitCode: result.code, timedOut: result.timedOut, signal: result.signal || null,
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
    if (result.timedOut || result.code !== 0) {
      return { status: nextTask?.status || task.status, reason: `worker ended unsuccessfully (code ${result.code}${result.timedOut ? ", timeout" : ""})`, failed: true };
    }
    if (!nextTask || nextTask.status === task.status) {
      return { status: task.status, reason: `worker did not advance ${taskId} from ${task.status}; inspect the log and feed`, stalled: true };
    }
    if (!overnight) return { status: nextTask.status, reason: "one-shot session complete" };
  }
  const finalTask = loadState(root).tasks[taskId];
  if (budget.sessions >= budget.maxSessions) return { status: finalTask?.status, reason: "session budget reached" };
  return { status: finalTask?.status, reason: "time budget reached" };
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
export function buildLaunchPlan(root, { taskIds, maxMinutes = 120, maxSessions = 5, providerDefaults = {}, discover = discoverProvider, preserveOrder = false } = {}) {
  const state = loadState(root);
  const profile = providerProfile(readManagerConfig(root));
  if (providerDefaults.worker) profile.defaultWorker = String(providerDefaults.worker).toLowerCase();
  if (providerDefaults.auth) profile.authOverride = String(providerDefaults.auth).toLowerCase();
  if (providerDefaults.model) profile.modelOverride = String(providerDefaults.model);
  const byId = new Map(Object.values(state.tasks).map((t) => [t.id, t]));
  const present = (taskIds || []).map((id) => byId.get(id)).filter(Boolean);
  // Priority ordering is the default; round-robin multi-queue runs preserve
  // their interleaved queue order instead.
  const ordered = preserveOrder ? present.filter((t) => t.status && !isTerminal(t.status)) : queueSelect(present);
  const items = [];
  for (const task of ordered) {
    const role = nextRole(task);
    const provider = providerForRole(profile, role);
    const spec = role ? providerSpec(profile, provider.worker) : null;
    const resolvedProvider = spec ? { ...provider, command: spec.command, model: provider.model || spec.model } : provider;
    const resolvedSpec = spec ? { ...spec, model: resolvedProvider.model } : spec;
    const disc = role ? discover(provider.worker, { command: spec.command }) : null;
    const blockers = [];
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
    confirmCommand: `atl launch --confirm${providerDefaults.worker ? ` --worker ${providerDefaults.worker}` : ""}${providerDefaults.model ? ` --model ${providerDefaults.model}` : ""}${providerDefaults.auth ? ` --auth ${providerDefaults.auth}` : ""}${maxMinutes !== 120 ? ` --max-minutes ${maxMinutes}` : ""}${maxSessions !== 5 ? ` --max-sessions ${maxSessions}` : ""}`,
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
  const resumableTaskIds = order.slice(completed + (run.currentTaskId ? 1 : 0));
  const interruptedTaskId = run.currentTaskId || null;
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
export function queueDryRun(root, { queueId = null, maxMinutes = 120, maxSessions = 5, providerDefaults = {} } = {}) {
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

export function multiQueueDryRun(root, { queueIds, maxMinutes = 120, maxSessions = 5, providerDefaults = {} } = {}) {
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
export async function executeLaunchQueue(root, { maxMinutes = 120, maxSessions = 5, dryRun = false, confirm = false, providerDefaults = {}, onProgress = console.log, onSession = null, pauseAfterSession = false, onReview = null, echo = false, queueId = null, queueIds = null, taskIds = null } = {}) {
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
  const initialPresent = queue.items.map((item) => initialState.tasks[item.id]).filter((t) => t && !isTerminal(t.status));
  if (!initialPresent.length && (dryRun || !confirm)) {
    return { results: [], budget: { sessions: 0, maxSessions, deadline: Date.now() }, reason: "the execution queue is empty (queue tasks with `atl queue add <id>`)" };
  }
  if (!dryRun && !confirm) {
    throw new Error("launch requires --confirm; use --dry-run to preview without starting an agent");
  }
  recoverDueBlockedTasks(root, { taskIds: queue.items.map((item) => item.id), dryRun, maxRecoveries: maxAutoRecoveries(root) });
  const state = loadState(root);
  const present = queue.items.map((item) => state.tasks[item.id]).filter((t) => t && !isTerminal(t.status));
  // Round-robin multi-queue runs keep their interleaved order; single queues
  // stay priority-ordered.
  const ordered = queue.round_robin ? present : queueSelect(present);
  if (!ordered.length) {
    return { results: [], budget: { sessions: 0, maxSessions, deadline: Date.now() }, reason: "the execution queue is empty (queue tasks with `atl queue add <id>`)" };
  }
  runAbortRequested = false;
  sessionInterruptRequested = false;
  const budget = { sessions: 0, maxSessions, deadline: Date.now() + maxMinutes * 60 * 1000 };
  const runStartedAt = Date.now();
  const runId = dryRun ? null : beginQueueRun(root, queue.queue_id);
  writeRunMeta(root, {
    version: 2,
    runId,
    queueId: queue.queue_id,
    queueIds: merged?.queues?.map((entry) => entry.id) || (queue.queue_id ? [queue.queue_id] : []),
    status: "running",
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    taskOrder: ordered.map((task) => task.id),
    cursor: 0,
    currentTaskId: null,
    resumableTaskIds: [],
    pauseAfterSession,
    budget: { maxMinutes, maxSessions },
  });
  try {
    const results = [];
  const pending = [...ordered];
  while (pending.length) {
    const queued = pending.shift();
    writeRunMeta(root, { heartbeatAt: new Date().toISOString(), currentTaskId: queued.id });
    if (runAbortRequested) {
      results.push({ id: queued.id, status: "queued", reason: "not reached: run aborted by operator" });
      writeRunMeta(root, { cursor: results.length, currentTaskId: null, results });
      continue;
    }
    if (budget.sessions >= budget.maxSessions || Date.now() >= budget.deadline) {
      results.push({ id: queued.id, status: "queued", reason: budget.sessions >= budget.maxSessions ? "not reached: session budget exhausted" : "not reached: time budget exhausted" });
      writeRunMeta(root, { cursor: results.length, currentTaskId: null, results });
      continue;
    }
    const fresh = loadState(root).tasks[queued.id];
    if (!fresh || isTerminal(fresh.status)) {
      results.push({ id: queued.id, status: fresh?.status || "unknown", reason: "skipped: already settled" });
      writeRunMeta(root, { cursor: results.length, currentTaskId: null, results });
      continue;
    }
    say(root, "runner", `launch queue: taking ${fresh.id} — ${fresh.title}`, { task: fresh.id });
    let outcome = await driveTaskUntilGate(root, fresh.id, budget, {
      overnight: true,
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
    if (outcome.interrupted && budget.sessions < budget.maxSessions && Date.now() < budget.deadline) {
      say(root, "runner", `${fresh.id} restarting its gate with the pending human feedback.`, { task: fresh.id });
      outcome = await driveTaskUntilGate(root, fresh.id, budget, {
        overnight: true, dryRun, onProgress, onSession, pauseAfterSession, onReview, echo,
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
    results.push({ id: fresh.id, status: outcome.status || "unknown", reason: outcome.reason });
    writeRunMeta(root, { heartbeatAt: new Date().toISOString(), cursor: results.length, currentTaskId: null, results });
    if (outcome.aborted) {
      // Keep iterating: the runAbortRequested check at the top of the loop
      // records every untouched task as "not reached: run aborted by operator".
      say(root, "runner", `${fresh.id} keeps its gate status — the queue run was aborted by the operator.`, { task: fresh.id });
    }
    const recovery = recoverAfterOutcome(root, fresh.id, outcome, { maxRecoveries: maxAutoRecoveries(root) });
    if (recovery.recovered) {
      pending.push(loadState(root).tasks[fresh.id]);
      results.push({ id: fresh.id, status: "requeued", reason: "Mira auto-recovered a non-human blocker" });
    }
  }
  writeRunMeta(root, {
    status: runAbortRequested ? "aborted" : "finished",
    endedAt: new Date().toISOString(),
    currentTaskId: null,
    resumableTaskIds: [],
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
  return { results, budget, runId, reason: "queue run complete" };
  } finally {
    if (runId) endQueueRun(root, runId);
  }
}

// Recovery remains an owner action.  The caller must inspect the interrupted
// task and explicitly confirm before the runner touches only the tasks whose
// prior boundary was durable and whose session never began.
export async function resumeOvernightRun(root, { confirm = false, maxMinutes = 120, maxSessions = 5, providerDefaults = {}, onProgress = console.log } = {}) {
  if (!confirm) throw new Error("overnight recovery requires explicit confirmation");
  const reconciliation = reconcileOvernightRun(root);
  if (reconciliation.state !== "interrupted") throw new Error(`overnight recovery is unavailable while run state is ${reconciliation.state}`);
  if (!reconciliation.resumableTaskIds.length) return { results: [], reason: "no safe task boundary is available to resume", interruptedTaskId: reconciliation.interruptedTaskId || null };
  return executeLaunchQueue(root, {
    confirm: true, taskIds: reconciliation.resumableTaskIds, maxMinutes, maxSessions, providerDefaults, onProgress,
  });
}
