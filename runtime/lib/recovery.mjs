// Safe recovery actions for tasks that stopped at an explicit blocked gate.
// Unblocking never launches a worker: it only restores the task to a valid
// pre-run state so the manager can review, queue, and explicitly run it.

import { loadState, saveState, transition, addEvidence } from "./state.mjs";
import { queueAdd, queueIds } from "./queue.mjs";
import fs from "node:fs";
import path from "node:path";
import { reconcileLeases } from "./leases.mjs";
import { recordBlocker } from "./queue-recovery.mjs";
import { readHandoff } from "./handoffs.mjs";

const WORKERS = new Set(["pip", "rowan", "sage", "beacon"]);
const ACTIVE_STATUSES = new Set(["new", "triaged", "assigned", "in_progress", "in_review", "verifying", "blocked", "escalated"]);
const APPROVAL_RE = /\bapprov/i;
// These blockers describe an authority or capability that the bounded team
// cannot manufacture by retrying. Keep them explicit so Mira does not turn a
// useful escalation into an infinite retry loop.
const HUMAN_ACTION_RE = /\bowner\b|human approval|permission|access denied|access unavailable|no access|ReadAndExecute access|\bacl\b|eperm|read[- ]only|write access|credentials?|authenticate|login|not found on path|install (it|the)|owner-capable|active checkout|main checkout|index\.lock|git .*denied|merge|deploy|push|spend|external message/i;

export function requiresHumanAction(reason = "") {
  return HUMAN_ACTION_RE.test(String(reason));
}

function proposedWorker(task) {
  const candidate = task.assigned_worker || task.proposed_worker;
  return WORKERS.has(candidate) ? candidate : null;
}

export function unblockTask(root, taskId, { to, note = "blocker resolved", recoveryOwner = "manager" } = {}) {
  const state = loadState(root);
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);
  if (task.status !== "blocked") throw new Error(`${taskId}: only blocked tasks can be unblocked (currently ${task.status})`);
  // Older runners persisted missing handoffs as generic execution failures.
  // Preserve the same prerequisite gate for those records before clearing them.
  const missingHandoff = /ENOENT[^\r\n]*handoffs[\\/][^\\/\r\n]+\.json/i;
  if (task.blocker?.cause === "handoff" || task.recovery?.cause === "handoff"
      || missingHandoff.test(task.blocker?.reason || "") || missingHandoff.test(task.recovery?.reason || "")) {
    const seen = new Set();
    const verify = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const predecessor = state.tasks[id];
      if (!predecessor || predecessor.status !== "done") throw new Error(`${taskId}: prerequisite ${id} must be completed before unblocking`);
      for (const parent of predecessor.plan_depends_on || []) verify(parent);
      try { readHandoff(root, predecessor); } catch { throw new Error(`${taskId}: prerequisite ${id} has no valid verified handoff. Revalidate its output and evidence before unblocking; increasing the session budget will not resolve this.`); }
    };
    for (const id of task.plan_depends_on || []) verify(id);
  }

  const worker = proposedWorker(task);
  const target = to || (worker ? "assigned" : "triaged");
  if (!["triaged", "assigned"].includes(target)) {
    throw new Error(`${taskId}: unblock target must be triaged or assigned`);
  }
  if (target === "assigned" && !worker) {
    throw new Error(`${taskId}: choose a worker first; no assigned or proposed worker is available`);
  }

  // The state contract deliberately exposes blocked -> triaged. When a worker
  // is already known, complete the normal triage -> assigned handoff in the
  // same audited action so the task can be queued and run immediately.
  const from = task.status;
  transition(state, taskId, "triaged", { actor: "manager", note });
  if (target === "assigned") {
    task.assigned_worker = worker;
    transition(state, taskId, "assigned", { actor: "manager", note: `recovered for ${worker}` });
  }
  task.blocker = null;
  task.waiting_reason = null;
  if (task.recovery) {
    const record = task.recovery_records?.find((item) => item.id === task.recovery.id) || task.recovery;
    record.status = "resolved"; record.resolved_by = recoveryOwner; record.resolution = note; task.recovery = record;
  }
  task.next_wake_at = null;
  task.updated_at = new Date().toISOString();
  saveState(root, state);
  return { task, from, to: task.status, worker: task.assigned_worker || null, note };
}

// Mira's bounded recovery action. It only retries a blocked task when the
// recorded reason is plausibly transient and a retry timer is due. Human-owned
// gates and capability failures stay blocked and are surfaced to the manager.
export function autoRecoverBlockedTask(root, taskId, { note = "retrying after an automatic recovery pass", maxRecoveries = 1, now = new Date() } = {}) {
  const state = loadState(root);
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);
  if (task.status !== "blocked") return { recovered: false, kind: "not-blocked", task };

  const reason = typeof task.blocker === "string" ? task.blocker : task.blocker?.reason || "";
  if (/provider usage limit|usage limit for GapCode|provider quota (?:exhausted|reached)|provider reported (?:exhausted quota|a rate limit)|(?:hit|reached|exhausted).{0,30}usage limit/i.test(reason)) {
    return { recovered: false, kind: "provider-quota", reason, task };
  }
  if (task.recovery?.status !== "resolved" && /contract (?:conflict|contradiction)|conflicting (?:task|contract)|downstream.*(?:owns|owned)|pending manager contract/i.test(reason)) {
    return { recovered: false, kind: "contract-conflict", reason, task };
  }
  if (task.recovery?.status !== "resolved" && requiresHumanAction(reason)) {
    recordBlocker(task, { cause: "owner-capability", reason, recovery_owner: "owner" });
    saveState(root, state);
    return { recovered: false, kind: "human-action", reason, task };
  }

  if (!task.recovery || task.recovery.status !== "resolved" || !task.recovery.attempts.some((attempt) => attempt.preflight?.ready)) {
    return { recovered: false, kind: "repair-required", reason: reason || "successful repair and preflight required", task };
  }

  const due = task.next_wake_at ? new Date(task.next_wake_at) : null;
  if (due && !Number.isNaN(due.getTime()) && due > now) {
    return { recovered: false, kind: "waiting", reason, task, due: due.toISOString() };
  }

  const count = Number(task.auto_recovery_count || 0);
  if (Number(maxRecoveries) <= 0) {
    return { recovered: false, kind: "budget-exhausted", reason, task, count };
  }

  const result = unblockTask(root, taskId, { note, recoveryOwner: "mira" });
  const after = loadState(root);
  const recovered = after.tasks[taskId];
  recovered.auto_recovery_count = count + 1;
  recovered.updated_at = new Date().toISOString();
  after.log.push({
    at: new Date().toISOString(),
    task: taskId,
    actor: "mira",
    event: "auto_recover",
    detail: `${note}; previous blocker: ${reason || "(none recorded)"}`,
  });
  saveState(root, after);
  return { recovered: true, kind: "recovered", task: recovered, count: recovered.auto_recovery_count, result };
}

// The owner gate, exercised from the CLI: the human says one word, the runtime
// records it as durable evidence, clears the blocker, and queues the task.
export function approveTask(root, taskId, { note = "" } = {}) {
  const state = loadState(root);
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);

  const detail = note || "owner approved in the CLI";
  addEvidence(state, taskId, { kind: "approval", result: "approved", detail }, "manager");
  saveState(root, state);

  let unblocked = null;
  if (task.status === "blocked") {
    unblocked = unblockTask(root, taskId, { note: `owner approval recorded: ${detail}` });
  }
  const { added } = queueAdd(root, taskId, { by: "manager" });
  return { task: unblocked ? unblocked.task : task, unblocked, queued: added, detail };
}

// The "why" behind every non-done task: the full blocker (never truncated)
// plus the exact command that fixes it.
export function explainTasks(root, taskId) {
  const state = loadState(root);
  const tasks = Object.values(state.tasks).filter((t) => ACTIVE_STATUSES.has(t.status));
  const selected = taskId ? tasks.filter((t) => t.id === taskId) : tasks;
  const queued = new Set(queueIds(root));
  let latestRun = null;
  try { latestRun = JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "overnight", "run.json"), "utf8")); } catch { /* No readable run record. */ }

  return selected.map((t) => {
    const base = {
      task: t,
      queued: queued.has(t.id),
      since: typeof t.blocker === "object" && t.blocker ? t.blocker.since : null,
      actor: typeof t.blocker === "object" && t.blocker ? t.blocker.actor : null,
    };
    const blockerText = typeof t.blocker === "string" ? t.blocker : t.blocker?.reason || "";
    switch (t.status) {
      case "blocked": {
        const approvalGate = APPROVAL_RE.test(blockerText);
        const humanAction = requiresHumanAction(blockerText);
        return {
          ...base,
          kind: approvalGate ? "owner-approval" : humanAction ? "human-action" : "blocked",
          why: blockerText || "blocked without a recorded reason — ask the blocking role to re-state it",
          fix: approvalGate
            ? `atl approve ${t.id} --note "why you approve"`
            : humanAction
              ? `manager action required: resolve the access/authority gate, then atl unblock ${t.id} --to assigned --note "gate resolved"`
            : `atl unblock ${t.id} --note "how the blocker is resolved"`,
        };
      }
      case "escalated":
        return {
          ...base,
          kind: "escalated",
          why: blockerText || "escalated to the manager",
          fix: `atl move ${t.id} triaged --actor mira --note "back to triage"`,
        };
      case "new":
        return { ...base, kind: "waiting", why: "waiting for Pip's triage (objective + completion checks)", fix: `atl launch --confirm  (or: atl triage ${t.id} --actor pip)` };
      case "triaged":
        return { ...base, kind: "waiting", why: "waiting for Mira to assign a worker", fix: `atl launch --confirm  (or: atl assign ${t.id} --to <worker> --actor mira)` };
      case "assigned":
        return {
          ...base,
          kind: "waiting",
          why: `assigned to ${t.assigned_worker || "a worker"} but no session has picked it up`,
          fix: base.queued ? `atl launch --confirm  (it is in the queue)` : `atl queue add ${t.id} && atl launch --confirm`,
        };
      case "in_progress":
        if (latestRun?.status === "interrupted" && latestRun.interruptedTaskId === t.id) {
          return {
            ...base,
            kind: "interrupted",
            why: `the worker session was interrupted; inspect its transcript and evidence before retrying: .trust/manager/overnight/${t.id}/session-*.log`,
            fix: `resolve the interruption, then atl launch --confirm`,
          };
        }
        return {
          ...base,
          kind: "working",
          why: `task is in progress; check the runner and transcript for live activity: .trust/manager/overnight/${t.id}/session-*.log`,
          fix: `atl launch --confirm  (re-enter if the session died)`,
        };
      case "in_review":
        return {
          ...base,
          kind: "waiting",
          why: t.review_required ? "in review — Sage's verdict is required before it can verify" : "in review — waiting for the reviewer",
          fix: `atl launch --confirm  (a Sage session gives the verdict)`,
        };
      case "verifying":
        return { ...base, kind: "waiting", why: "checks recorded — Beacon's close-out is the last hop", fix: `atl launch --confirm  (Beacon closes it)` };
      default:
        return { ...base, kind: "unknown", why: `status ${t.status}`, fix: "" };
    }
  });
}

export function reconcileRuntime(root) {
  const leases = reconcileLeases(root);
  const dir = path.join(root, ".trust", "manager", "journal"); const journals = [];
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (name.endsWith(".json")) { const file = path.join(dir, name); try { const entry = JSON.parse(fs.readFileSync(file, "utf8")); if (["prepared", "committing"].includes(entry.status)) { entry.status = "reconcile_required"; entry.reconciled_at = new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n"); } journals.push(entry); } catch { journals.push({ file: name, status: "unreadable" }); } }
  return { leases, journals, ready: journals.every((entry) => entry.status !== "unreadable") };
}
