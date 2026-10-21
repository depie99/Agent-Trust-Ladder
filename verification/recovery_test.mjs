import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addEvidence, createTask, emptyState, paths, saveState, transition, loadState } from "../runtime/lib/state.mjs";
import { unblockTask } from "../runtime/lib/recovery.mjs";
import { wakeActions } from "../runtime/lib/render.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-recovery-"));
fs.mkdirSync(path.dirname(paths(root).state), { recursive: true });

const state = emptyState();
const task = createTask(state, { title: "Recover a worker task" });
task.objective = "The task can resume after its external dependency is ready.";
task.completion_checks = ["the worker can produce evidence"];
task.assigned_worker = "rowan";
transition(state, task.id, "triaged", { actor: "manager", note: "packet ready" });
transition(state, task.id, "assigned", { actor: "manager", note: "rowan owns it" });
task.blocker = { reason: "temporary dependency", since: new Date().toISOString(), actor: "rowan" };
task.next_wake_at = new Date(Date.now() + 60_000).toISOString();
transition(state, task.id, "blocked", { actor: "manager", note: "temporary dependency" });
saveState(root, state);

const result = unblockTask(root, task.id, { note: "dependency is ready" });
assert.equal(result.to, "assigned", "a known worker returns directly to assigned");
assert.equal(result.worker, "rowan");
const recovered = loadState(root).tasks[task.id];
assert.equal(recovered.status, "assigned");
assert.equal(recovered.blocker, null);
assert.equal(recovered.next_wake_at, null);
assert.match(loadState(root).log.at(-1).detail, /recovered for rowan/);

console.log("PASS: blocked task recovery clears the blocker and restores the assigned gate");

// Review verdicts select the corresponding return gate: a requested change
// goes back to the builder, while verification requires an approval.
const reviewState = emptyState();
const reviewTask = createTask(reviewState, { title: "Review routing" });
reviewTask.objective = "review routing is explicit";
reviewTask.completion_checks = ["the route is observable"];
reviewTask.assigned_worker = "rowan";
reviewTask.workspace = path.join(root, "workspace");
transition(reviewState, reviewTask.id, "triaged", { actor: "manager", note: "packet ready" });
transition(reviewState, reviewTask.id, "assigned", { actor: "manager", note: "rowan owns it" });
transition(reviewState, reviewTask.id, "in_progress", { actor: "rowan", note: "building" });
addEvidence(reviewState, reviewTask.id, { kind: "check", check: reviewTask.completion_checks[0], result: "pass", detail: "observed" }, "rowan");
transition(reviewState, reviewTask.id, "in_review", { actor: "rowan", note: "handoff" });
addEvidence(reviewState, reviewTask.id, { kind: "review", result: "changes-requested", detail: "tighten the check" }, "sage");
transition(reviewState, reviewTask.id, "in_progress", { actor: "sage", note: "changes requested" });
assert.equal(reviewTask.status, "in_progress");

console.log("PASS: review changes-requested returns to the builder without requiring approval");

const wakeState = { tasks: {
  "T-OWNER": {
    id: "T-OWNER", title: "owner gate", status: "blocked", priority: "normal",
    blocker: { reason: "Owner approval for the real capped run is missing" },
    updated_at: new Date().toISOString(), attempt_count: 0,
  },
} };
assert.equal(wakeActions(wakeState, { budgets: {} })[0].for, "manager");
console.log("PASS: human-owned blockers are routed to the manager in wake");

assert.throws(
  () => addEvidence(reviewState, reviewTask.id, { kind: "check", check: "not a real completion check", result: "pass" }, "rowan"),
  /copy one completion check verbatim/,
);
console.log("PASS: unknown evidence checks are rejected before they poison state validation");
