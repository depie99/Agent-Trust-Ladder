// Safe recovery actions for tasks that stopped at an explicit blocked gate.
// Unblocking never launches a worker: it only restores the task to a valid
// pre-run state so the manager can review, queue, and explicitly run it.

import { loadState, saveState, transition, addEvidence } from "./state.mjs";
import { queueAdd, queueIds } from "./queue.mjs";

const WORKERS = new Set(["pip", "rowan", "sage", "beacon"]);
const ACTIVE_STATUSES = new Set(["new", "triaged", "assigned", "in_progress", "in_review", "verifying", "blocked", "escalated"]);
const APPROVAL_RE = /\bapprov/i;

function proposedWorker(task) {
  const candidate = task.assigned_worker || task.proposed_worker;
  return WORKERS.has(candidate) ? candidate : null;
}

export function unblockTask(root, taskId, { to, note = "blocker resolved" } = {}) {
  const state = loadState(root);
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);
  if (task.status !== "blocked") throw new Error(`${taskId}: only blocked tasks can be unblocked (currently ${task.status})`);

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
  task.next_wake_at = null;
  task.updated_at = new Date().toISOString();
  saveState(root, state);
  return { task, from, to: task.status, worker: task.assigned_worker || null, note };
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
        return {
          ...base,
          kind: approvalGate ? "owner-approval" : "blocked",
          why: blockerText || "blocked without a recorded reason — ask the blocking role to re-state it",
          fix: approvalGate
            ? `atl approve ${t.id} --note "why you approve"`
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
        return {
          ...base,
          kind: "working",
          why: `a ${t.assigned_worker || "worker"} session is working it — live transcript: .trust/manager/overnight/${t.id}/session-*.log`,
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

