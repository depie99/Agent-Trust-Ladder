import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { activeTasks } from "../runtime/lib/render.mjs";
import { createTask, emptyState, loadState, saveState, transition } from "../runtime/lib/state.mjs";
import { queueAdd, queueIds } from "../runtime/lib/queue.mjs";
import { archiveTask, createTaskInWorkspace, editTaskInWorkspace, restoreTask } from "../runtime/lib/task-workspace.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-task-workspace-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());

const task = createTaskInWorkspace(root, { title: "Write the control plane", priority: "high", labels: ["tui"] });
assert.equal(task.status, "new", "new task starts at the lifecycle entry");
editTaskInWorkspace(root, task.id, { objective: "Make every manager action observable", completion_checks: ["TUI renders the blocker without clipping"] });
assert.equal(loadState(root).tasks[task.id].objective, "Make every manager action observable", "editable fields persist");
assert.deepEqual(loadState(root).tasks[task.id].completion_checks, ["TUI renders the blocker without clipping"], "checks persist");

queueAdd(root, task.id, { by: "manager" });
assert.deepEqual(queueIds(root), [task.id], "task can be queued before archive");
const archived = archiveTask(root, task.id, { note: "superseded by the 017 control plane" });
assert.equal(archived.task.status, "archived", "archive is an explicit lifecycle state");
assert.equal(archived.removed, 1, "archiving removes active queue membership");
assert.deepEqual(queueIds(root), [], "archived work is not launchable");
assert.equal(activeTasks(loadState(root)).some((item) => item.id === task.id), false, "archived work leaves active views");

const restored = restoreTask(root, task.id);
assert.equal(restored.status, "new", "restore returns the task to a safe intake state");
assert.equal(restored.archived_at, null, "restore clears archive metadata");
assert.equal(activeTasks(loadState(root)).some((item) => item.id === task.id), true, "restored work returns to active views");

const liveState = loadState(root);
const live = createTask(liveState, { title: "Active session cannot be deleted" });
live.objective = "preserve the run truth";
live.completion_checks = ["run remains truthful"];
transition(liveState, live.id, "triaged", { actor: "manager", note: "test" });
live.assigned_worker = "rowan";
transition(liveState, live.id, "assigned", { actor: "manager", note: "test" });
transition(liveState, live.id, "in_progress", { actor: "rowan", note: "test" });
saveState(root, liveState);
assert.throws(() => archiveTask(root, live.id), /stop or complete/, "active sessions require an explicit stop before archive");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: task workspace — create/edit/archive/restore, queue cleanup, active-run safety");
