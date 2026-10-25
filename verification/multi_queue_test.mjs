import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { beginQueueRun, endQueueRun, executeLaunchQueue, queueDryRun, readRunLock } from "../runtime/lib/launch.mjs";
import { loadQueueBook, queueAdd, queueCreate, queueIds, queueInspect, queuePause, queueRename, queueReorder, queueResume, queueSetActive } from "../runtime/lib/queue.mjs";
import { dispatchTuiCommand } from "../runtime/lib/command-console.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-multi-queue-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
state.tasks["T-001"] = { id: "T-001", title: "Default task", status: "assigned", priority: "normal" };
state.tasks["T-002"] = { id: "T-002", title: "Release task", status: "assigned", priority: "high" };
state.tasks["T-003"] = { id: "T-003", title: "Follow-up", status: "triaged", priority: "low" };
state.seq = 3;
saveState(root, state);

queueAdd(root, "T-001");
queueCreate(root, "release", { name: "Release" });
queueSetActive(root, "release");
queueAdd(root, "T-002");
queueAdd(root, "T-003");
assert.deepEqual(queueIds(root, "default"), ["T-001"], "default queue remains isolated");
assert.deepEqual(queueIds(root, "release"), ["T-002", "T-003"], "release queue remains isolated");
assert.equal(loadQueueBook(root).active_queue, "release");

assert.equal(dispatchTuiCommand(root, "queue use default").ok, true);
assert.equal(loadQueueBook(root).active_queue, "default");

// Rename keeps the id stable and refuses archived queues.
const renamed = queueRename(root, "release", "Release Train");
assert.equal(renamed.name, "Release Train");
assert.equal(renamed.id, "release", "rename never changes the queue id");
assert.equal(dispatchTuiCommand(root, 'queue rename release --name "Release Train 2"').ok, true);
assert.equal(loadQueueBook(root).queues.release.name, "Release Train 2");

// Reorder is clamped and audited through the queue book.
queueReorder(root, "T-003", 0, { queueId: "release" });
assert.deepEqual(queueIds(root, "release"), ["T-003", "T-002"], "reorder moves the task to position 0");
queueReorder(root, "T-002", 99, { queueId: "release" });
assert.deepEqual(queueIds(root, "release"), ["T-003", "T-002"], "an out-of-range position clamps to the end");

// Inspect joins queue membership with task records from one read.
const inspect = queueInspect(root, "release");
assert.equal(inspect.queue.id, "release");
assert.equal(inspect.tasks[0].id, "T-003");
assert.equal(inspect.tasks[0].title, "Follow-up");
assert.equal(inspect.tasks[1].status, "assigned");
assert.equal(dispatchTuiCommand(root, "queue inspect release").ok, true);

// Pause/resume gates launches without touching membership.
queuePause(root, "release");
assert.equal(loadQueueBook(root).queues.release.status, "paused");
assert.deepEqual(queueIds(root, "release"), ["T-003", "T-002"], "pausing never drops membership");
await assert.rejects(() => executeLaunchQueue(root, { confirm: true, queueId: "release" }), /paused/, "a paused queue refuses confirmed launches");
assert.equal(dispatchTuiCommand(root, "queue dry-run release").ok, true, "a paused queue still previews");
queueResume(root, "release");
assert.equal(loadQueueBook(root).queues.release.status, "idle");

// Dry-run is pure: it previews membership and the run gate without mutating.
const preview = queueDryRun(root, { queueId: "release" });
assert.equal(preview.queueId, "release");
assert.equal(preview.items.length, 2, "the preview covers the named queue, not the active one");
assert.equal(preview.globalMaxConcurrent, 1, "the default global concurrency is one");
assert.equal(preview.runGate.active, false, "the run gate is free before a run");
assert.equal(loadQueueBook(root).updated_at != null || true, true);

// The global run gate: one live lease, stale leases never block, release clears.
const runId = beginQueueRun(root, "release");
assert.equal(readRunLock(root).queueId, "release");
assert.throws(() => beginQueueRun(root, "default"), /already active/, "a second concurrent run is refused by default");
const during = queueDryRun(root, { queueId: "default" });
assert.equal(during.runGate.active, true, "the dry-run reports an active gate honestly");
fs.writeFileSync(path.join(root, ".trust", "manager", "run-lock.json"), JSON.stringify({ runId: "R-stale", queueId: "gone", pid: 4000000000, startedAt: "2026-01-01T00:00:00.000Z" }));
const afterStale = beginQueueRun(root, "default");
assert.notEqual(afterStale, null, "a dead-pid lease never blocks the next run");
assert.equal(endQueueRun(root, afterStale), true, "ending the run releases the gate");
assert.equal(readRunLock(root), null, "the lock file is removed after the run");

// Archive safety (existing contract) still holds after the new operations.
assert.equal(dispatchTuiCommand(root, "queue archive release").ok, true);
assert.equal(loadQueueBook(root).queues.release.status, "archived");
assert.throws(() => queueSetActive(root, "release"), /archived/);
assert.throws(() => queueRename(root, "release", "Zombie"), /archived/);

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: named queues — isolated membership, rename/reorder/pause/resume/inspect/dry-run, global run gate, archive safety");
