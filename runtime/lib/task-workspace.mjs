import { createTask, loadState, logEvent, saveState, transition } from "./state.mjs";
import { queueList, queueRemove } from "./queue.mjs";

const EDITABLE = new Set([
  "title", "objective", "completion_checks", "priority", "risk", "labels",
  "selected_skills", "proposed_worker", "skill_route", "review_required", "resources",
]);
const LIVE_STATUSES = new Set(["in_progress", "in_review", "verifying"]);

function cleanTitle(title) {
  const value = String(title || "").trim();
  if (!value) throw new Error("task title is required");
  if (value.length > 240) throw new Error("task title must be 240 characters or fewer");
  return value;
}

function applyFields(task, fields) {
  for (const [key, value] of Object.entries(fields || {})) {
    if (!EDITABLE.has(key)) continue;
    // Creation callers pass the full optional field shape. An omitted value is
    // not an edit request and must not be validated as an invalid enum value.
    if (value === undefined) continue;
    if (key === "title") task.title = cleanTitle(value);
    else if (key === "completion_checks" || key === "labels" || key === "selected_skills" || key === "resources") {
      if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
      task[key] = value;
    } else if (key === "priority") {
      if (!["low", "normal", "high", "urgent"].includes(value)) throw new Error("priority must be low, normal, high, or urgent");
      task.priority = value;
    } else if (key === "risk") {
      if (!["normal", "risky"].includes(value)) throw new Error("risk must be normal or risky");
      task.risk = value;
      if (value === "risky") task.review_required = true;
    } else {
      task[key] = value;
    }
  }
}

export function createTaskInWorkspace(root, fields = {}) {
  const state = loadState(root);
  const task = createTask(state, { ...fields, title: cleanTitle(fields.title) });
  applyFields(task, fields);
  logEvent(state, { task: task.id, actor: "manager", event: "task_create", detail: "created in the TUI task workspace" });
  saveState(root, state);
  return task;
}

export function editTaskInWorkspace(root, taskId, fields = {}) {
  const state = loadState(root);
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);
  if (task.status === "archived") throw new Error(`${taskId}: restore it before editing`);
  applyFields(task, fields);
  task.updated_at = new Date().toISOString();
  logEvent(state, { task: taskId, actor: "manager", event: "task_edit", detail: `edited fields: ${Object.keys(fields).filter((key) => EDITABLE.has(key)).join(", ") || "none"}` });
  saveState(root, state);
  return task;
}

export function archiveTask(root, taskId, { note = "archived by manager" } = {}) {
  const state = loadState(root);
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);
  if (task.status === "archived") return { task, removed: 0, alreadyArchived: true };
  if (LIVE_STATUSES.has(task.status)) {
    throw new Error(`${taskId}: stop or complete the active session before archiving (${task.status})`);
  }
  transition(state, taskId, "archived", { actor: "manager", note });
  task.archived_at = new Date().toISOString();
  task.archive_note = note;
  saveState(root, state);
  let removed = 0;
  for (const queue of queueList(root, { includeArchived: false })) {
    const result = queueRemove(root, taskId, { queueId: queue.id });
    if (result.removed) removed += 1;
  }
  return { task, removed, alreadyArchived: false };
}

export function restoreTask(root, taskId, { note = "restored by manager" } = {}) {
  const state = loadState(root);
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId}`);
  if (task.status !== "archived") throw new Error(`${taskId}: only archived tasks can be restored (currently ${task.status})`);
  transition(state, taskId, "new", { actor: "manager", note });
  task.archived_at = null;
  task.archive_note = null;
  saveState(root, state);
  return task;
}
