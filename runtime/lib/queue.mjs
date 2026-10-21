// The human-controlled execution queue.
//
// Queue membership is persistent and auditable (.trust/manager/queue.json) and
// is deliberately separate from the dashboard's keyboard focus: marking a task
// for execution is a decision, looking at it is not. The file is local and
// removable — without it the runtime degrades to the CLI-only flow
// (`atl run` / `atl overnight`), exactly as the 014 rollback story requires.

import fs from "node:fs";
import path from "node:path";
import { paths } from "./state.mjs";

export class QueueError extends Error {}

function queueFile(root) {
  return path.join(path.dirname(paths(root).state), "queue.json");
}

export function loadQueue(root) {
  const file = queueFile(root);
  if (!fs.existsSync(file)) return { version: 1, updated_at: null, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed.version !== 1) throw new QueueError(`Unsupported queue version ${parsed.version}`);
    return { ...parsed, items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (error) {
    if (error instanceof QueueError) throw error;
    throw new QueueError(`Could not read ${file}: ${error.message}`);
  }
}

export function saveQueue(root, queue) {
  const file = queueFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  queue.updated_at = new Date().toISOString();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return file;
}

export function queueAdd(root, taskId, { by = "manager" } = {}) {
  if (!taskId) throw new QueueError("queue add needs a task id");
  const queue = loadQueue(root);
  if (queue.items.some((item) => item.id === taskId)) return { queue, added: false };
  queue.items.push({ id: taskId, added_at: new Date().toISOString(), added_by: by });
  saveQueue(root, queue);
  return { queue, added: true };
}

export function queueRemove(root, taskId) {
  const queue = loadQueue(root);
  const before = queue.items.length;
  queue.items = queue.items.filter((item) => item.id !== taskId);
  const removed = before !== queue.items.length;
  if (removed) saveQueue(root, queue);
  return { queue, removed };
}

export function queueClear(root) {
  const queue = loadQueue(root);
  const removed = queue.items.length;
  queue.items = [];
  saveQueue(root, queue);
  return { queue, removed };
}

export function queueIds(root) {
  return loadQueue(root).items.map((item) => item.id);
}
