import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import {
  DEFAULT_QUEUE_ID, loadQueue, loadQueueBook, migrateQueueStore, queueAdd,
  queueArchive, queueCreate, queueList, queueSetActive, saveQueueBook,
} from "../runtime/lib/queue.mjs";
import { createControlPlaneSnapshot } from "../runtime/lib/control-plane.mjs";
import { listNotifications, notificationUnreadCount, postNotification, updateNotification } from "../runtime/lib/notifications.mjs";
import { latestUsage, loadUsage, recordUsage } from "../runtime/lib/usage.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-control-plane-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
saveState(root, state);

// Legacy v1 queue files migrate once, preserve membership, and leave a backup.
const queueFile = path.join(root, ".trust", "manager", "queue.json");
fs.writeFileSync(queueFile, JSON.stringify({ version: 1, updated_at: "2026-01-01T00:00:00.000Z", items: [{ id: "T-001", added_by: "manager" }] }) + "\n");
const migrated = migrateQueueStore(root);
assert.equal(migrated.migrated, true, "legacy queue migrates");
assert.ok(migrated.backup && fs.existsSync(migrated.backup), "legacy queue receives a backup");
assert.equal(loadQueue(root).version, 2, "queue is version 2 after migration");
assert.deepEqual(loadQueue(root).items.map((item) => item.id), ["T-001"], "legacy membership survives");
assert.equal(migrateQueueStore(root).migrated, false, "migration is idempotent");

queueCreate(root, "release", { name: "Release" });
queueSetActive(root, "release");
queueAdd(root, "T-002", { by: "manager" });
assert.equal(loadQueueBook(root).active_queue, "release", "active queue is persisted");
assert.deepEqual(loadQueue(root, "release").items.map((item) => item.id), ["T-002"], "named queue isolates membership");
assert.equal(queueList(root).length, 2, "both queues are listed");
queueSetActive(root, DEFAULT_QUEUE_ID);
queueArchive(root, "release");
assert.equal(queueList(root).length, 1, "archived queue leaves active list");

const notification = postNotification(root, { severity: "warning", title: "Budget", message: "Queue is near its session budget", queueId: DEFAULT_QUEUE_ID });
assert.equal(notificationUnreadCount(root), 1, "notification is unread");
assert.equal(updateNotification(root, notification.id, { state: "acknowledged" }).state, "acknowledged", "notification can be acknowledged");
assert.equal(listNotifications(root, { state: "unread" }).length, 0, "acknowledged notification leaves unread view");

recordUsage(root, { provider: "codex", model: "gpt-5.6-luna", source: "session-log", status: "observed", confidence: "medium", used: { input: 100, output: 25 }, remaining: null, detail: "remote quota unavailable" });
assert.equal(latestUsage(root).source, "session-log", "usage snapshot is persisted with source");
assert.equal(loadUsage(root).snapshots.length, 1, "usage history is bounded data");

const snapshot = createControlPlaneSnapshot(root);
assert.equal(snapshot.version, 1, "control-plane version is explicit");
assert.equal(snapshot.queues.items.length, 1, "snapshot exposes active queues");
assert.equal(snapshot.notifications.items.length, 1, "snapshot exposes notification history");
assert.equal(snapshot.usage.latest.provider, "codex", "snapshot exposes latest usage");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: control-plane contracts — queue migration, named queues, notifications, usage, snapshot");
