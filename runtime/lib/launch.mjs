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
import { buildInvocation, isTerminal, nextRole, queueSelect, runInvocation, workerEnvPolicy } from "./worker.mjs";
import { post as feedPost } from "./feed.mjs";
import { discoverProvider, providerForRole, providerProfile, providerSpec } from "./providers.mjs";
import { credentialContext, validateProviderEntry } from "./userProviders.mjs";
import { loadQueue } from "./queue.mjs";

const say = (root, from, text, opts = {}) => feedPost(root, { from, text, ...opts });

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
  overnight, dryRun, worker, auth, envPolicy, resolveWorker, onProgress = console.log, echo = false,
}) {
  const report = typeof onProgress === "function" ? onProgress : console.log;
  const runDir = path.join(root, ".trust", "manager", "overnight", taskId);
  while (budget.sessions < budget.maxSessions && Date.now() < budget.deadline) {
    const state = loadState(root);
    const task = state.tasks[taskId];
    if (!task) return { status: "unknown", reason: `unknown task ${taskId}` };
    if (isTerminal(task.status)) return { status: task.status, reason: `already ${task.status}` };
    const role = nextRole(task);
    if (!role) return { status: task.status, reason: `no worker role is defined for status ${task.status}` };

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

    const invocation = buildInvocation(useWorker, { root, workspace, role, task, auth: useAuth, provider: useProvider });
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

    const result = await runInvocation(invocation, {
      env: { ATL_PROJECT: root, ...credentialEnv },
      unsetEnv: useEnvPolicy.unset,
      logPath,
      timeoutMs,
      stdinText: invocation.prompt,
      echo,
    });
    const after = loadState(root);
    const nextTask = after.tasks[taskId];
    logEvent(after, { task: taskId, actor: "runner", event: "worker_exit", detail: `${useWorker}/${role}; code=${result.code}; timed_out=${result.timedOut}; log=${logPath}` });
    say(root, "runner", `${role} session ended for ${taskId}: code=${result.code}${result.timedOut ? ", timed out" : ""}.`, { task: taskId, detail: logPath });
    saveState(root, after);
    report(`[${taskId}] ${role} session finished · exit ${result.code}${result.timedOut ? " · timed out" : ""}`);

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
export function buildLaunchPlan(root, { taskIds, maxMinutes = 120, maxSessions = 5, providerDefaults = {}, discover = discoverProvider } = {}) {
  const state = loadState(root);
  const profile = providerProfile(readManagerConfig(root));
  if (providerDefaults.worker) profile.defaultWorker = String(providerDefaults.worker).toLowerCase();
  if (providerDefaults.auth) profile.authOverride = String(providerDefaults.auth).toLowerCase();
  if (providerDefaults.model) profile.modelOverride = String(providerDefaults.model);
  const byId = new Map(Object.values(state.tasks).map((t) => [t.id, t]));
  const present = (taskIds || []).map((id) => byId.get(id)).filter(Boolean);
  const ordered = queueSelect(present);
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
        invocation = buildInvocation(provider.worker, {
            root, workspace: task.workspace || root, role, task, auth: provider.auth, provider: resolvedSpec,
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

// ---------- the confirmed sequential queue run

// Execute the persisted execution queue: strictly sequential (brief
// constraint), one shared budget, per-role providers. A task whose provider
// is missing — or that stalls/fails — is containment-blocked with an
// actionable reason and the queue moves on. Ends with a saved brief.
export async function executeLaunchQueue(root, { maxMinutes = 120, maxSessions = 5, dryRun = false, confirm = false, providerDefaults = {}, onProgress = console.log, echo = false } = {}) {
  const queue = loadQueue(root);
  const state = loadState(root);
  const present = queue.items.map((item) => state.tasks[item.id]).filter((t) => t && !isTerminal(t.status));
  const ordered = queueSelect(present);
  if (!ordered.length) {
    return { results: [], budget: { sessions: 0, maxSessions, deadline: Date.now() }, reason: "the execution queue is empty (queue tasks with `atl queue add <id>`)" };
  }
  if (!dryRun && !confirm) {
    throw new Error("launch requires --confirm; use --dry-run to preview without starting an agent");
  }
  const budget = { sessions: 0, maxSessions, deadline: Date.now() + maxMinutes * 60 * 1000 };
  const results = [];
  for (const queued of ordered) {
    if (budget.sessions >= budget.maxSessions || Date.now() >= budget.deadline) {
      results.push({ id: queued.id, status: "queued", reason: budget.sessions >= budget.maxSessions ? "not reached: session budget exhausted" : "not reached: time budget exhausted" });
      continue;
    }
    const fresh = loadState(root).tasks[queued.id];
    if (!fresh || isTerminal(fresh.status)) {
      results.push({ id: queued.id, status: fresh?.status || "unknown", reason: "skipped: already settled" });
      continue;
    }
    say(root, "runner", `launch queue: taking ${fresh.id} — ${fresh.title}`, { task: fresh.id });
    const outcome = await driveTaskUntilGate(root, fresh.id, budget, {
      overnight: true,
      dryRun,
      onProgress,
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
    results.push({ id: fresh.id, status: outcome.status || "unknown", reason: outcome.reason });
    if (outcome.failed || outcome.stalled) {
      const s = loadState(root);
      const blocked = containmentBlock(s, fresh.id, outcome.reason);
      if (blocked) {
        saveState(root, s);
        say(root, "runner", `${fresh.id} blocked by the launch queue: ${outcome.reason}. taking the next task.`, { task: fresh.id });
      }
    }
  }
  return { results, budget, reason: "queue run complete" };
}
