// Control Plane exposure for a bounded batch: scope, limits, readiness,
// stop/reconcile/resume and the morning summary, over the real HTTP handler.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, createTask, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { activateScheduledBatch, authorizeBatch, claimBatchItem, readBatch, runBatch, writeBatch } from "../runtime/lib/batch-runner.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-batch-api-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
const ids = [];
for (const label of ["first", "second"]) {
  const task = createTask(state, { title: `Batch ${label}` });
  task.status = "assigned";
  task.plan_draft_id = "approved-fixture";
  task.plan_queue_id = "approved-fixture-queue";
  task.plan_review_required = false;
  task.source_origin = { type: "azure", remote_id: 741, iteration: "Demo\\Sprint 74" };
  task.workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atl-batch-api-ws-"));
  fs.writeFileSync(path.join(task.workspace, "value.txt"), `${label}\n`);
  ids.push(task.id);
}
const unapproved = createTask(state, { title: "Unapproved task" });
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

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(running.url);
    await page.locator('[data-page="batches"]:visible').first().click();
    await page.locator('[data-action="workflow-select:pilot"]').click();
    await page.locator('.batch-step').first().waitFor();
    assert.match(await page.locator('.batch-detail').innerText(), /Batch first/);
    assert.equal(await page.locator('.batch-flow button').count(), 3);
    await page.getByRole("button", { name: "+ New batch", exact: true }).click();
    assert.equal(await page.locator(`[data-batch-task="${unapproved.id}"]`).count(), 0);
    await page.locator(`[data-batch-task="${ids[1]}"]`).check();
    await page.locator(`[data-batch-task="${ids[0]}"]`).check();
    await page.locator("#batchStart").selectOption({ index: 1 });
    await page.locator("#batchFailure").selectOption("stop");
    await page.locator("#batchMinutes").selectOption("480");
    assert.match(await page.locator("#batchPreview").innerText(), /2 tasks · up to 8 h · at most 4 attempts/);
    await page.getByRole("button", { name: "Authorize and start" }).click();
    await page.getByRole("button", { name: "Cancel schedule" }).waitFor();
    const newBatch = (await fetch(`${running.url}api/batch`).then(r => r.json())).batches.find(batch => batch.id !== "pilot");
    assert.equal(newBatch.status, "scheduled");
    assert.equal(newBatch.failure_policy, "stop");
    assert.deepEqual(newBatch.items.map(item => item.task), [...ids].reverse());
    assert.equal(newBatch.items.every(item => item.attempts === 0), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'workflow steps and source context fit mobile');
    await page.locator('.batch-flow [data-action="go:inbox"]').click();
    await page.getByRole("heading", { name: "Inbox", exact: true }).waitFor();
  } finally { await browser.close(); }

  const unauthenticatedSnapshot = await fetch(`${running.url}api/snapshot`);
  assert.equal(unauthenticatedSnapshot.status, 403, "snapshot reads require an authenticated owner session");
  const rootResponse = await fetch(running.url);
  const ownerCookie = rootResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const csrf = (await rootResponse.text()).match(/<meta name="atl-csrf" content="([^"]+)"/)?.[1] || "";
  const snapshot = await fetch(`${running.url}api/snapshot`, { headers: { cookie: ownerCookie, "x-atl-csrf": csrf } }).then((response) => response.json());
  assert.ok(Array.isArray(snapshot.batches) && snapshot.batches.some((batch) => batch.id === "pilot"), "the live snapshot carries the batch scope");

  const client = await fetch(`${running.url}control-plane-client.js`).then((response) => response.text());
  assert.match(client, /BUILD \/ BATCHES/);
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

  const rejectedTask = await post(`${running.url}api/batch`, { action: "authorize", confirm: true, id: "unapproved", tasks: [unapproved.id], max_minutes: 60, max_attempts: 2, failure_policy: "continue" });
  assert.equal(rejectedTask.status, 409);
  const clock = Date.now(), due = clock + 60_000;
  authorizeBatch(root, { id: "test-failure-policy", tasks: ids, startAt: new Date(due).toISOString(), limits: { max_minutes: 60, max_attempts: 1 }, failurePolicy: "stop", now: clock });
  assert.equal(activateScheduledBatch(root, "test-failure-policy", { now: clock }), null);
  const active = activateScheduledBatch(root, "test-failure-policy", { now: due });
  assert.equal(Date.parse(active.deadline_at), due + 60 * 60_000);
  const launched = [];
  const outcome = await runBatch(root, active.id, { now: () => due, onProgress() {}, launch: async (_root, { taskIds }) => {
    launched.push(...taskIds);
    return { status: "failed", reason: "fixture failure" };
  } });
  assert.equal(outcome.status, "stopped");
  assert.deepEqual(launched, [ids[0]]);

  console.log("PASS: batch API — explicit scope/limits, readiness, duplicate refusal, snapshot exposure, stop/resume, conservative reconcile, morning summary and forged-checkpoint refusal");
} finally {
  await new Promise((resolve) => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
