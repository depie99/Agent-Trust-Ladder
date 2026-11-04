// Bounded sequential batch: runtime and portable checkpoints share one state
// machine. All failure injection is local; no provider is called.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, createTask, saveState, loadState } from "../runtime/lib/state.mjs";
import { startBatch, runBatch, readBatch, writeBatch, reconcileBatch, resumeStoppedBatch, stopBatchRun, batchMorningSummary, listBatches } from "../runtime/lib/batch-runner.mjs";
import { createBatch, claimBatchItem, settleBatchItem, requeueBatchItem, batchSummary, validateBatch, sealBatch, nextBatchItem } from "../skills/atl/scripts/batch-runner.mjs";

const dirs = [];
const root = (label) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), `atl-batch-${label}-`)); dirs.push(dir); return dir; };
const workspace = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-batch-ws-")); dirs.push(dir); fs.writeFileSync(path.join(dir, "value.txt"), "ok\n"); return dir; };
const scope = (dir, tasks) => {
  const state = emptyState();
  for (const id of tasks) {
    const task = createTask(state, { title: `Task ${id}` });
    task.status = "assigned";
    task.workspace = workspace();
    task.objective = `finish ${id}`;
  }
  saveState(dir, state);
  return Object.keys(state.tasks);
};

try {
  // A) one clean success, one bounded repair, one genuine blocker.
  const rootA = root("mixed");
  const idsA = scope(rootA, ["a1", "a2", "a3"]);
  const [clean, repairable, blocked] = idsA;
  const calls = new Map();
  const launchA = async (_dir, { taskIds }) => {
    const id = taskIds[0];
    calls.set(id, (calls.get(id) || 0) + 1);
    const state = loadState(rootA);
    if (id === clean) state.tasks[id].status = "done";
    if (id === repairable && calls.get(id) === 1) state.tasks[id].status = "in_progress";
    if (id === repairable && calls.get(id) > 1) state.tasks[id].status = "done";
    if (id === blocked) {
      state.tasks[id].status = "blocked";
      state.tasks[id].blocker = { reason: "product decision required" };
      state.tasks[id].recovery = { status: "waiting", recovery_owner: "owner", reason: "product decision required" };
    }
    saveState(rootA, state);
    return { status: id === clean || (id === repairable && calls.get(id) > 1) ? "completed" : "blocked", reason: id === blocked ? "product decision required" : "bounded" };
  };
  const started = startBatch(rootA, { id: "mixed", tasks: idsA, limits: { max_minutes: 30, max_attempts: 2, max_sessions: 4 } });
  assert.equal(started.concurrency, 1);
  assert.ok(started.items.every((item) => item.readiness.ready));
  assert.throws(() => startBatch(rootA, { id: "mixed", tasks: idsA }), /already active/, "a second concurrent launch of the same batch is refused");

  const runA = await runBatch(rootA, "mixed", { launch: launchA, onProgress: () => {} });
  assert.equal(runA.status, "complete");
  assert.equal(runA.progress.succeeded, 2);
  assert.equal(runA.progress.blocked, 1);
  assert.equal(calls.get(repairable), 2, "a repairable failure is retried within the attempt limit");
  assert.equal(calls.get(blocked), 1, "a genuine blocker is not retried");
  assert.equal(runA.items.find((item) => item.task === blocked).reason, "product decision required");
  const morning = batchMorningSummary(rootA, "mixed");
  assert.ok(fs.existsSync(morning.files.json));
  assert.ok(fs.existsSync(morning.files.markdown));
  assert.match(morning.markdown, /Boundary/);
  assert.match(morning.markdown, /must stay available/);
  assert.ok(morning.summary.receipts.length >= 2, "the morning summary links a receipt per succeeded task");
  assert.ok(morning.summary.receipts.every((receipt) => receipt.path && receipt.verdict?.status), "receipt links carry a verdict");
  assert.match(morning.summary.human_decision.task, new RegExp(blocked));

  // B) interruption after an in-flight session; no replay, owner reconciliation first.
  const rootB = root("interrupt");
  const idsB = scope(rootB, ["b1", "b2"]);
  const [firstB, secondB] = idsB;
  let b1Calls = 0;
  const launchB = async (_dir, { taskIds }) => {
    const id = taskIds[0];
    if (id === firstB) { b1Calls += 1; const state = loadState(rootB); state.tasks[id].status = "done"; saveState(rootB, state); return { status: "completed" }; }
    void secondB;
    throw new Error("provider connection lost after session start");
  };
  startBatch(rootB, { id: "interrupt", tasks: idsB, limits: { max_minutes: 30, max_attempts: 2 } });
  const runB = await runBatch(rootB, "interrupt", { launch: launchB, onProgress: () => {} });
  assert.equal(runB.status, "recovery_required");
  assert.match(runB.stop_reason, /interrupted while running/);
  const checkpointB = readBatch(rootB, "interrupt");
  assert.equal(checkpointB.items.find((item) => item.task === secondB).status, "needs_reconciliation");
  await assert.rejects(() => runBatch(rootB, "interrupt", { launch: launchB }), /reconciliation/);
  assert.equal(b1Calls, 1, "completed work is never replayed after an interruption");
  assert.equal(loadState(rootB).tasks[secondB].status !== "done", true, "the uncertain side effect is not repeated automatically");
  assert.throws(() => resumeStoppedBatch(rootB, "interrupt"), /reconcile in-flight items/);

  // Crash path: a checkpoint left with a running item reconciles conservatively.
  const rootC = root("crash");
  const idsC = scope(rootC, ["c1"]);
  startBatch(rootC, { id: "crash", tasks: idsC, limits: { max_minutes: 30, max_attempts: 1 } });
  writeBatch(rootC, claimBatchItem(readBatch(rootC, "crash"), idsC[0], { holder: "dead-runner" }));
  const reconciled = reconcileBatch(rootC, "crash");
  assert.equal(reconciled.items[0].status, "needs_reconciliation");
  assert.equal(reconciled.status, "recovery_required");

  // C) deadline stops new work and every item has a terminal status.
  const rootD = root("deadline");
  const base = Date.now();
  const idsD = scope(rootD, ["d1", "d2"]);
  let clock = base;
  const launchD = async (_dir, { taskIds }) => {
    const state = loadState(rootD); state.tasks[taskIds[0]].status = "done"; saveState(rootD, state);
    clock = base + 90 * 60 * 1000;
    return { status: "completed" };
  };
  startBatch(rootD, { id: "deadline", tasks: idsD, limits: { max_minutes: 1, max_attempts: 1 }, now: base });
  const runD = await runBatch(rootD, "deadline", { launch: launchD, now: () => clock, onProgress: () => {} });
  assert.equal(runD.status, "complete");
  assert.equal(runD.progress.skipped, 1);
  assert.equal(runD.items.find((item) => item.task === idsD[1]).status, "skipped");
  assert.match(runD.stop_reason, /deadline/);

  // D) the attempt limit survives a restart and a resumed run.
  const rootE = root("attempts");
  const idsE = scope(rootE, ["e1"]);
  let e1Calls = 0;
  const launchE = async () => { e1Calls += 1; return { status: "blocked", reason: "transient provider failure" }; };
  startBatch(rootE, { id: "attempts", tasks: idsE, limits: { max_minutes: 30, max_attempts: 1 } });
  const runE = await runBatch(rootE, "attempts", { launch: launchE, onProgress: () => {} });
  assert.equal(e1Calls, 1, "a max-attempts-1 item is dispatched exactly once");
  assert.equal(runE.items[0].status, "failed");
  assert.equal(runE.items[0].attempts, 1);
  assert.throws(() => resumeStoppedBatch(rootE, "attempts"), /complete/, "a finished batch is not resumed");
  assert.equal(e1Calls, 1, "the persisted attempt record prevents a re-dispatch");

  const rootE2 = root("attempts-two");
  const idsE2 = scope(rootE2, ["e2"]);
  let e2Calls = 0;
  const launchE2 = async () => { e2Calls += 1; return { status: "blocked", reason: "transient provider failure" }; };
  startBatch(rootE2, { id: "attempts-two", tasks: idsE2, limits: { max_minutes: 30, max_attempts: 2 } });
  const runE2 = await runBatch(rootE2, "attempts-two", { launch: launchE2, onProgress: () => {} });
  assert.equal(e2Calls, 2, "a bounded retry stops at the recorded attempt limit");
  assert.equal(runE2.items[0].status, "failed");
  assert.equal(runE2.items[0].attempts, 2);

  // E) a malformed or forged checkpoint fails closed.
  const forged = structuredClone(readBatch(rootA, "mixed"));
  forged.items[0].status = "pending";
  forged.items[0].attempts += 1;
  assert.equal(validateBatch(forged).ok, false);
  assert.match(validateBatch(forged).reason, /hash/);
  assert.equal(batchSummary(forged).complete, false);
  assert.equal(listBatches(rootA).find((batch) => batch.id === "mixed").valid, true);

  // F) portable and runtime checkpoints reach the same outcome for one fixture.
  const portable = createBatch({ id: "parity", tasks: ["p1", "p2"], limits: { max_minutes: 30, max_attempts: 2 }, now: base });
  let portableState = claimBatchItem(portable, "p1", { now: base });
  portableState = settleBatchItem(portableState, "p1", { status: "succeeded", reason: "task reached done", now: base });
  portableState = claimBatchItem(portableState, "p2", { now: base });
  portableState = settleBatchItem(portableState, "p2", { status: "failed", reason: "no verified result", now: base });
  portableState = requeueBatchItem(portableState, "p2", { reason: "bounded retry after: no verified result", now: base });
  portableState = claimBatchItem(portableState, "p2", { now: base });
  portableState = settleBatchItem(portableState, "p2", { status: "succeeded", reason: "task reached done", now: base });
  const portableSummary = batchSummary(portableState);
  assert.equal(portableSummary.status, "complete");
  assert.deepEqual(portableSummary.items.map((item) => [item.task, item.status, item.attempts]), [["p1", "succeeded", 1], ["p2", "succeeded", 2]]);
  assert.match(nextBatchItem(portableState, { now: base }).reason, /complete/);
  assert.equal(validateBatch(sealBatch(portableState)).ok, true);

  const rootF = root("parity");
  const idsF = scope(rootF, ["f1", "f2"]);
  let f2Calls = 0;
  const launchF = async (_dir, { taskIds }) => {
    const id = taskIds[0];
    if (id === idsF[1]) f2Calls += 1;
    if (id === idsF[1] && f2Calls === 1) return { status: "blocked", reason: "no verified result" };
    const state = loadState(rootF); state.tasks[id].status = "done"; saveState(rootF, state);
    return { status: "completed" };
  };
  startBatch(rootF, { id: "parity", tasks: idsF, limits: { max_minutes: 30, max_attempts: 2 } });
  const runF = await runBatch(rootF, "parity", { launch: launchF, onProgress: () => {} });
  assert.equal(runF.status, "complete");
  assert.deepEqual(runF.items.map((item) => [item.task, item.status, item.attempts]), [[idsF[0], "succeeded", 1], [idsF[1], "succeeded", 2]]);

  // G) an owner stop before dispatch is resumable without losing the scope.
  const rootG = root("stop");
  const idsG = scope(rootG, ["g1", "g2"]);
  startBatch(rootG, { id: "stop", tasks: idsG, limits: { max_minutes: 30, max_attempts: 1 } });
  const stopped = stopBatchRun(rootG, "stop", { reason: "owner stopped the batch" });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.items[0].status, "pending");
  assert.equal(resumeStoppedBatch(rootG, "stop").status, "running");
  const launchG = async (_dir, { taskIds }) => { const state = loadState(rootG); state.tasks[taskIds[0]].status = "done"; saveState(rootG, state); return { status: "completed" }; };
  const runG = await runBatch(rootG, "stop", { launch: launchG, onProgress: () => {} });
  assert.equal(runG.status, "complete");
  assert.equal(runG.progress.succeeded, 2, "a resumed batch completes the untouched scope");

  // H) in-flight work is never silently discarded by a stop.
  const rootH = root("stop-inflight");
  const idsH = scope(rootH, ["h1", "h2"]);
  startBatch(rootH, { id: "stop-inflight", tasks: idsH, limits: { max_minutes: 30, max_attempts: 1 } });
  writeBatch(rootH, claimBatchItem(readBatch(rootH, "stop-inflight"), idsH[0], { holder: "runner" }));
  const stoppedInFlight = stopBatchRun(rootH, "stop-inflight", { reason: "owner stopped the batch" });
  assert.equal(stoppedInFlight.items[0].status, "needs_reconciliation");
  assert.equal(stoppedInFlight.items[1].status, "pending");
  assert.equal(stoppedInFlight.status, "recovery_required");

  console.log("PASS: bounded overnight batch — mixed outcomes, bounded repair, interruption reconciliation, deadline, persisted attempt limits, forged checkpoint and portable/runtime parity");
} finally {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}
