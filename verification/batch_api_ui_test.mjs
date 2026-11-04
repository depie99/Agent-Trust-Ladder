// Control Plane exposure for a bounded batch: scope, limits, readiness,
// stop/reconcile/resume and the morning summary, over the real HTTP handler.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, createTask, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { claimBatchItem, readBatch, writeBatch } from "../runtime/lib/batch-runner.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-batch-api-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
const ids = [];
for (const label of ["first", "second"]) {
  const task = createTask(state, { title: `Batch ${label}` });
  task.status = "assigned";
  task.workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atl-batch-api-ws-"));
  fs.writeFileSync(path.join(task.workspace, "value.txt"), `${label}\n`);
  ids.push(task.id);
}
saveState(root, state);

const post = async (url, body) => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

const running = await startControlPlaneServer(root);
try {
  const empty = await fetch(`${running.url}api/batch`).then((response) => response.json());
  assert.deepEqual(empty.batches, []);

  const created = await post(`${running.url}api/batch`, { action: "start", id: "pilot", tasks: ids, max_minutes: 90, max_attempts: 2, max_sessions: 4 });
  assert.equal(created.status, 200);
  assert.equal(created.body.summary.concurrency, 1);
  assert.equal(created.body.summary.limits.max_minutes, 90);
  assert.equal(created.body.summary.progress.total, 2);
  assert.ok(created.body.summary.items.every((item) => item.status === "pending"));

  const duplicate = await post(`${running.url}api/batch`, { action: "start", id: "pilot", tasks: ids });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /already active/);

  const detail = await fetch(`${running.url}api/batch?id=pilot`).then((response) => response.json());
  assert.equal(detail.summary.id, "pilot");
  assert.equal(detail.running, false);

  const snapshot = await fetch(`${running.url}api/snapshot`).then((response) => response.json());
  assert.ok(snapshot.batches.some((batch) => batch.id === "pilot"), "the live snapshot carries the batch scope");

  const client = await fetch(`${running.url}control-plane-client.js`).then((response) => response.text());
  assert.match(client, /OPERATIONS \/ BATCHES/);
  assert.match(client, /batch-start-save/);
  assert.match(client, /batch-reconcile:/);

  const unconfirmed = await post(`${running.url}api/batch`, { action: "run", id: "pilot" });
  assert.equal(unconfirmed.status, 400, "running a batch requires explicit confirmation");

  const stopped = await post(`${running.url}api/batch`, { action: "stop", id: "pilot", reason: "owner paused the pilot" });
  assert.equal(stopped.body.summary.status, "stopped");
  const resumed = await post(`${running.url}api/batch`, { action: "resume", id: "pilot" });
  assert.equal(resumed.body.summary.status, "running");

  const summary = await post(`${running.url}api/batch`, { action: "summary", id: "pilot" });
  assert.equal(summary.status, 200);
  assert.match(summary.body.markdown, /Boundary/);
  assert.ok(fs.existsSync(path.join(root, ".trust", "manager", "batches", "pilot-summary.md")));

  // An in-flight item reconciles conservatively instead of being replayed.
  writeBatch(root, claimBatchItem(readBatch(root, "pilot"), ids[0], { holder: "api-test" }));
  const reconciled = await post(`${running.url}api/batch`, { action: "reconcile", id: "pilot" });
  assert.equal(reconciled.body.summary.recovery_required, true);
  assert.equal(reconciled.body.summary.items[0].status, "needs_reconciliation");
  const refused = await post(`${running.url}api/batch`, { action: "resume", id: "pilot" });
  assert.equal(refused.status, 409);

  // A forged checkpoint is listed as invalid and cannot run or complete.
  const forgedFile = path.join(root, ".trust", "manager", "batches", "forged.json");
  fs.writeFileSync(forgedFile, `${JSON.stringify({ ...readBatch(root, "pilot"), id: "forged", hash: "0".repeat(64) }, null, 2)}\n`);
  const listed = await fetch(`${running.url}api/batch`).then((response) => response.json());
  assert.equal(listed.batches.find((batch) => batch.id === "forged").valid, false);
  const forgedRun = await post(`${running.url}api/batch`, { action: "run", id: "forged", confirm: true });
  assert.equal(forgedRun.status, 409);
  assert.match(forgedRun.body.error, /invalid|reconciliation|complete/);

  console.log("PASS: batch API — explicit scope/limits, readiness, duplicate refusal, snapshot exposure, stop/resume, conservative reconcile, morning summary and forged-checkpoint refusal");
} finally {
  await new Promise((resolve) => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
