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

export const QUEUE_VERSION = 2;
export const DEFAULT_QUEUE_ID = "default";

function queueFile(root) {
  return paths(root).queue;
}

function now() {
  return new Date().toISOString();
}

function defaultQueue(id = DEFAULT_QUEUE_ID, name = "Default") {
  const at = now();
  return {
    id,
    name,
    status: "idle",
    policy: { maxMinutes: 120, maxSessions: 5, maxConcurrent: 1 },
    provider: null,
    items: [],
    created_at: at,
    updated_at: at,
    archived_at: null,
  };
}

function normalizeQueue(queue, id = DEFAULT_QUEUE_ID) {
  const { version: _legacyVersion, ...queueFields } = queue || {};
  const base = defaultQueue(id, queueFields.name || (id === DEFAULT_QUEUE_ID ? "Default" : id));
  return {
    ...base,
    ...queueFields,
    id: queueFields.id || id,
    policy: { ...base.policy, ...(queueFields.policy || {}) },
    items: Array.isArray(queueFields.items) ? queueFields.items : [],
    archived_at: queueFields.archived_at || null,
  };
}

function normalizeBook(parsed) {
  if (!parsed) {
    return { version: QUEUE_VERSION, updated_at: null, active_queue: DEFAULT_QUEUE_ID, queues: { [DEFAULT_QUEUE_ID]: defaultQueue() } };
  }
  if (parsed.version === 1) {
    const legacy = normalizeQueue(parsed, DEFAULT_QUEUE_ID);
    return { version: QUEUE_VERSION, updated_at: parsed.updated_at || null, active_queue: DEFAULT_QUEUE_ID, queues: { [DEFAULT_QUEUE_ID]: legacy }, items: legacy.items };
  }
  if (parsed.version !== QUEUE_VERSION) throw new QueueError(`Unsupported queue version ${parsed.version}`);
  const queues = {};
  for (const [id, queue] of Object.entries(parsed.queues || {})) queues[id] = normalizeQueue(queue, id);
  if (!Object.keys(queues).length) queues[DEFAULT_QUEUE_ID] = defaultQueue();
  const active = queues[parsed.active_queue] && !queues[parsed.active_queue].archived_at
    ? parsed.active_queue
    : Object.keys(queues).find((id) => !queues[id].archived_at) || DEFAULT_QUEUE_ID;
  if (!queues[active]) queues[active] = defaultQueue(active, active);
  // Keep the v1 top-level `items` projection as a compatibility seam for
  // older validators/tools. The canonical data remains queues[active].items.
  if (Array.isArray(parsed.items)) queues[active].items = parsed.items;
  return { ...parsed, version: QUEUE_VERSION, active_queue: active, queues, items: queues[active].items };
}

export function loadQueueBook(root) {
  const file = queueFile(root);
  if (!fs.existsSync(file)) return normalizeBook(null);
  try {
    return normalizeBook(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    if (error instanceof QueueError) throw error;
    throw new QueueError(`Could not read ${file}: ${error.message}`);
  }
}

export function saveQueueBook(root, book) {
  const file = queueFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const activeItems = book?.queues?.[book.active_queue]?.items;
  const normalized = normalizeBook(activeItems ? { ...book, items: activeItems } : book);
  normalized.updated_at = now();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return file;
}

export function migrateQueueStore(root) {
  const file = queueFile(root);
  if (!fs.existsSync(file)) {
    const book = normalizeBook(null);
    saveQueueBook(root, book);
    return { migrated: true, fromVersion: null, backup: null, book };
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed.version === QUEUE_VERSION) return { migrated: false, fromVersion: QUEUE_VERSION, backup: null, book: normalizeBook(parsed) };
  if (parsed.version !== 1) throw new QueueError(`Unsupported queue version ${parsed.version}`);
  const backup = `${file}.legacy-v1-${Date.now()}.bak`;
  fs.copyFileSync(file, backup);
  const book = normalizeBook(parsed);
  saveQueueBook(root, book);
  return { migrated: true, fromVersion: 1, backup, book };
}

export function loadQueue(root, queueId = null) {
  const book = loadQueueBook(root);
  const id = queueId || book.active_queue || DEFAULT_QUEUE_ID;
  const queue = book.queues?.[id];
  if (queue) return { version: QUEUE_VERSION, ...queue, queue_id: id, active_queue: book.active_queue };
  if (book.version === 1 && id === DEFAULT_QUEUE_ID) {
    return { version: QUEUE_VERSION, ...normalizeQueue(book, DEFAULT_QUEUE_ID), queue_id: DEFAULT_QUEUE_ID, active_queue: DEFAULT_QUEUE_ID };
  }
  throw new QueueError(`Unknown queue "${id}"`);
}

export function saveQueue(root, queue) {
  const book = loadQueueBook(root);
  const id = queue.queue_id || queue.id || book.active_queue || DEFAULT_QUEUE_ID;
  book.queues[id] = normalizeQueue(queue, id);
  if (!book.queues[id].archived_at) book.active_queue = book.active_queue || id;
  saveQueueBook(root, book);
  return queueFile(root);
}

export function queueAdd(root, taskId, { by = "manager", queueId = null } = {}) {
  if (!taskId) throw new QueueError("queue add needs a task id");
  const queue = loadQueue(root, queueId);
  if (queue.items.some((item) => item.id === taskId)) return { queue, added: false };
  queue.items.push({ id: taskId, added_at: now(), added_by: by });
  saveQueue(root, queue);
  return { queue, added: true };
}

export function queueRemove(root, taskId, { queueId = null } = {}) {
  const queue = loadQueue(root, queueId);
  const before = queue.items.length;
  queue.items = queue.items.filter((item) => item.id !== taskId);
  const removed = before !== queue.items.length;
  if (removed) saveQueue(root, queue);
  return { queue, removed };
}

export function queueClear(root, { queueId = null } = {}) {
  const queue = loadQueue(root, queueId);
  const removed = queue.items.length;
  queue.items = [];
  saveQueue(root, queue);
  return { queue, removed };
}

export function queueIds(root, queueId = null) {
  return loadQueue(root, queueId).items.map((item) => item.id);
}

export function queueList(root, { includeArchived = false } = {}) {
  const book = loadQueueBook(root);
  return Object.values(book.queues).filter((queue) => includeArchived || !queue.archived_at);
}

export function queueCreate(root, id, { name = id, policy = {}, provider = null } = {}) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(String(id || ""))) throw new QueueError("queue id must be 1-32 letters, numbers, _ or -");
  const book = loadQueueBook(root);
  if (book.queues[id]) throw new QueueError(`Queue "${id}" already exists`);
  book.queues[id] = normalizeQueue({ id, name, policy, provider }, id);
  saveQueueBook(root, book);
  return book.queues[id];
}

export function queueSetActive(root, id) {
  const book = loadQueueBook(root);
  const queue = book.queues[id];
  if (!queue || queue.archived_at) throw new QueueError(`Cannot activate unknown or archived queue "${id}"`);
  book.active_queue = id;
  saveQueueBook(root, book);
  return queue;
}

export function queueArchive(root, id) {
  const book = loadQueueBook(root);
  const queue = book.queues[id];
  if (!queue) throw new QueueError(`Unknown queue "${id}"`);
  if (id === DEFAULT_QUEUE_ID) throw new QueueError("The default queue cannot be archived");
  queue.archived_at = now();
  queue.status = "archived";
  if (book.active_queue === id) book.active_queue = DEFAULT_QUEUE_ID;
  saveQueueBook(root, book);
  return queue;
}

export function queueRename(root, id, name) {
  const label = String(name || "").trim();
  if (!label) throw new QueueError("queue rename needs a non-empty name");
  const book = loadQueueBook(root);
  const queue = book.queues[id];
  if (!queue) throw new QueueError(`Unknown queue "${id}"`);
  if (queue.archived_at) throw new QueueError(`Cannot rename archived queue "${id}"`);
  queue.name = label;
  queue.updated_at = now();
  saveQueueBook(root, book);
  return queue;
}

// Reorder within one queue's membership. Position is clamped, so a stale TUI
// index can never silently drop an item.
export function queueReorder(root, taskId, position, { queueId = null } = {}) {
  const queue = loadQueue(root, queueId);
  const from = queue.items.findIndex((item) => item.id === taskId);
  if (from < 0) throw new QueueError(`"${taskId}" is not in queue "${queue.queue_id}"`);
  const to = Math.max(0, Math.min(queue.items.length - 1, Number(position)));
  const [item] = queue.items.splice(from, 1);
  queue.items.splice(to, 0, item);
  saveQueue(root, queue);
  return queue;
}

export function queuePause(root, id) {
  const book = loadQueueBook(root);
  const queue = book.queues[id];
  if (!queue) throw new QueueError(`Unknown queue "${id}"`);
  if (queue.archived_at) throw new QueueError(`Cannot pause archived queue "${id}"`);
  queue.status = "paused";
  queue.updated_at = now();
  saveQueueBook(root, book);
  return queue;
}

export function queueResume(root, id) {
  const book = loadQueueBook(root);
  const queue = book.queues[id];
  if (!queue) throw new QueueError(`Unknown queue "${id}"`);
  if (queue.archived_at) throw new QueueError(`Cannot resume archived queue "${id}"`);
  queue.status = "idle";
  queue.updated_at = now();
  saveQueueBook(root, book);
  return queue;
}

// One joined, read-only view of a queue and its task records: the TUI and CLI
// inspect through this instead of re-reading state and queue files separately.
export function queueInspect(root, id = null) {
  const book = loadQueueBook(root);
  const queueId = id || book.active_queue || DEFAULT_QUEUE_ID;
  const queue = book.queues[queueId];
  if (!queue) throw new QueueError(`Unknown queue "${queueId}"`);
  let tasks = {};
  try { tasks = JSON.parse(fs.readFileSync(paths(root).state, "utf8")).tasks || {}; } catch { /* an unreadable state leaves the queue inspectable */ }
  return {
    queue,
    active_queue: book.active_queue,
    tasks: queue.items.map((item) => {
      const task = tasks[item.id];
      return {
        id: item.id,
        title: task?.title || "(unknown task)",
        status: task?.status || "unknown",
        priority: task?.priority || "normal",
        assigned_worker: task?.assigned_worker || null,
        added_at: item.added_at,
        added_by: item.added_by || null,
      };
    }),
  };
}
