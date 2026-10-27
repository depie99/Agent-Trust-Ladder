import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addEvidence, createTask, emptyState, paths, saveState, transition, loadState } from "../runtime/lib/state.mjs";
import { autoRecoverBlockedTask, unblockTask, approveTask, explainTasks } from "../runtime/lib/recovery.mjs";
import { queueIds } from "../runtime/lib/queue.mjs";
import { wakeActions } from "../runtime/lib/render.mjs";
import { recordBlocker, repairBlocker } from "../runtime/lib/queue-recovery.mjs";
import { prepareInputs } from "../runtime/lib/handoffs.mjs";

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

const legacyState = emptyState();
const legacyPredecessor = createTask(legacyState, { title: "Legacy predecessor" });
legacyPredecessor.status = "done";
const legacyConsumer = createTask(legacyState, { title: "Dependent task" });
legacyConsumer.status = "blocked";
legacyConsumer.assigned_worker = "rowan";
legacyConsumer.plan_depends_on = [legacyPredecessor.id];
legacyConsumer.blocker = { cause: "handoff", reason: "missing handoff" };
saveState(root, legacyState);
const legacyPreflight = prepareInputs(root, legacyConsumer, legacyState.tasks);
assert.equal(legacyPreflight.recovery_owner, "owner");
assert.match(legacyPreflight.reason, /revalidate.*Increasing the session budget/i);
assert.throws(() => unblockTask(root, legacyConsumer.id), /no valid verified handoff/);
assert.equal(loadState(root).tasks[legacyConsumer.id].status, "blocked");

// Pre-handoff runners recorded this as an execution error, sometimes only in
// the recovery projection. Neither persisted shape may bypass input validation.
for (const separator of ["/", "\\"]) {
  const reason = `ENOENT: no such file or directory, open 'workspace${separator}.trust${separator}manager${separator}handoffs${separator}${legacyPredecessor.id}.json'`;
  for (const source of ["blocker", "recovery"]) {
    legacyConsumer.blocker = { cause: "execution", reason: "runner stopped" };
    legacyConsumer.recovery = { cause: "execution", reason: "runner stopped", status: "exhausted", attempts: [] };
    legacyConsumer[source].reason = reason;
    saveState(root, legacyState);
    assert.throws(() => unblockTask(root, legacyConsumer.id), /no valid verified handoff/);
    const persisted = loadState(root).tasks[legacyConsumer.id];
    assert.equal(persisted.status, "blocked");
    assert.equal(persisted[source].reason, reason, "rejected recovery preserves the original blocker");
  }
}

// Mira may retry a transient blocker once, but must not retry a capability or
// authority failure under the same restricted identity.
const transientState = emptyState();
const transientTask = createTask(transientState, { title: "Retry a transient worker failure" });
transientTask.objective = "the worker gets one bounded retry";
transientTask.completion_checks = ["the transient dependency is retried"];
transientTask.assigned_worker = "rowan";
transition(transientState, transientTask.id, "triaged", { actor: "manager", note: "packet ready" });
transition(transientState, transientTask.id, "assigned", { actor: "manager", note: "rowan owns it" });
transientTask.blocker = { reason: "temporary dependency", since: new Date().toISOString(), actor: "rowan" };
transition(transientState, transientTask.id, "blocked", { actor: "rowan", note: "temporary dependency" });
saveState(root, transientState);
assert.equal(autoRecoverBlockedTask(root, transientTask.id, { maxRecoveries: 1 }).kind, "repair-required", "an unchanged failure cannot retry without a successful repair preflight");
recordBlocker(transientTask, { cause: "dependency", reason: "temporary dependency" }); saveState(root, transientState);
await repairBlocker(root, transientTask.id, {
  action: "prepare-local-dependency",
  remedy: () => { fs.writeFileSync(path.join(root, "dependency.ready"), "ready"); return { artifact: "dependency.ready" }; },
  preflight: () => ({ ready: fs.existsSync(path.join(root, "dependency.ready")) }),
});
const auto = autoRecoverBlockedTask(root, transientTask.id, { maxRecoveries: 1 });
assert.equal(auto.recovered, true, "Mira auto-recovers a transient blocker");
assert.equal(loadState(root).tasks[transientTask.id].status, "assigned");
assert.equal(loadState(root).tasks[transientTask.id].auto_recovery_count, 1);
console.log("PASS: Mira retries one transient blocker through the normal assignment gate");

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

// Owner gate in one word: approve records durable approval evidence, clears an
// approval blocker, and queues the task for the next launch.
const gateState = emptyState();
const gateTask = createTask(gateState, { title: "Run the capped unattended smoke", risk: "risky" });
gateTask.objective = "A real capped run happens only with the owner's recorded approval.";
gateTask.completion_checks = ["the capped run shows an approval in evidence"];
gateTask.assigned_worker = "rowan";
transition(gateState, gateTask.id, "triaged", { actor: "manager", note: "packet ready" });
transition(gateState, gateTask.id, "assigned", { actor: "manager", note: "rowan owns it" });
gateTask.blocker = { reason: "Owner approval for the real capped run is missing.", since: new Date().toISOString(), actor: "rowan" };
transition(gateState, gateTask.id, "blocked", { actor: "rowan", note: "owner gate" });
saveState(root, gateState);

assert.equal(explainTasks(root, gateTask.id)[0].kind, "owner-approval", "an approval-gate blocker is recognized");
assert.match(explainTasks(root, gateTask.id)[0].fix, /atl approve/, "the fix names the approve command");

const approved = approveTask(root, gateTask.id, { note: "doc-only task, 60m and one session" });
assert.equal(approved.task.status, "assigned", "approval clears the blocker back to assigned");
assert.equal(approved.task.blocker, null);
assert.equal(approved.queued, true, "approval queues the task");
const gateAfter = loadState(root).tasks[gateTask.id];
assert.ok(
  gateAfter.evidence.some((e) => e.kind === "approval" && e.result === "approved" && /doc-only task/.test(e.detail)),
  "the approval stays on the record as evidence",
);
assert.ok(queueIds(root).includes(gateTask.id), "the approved task is in the execution queue");

// A plain (non-approval) blocker still points at unblock, and explainTasks
// reflects queue membership in the fix hint.
const plainState = emptyState();
const plainTask = createTask(plainState, { title: "Refresh the user install" });
plainTask.objective = "Needs a runner with write access.";
plainTask.completion_checks = ["the install matches the repo"];
plainTask.assigned_worker = "rowan";
transition(plainState, plainTask.id, "triaged", { actor: "manager", note: "packet ready" });
transition(plainState, plainTask.id, "assigned", { actor: "manager", note: "rowan owns it" });
plainTask.blocker = { reason: "the managed sandbox identity has only ReadAndExecute access to the install dir", since: new Date().toISOString(), actor: "rowan" };
transition(plainState, plainTask.id, "blocked", { actor: "rowan", note: "environment wall" });
saveState(root, plainState);

const plainRow = explainTasks(root, plainTask.id)[0];
assert.equal(plainRow.kind, "human-action", "an access blocker is classified as human action");
assert.match(plainRow.fix, /manager action required.*atl unblock/, "its fix names the required authority change and follow-up");
assert.equal(plainRow.why, plainTask.blocker.reason, "the why carries the full blocker text, never truncated");
assert.equal(autoRecoverBlockedTask(root, plainTask.id, { maxRecoveries: 1 }).kind, "human-action");

// Approving an already-active task still records the word and keeps the queue honest.
const preApproved = approveTask(root, gateTask.id, { note: "second approval is harmless" });
assert.equal(preApproved.task.status, "assigned");
assert.equal(preApproved.queued, false, "re-approval does not duplicate the queue entry");

// Waiting tasks explain the exact hop they are stuck at.
const waitRow = explainTasks(root).find((r) => r.task.id === gateTask.id);
assert.equal(waitRow.kind, "waiting");
assert.match(waitRow.fix, /launch --confirm/, "a queued assigned task points at the launch");
assert.doesNotMatch(waitRow.fix, /queue add/, "no queue add hint for a task already queued");

console.log("PASS: owner approve records durable evidence, clears the gate, and queues the task");

const interruptedState = emptyState();
const interruptedTask = createTask(interruptedState, { title: "Interrupted worker" });
interruptedTask.status = "in_progress";
saveState(root, interruptedState);
const runDir = path.join(root, ".trust", "manager", "overnight");
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ status: "interrupted", interruptedTaskId: interruptedTask.id }));
const interruptedRow = explainTasks(root, interruptedTask.id)[0];
assert.equal(interruptedRow.kind, "interrupted");
assert.match(interruptedRow.why, /interrupted/);
assert.doesNotMatch(interruptedRow.why, /live transcript/);
console.log("PASS: interrupted worker is not reported as live");
