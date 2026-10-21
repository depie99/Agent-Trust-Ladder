// Safe recovery actions for tasks that stopped at an explicit blocked gate.
// Unblocking never launches a worker: it only restores the task to a valid
// pre-run state so the manager can review, queue, and explicitly run it.

import { loadState, saveState, transition } from "./state.mjs";

const WORKERS = new Set(["pip", "rowan", "sage", "beacon"]);

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

