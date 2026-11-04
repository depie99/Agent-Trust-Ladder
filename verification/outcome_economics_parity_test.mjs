import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as portable from "../skills/atl/scripts/outcome-economics.mjs";
import * as runtime from "../runtime/lib/outcome-economics.mjs";
import { recordExecution, unknownTokens } from "../runtime/lib/execution-report.mjs";
import { emptyState, saveState } from "../runtime/lib/state.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-outcome-economics-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
saveState(root, emptyState());
try {
  // ---------- attempts, failures and honest denominators ----------
  const tokens = (total, input = null) => ({ input, output: null, cached_input: null, total, source: "provider-adapter" });
  const records = [
    { task_id: "T-1", attempt_id: "a1", status: "completed", accepted: true, tokens: tokens(1000, 700), wall_ms: 1000, review_minutes: 4 },
    { task_id: "T-1", attempt_id: "a2", status: "repaired", accepted: false, tokens: tokens(500), wall_ms: 500, review_minutes: 3 },
    { task_id: "T-2", attempt_id: "a3", status: "failed", accepted: false, tokens: unknownTokens(), wall_ms: 250, manual_intervention: true },
    { task_id: "T-3", attempt_id: "a4", status: "cancelled", accepted: false, tokens: unknownTokens(), external: true },
    { task_id: "T-1", attempt_id: "a1", status: "completed", accepted: true, tokens: tokens(1000, 700), wall_ms: 1000, review_minutes: 4 },
  ];
  const summary = portable.outcomeSummary(records);
  assert.equal(summary.denominators.attempts, 4, "a duplicated attempt is recorded once");
  assert.equal(summary.denominators.duplicate_attempts_ignored, 1);
  assert.deepEqual(summary.outcomes, { attempted: 4, completed: 1, accepted: 1, failed: 1, repaired: 1, cancelled: 1, blocked: 0, running: 0 });
  assert.equal(summary.usage.measured_attempts, 2);
  assert.equal(summary.usage.unknown_attempts, 2);
  assert.equal(summary.usage.coverage, "partial");
  assert.equal(summary.usage.total, 1500, "only measured attempts contribute to the total");
  assert.equal(summary.usage.input, null, "a partial field is reported as unknown instead of under-counted");
  assert.equal(summary.usage.note, "unknown attempts are counted separately and never priced as zero");
  assert.equal(summary.effort.wall_ms, 1750);
  assert.equal(summary.effort.reviewer_minutes, 7);
  assert.equal(summary.effort.manual_interventions, 1);
  assert.equal(summary.coverage_gaps.filter((gap) => gap.kind === "missing-telemetry").length, 2);
  assert.equal(summary.coverage_gaps.filter((gap) => gap.kind === "outside-admission-boundary").length, 1);

  const allUnknown = portable.outcomeSummary([{ task_id: "T-9", attempt_id: "z1", status: "completed", tokens: unknownTokens() }]);
  assert.equal(allUnknown.usage.coverage, "unknown");
  assert.equal(allUnknown.usage.total, null, "no measured attempt means no total, not zero");
  assert.deepEqual(portable.outcomeSummary([]).outcomes, { attempted: 0, completed: 0, accepted: 0, failed: 0, repaired: 0, cancelled: 0, blocked: 0, running: 0 });

  // ---------- admission cannot exceed the enforced quota ----------
  const ledger = portable.createLedger({ window: "2026-11-04" });
  const first = portable.admitCall(ledger, { key: "provider:plan", cost: 4, limit: 10 });
  const second = portable.admitCall(ledger, { key: "provider:plan", cost: 4, limit: 10 });
  assert.equal(first.admitted, true);
  assert.equal(second.admitted, true);
  const refused = portable.admitCall(ledger, { key: "provider:plan", cost: 4, limit: 10 });
  assert.equal(refused.admitted, false);
  assert.equal(refused.reason, "quota");
  assert.equal(refused.usage.total, 8, "a refused call does not consume the window");
  const settled = portable.settleCall(ledger, { reservation_id: first.reservation.reservation_id, actual: 3 });
  assert.equal(settled.charged, 3);
  assert.equal(settled.usage.total, 7);
  assert.equal(portable.admitCall(ledger, { key: "provider:plan", cost: 3, limit: 10 }).admitted, true);
  assert.equal(portable.admitCall(ledger, { key: "provider:plan", cost: 1, limit: 10 }).admitted, false, "held plus charged usage cannot exceed the limit");
  assert.throws(() => portable.settleCall(ledger, { reservation_id: first.reservation.reservation_id, actual: 1 }), /already settled/);
  assert.throws(() => portable.settleCall(ledger, { reservation_id: "missing" }), /unknown reservation/);
  assert.throws(() => portable.admitCall(ledger, { cost: 1 }), /wrapped tool or API key/);

  // ---------- crash and unknown settlement stay conservative ----------
  const crashLedger = portable.createLedger({ window: "2026-11-04" });
  const held = portable.admitCall(crashLedger, { key: "provider:implement", cost: 5, limit: 10 });
  const unknown = portable.settleCall(crashLedger, { reservation_id: held.reservation.reservation_id });
  assert.equal(unknown.unknown_effect, true);
  assert.equal(unknown.reconciliation_required, true);
  assert.equal(unknown.charged, 5, "an unknown settlement keeps the reserved charge instead of releasing it");
  assert.equal(portable.windowUsage(crashLedger, "2026-11-04").total, 5);
  assert.deepEqual(portable.pendingReconciliation(crashLedger).map((item) => item.key), ["provider:implement"]);
  const reconciled = portable.reconcileCall(crashLedger, { reservation_id: held.reservation.reservation_id, actual: 2 });
  assert.equal(reconciled.reconciled, true);
  assert.equal(portable.windowUsage(crashLedger, "2026-11-04").total, 2);
  assert.equal(portable.pendingReconciliation(crashLedger).length, 0);
  const secondReconcile = portable.reconcileCall(crashLedger, { reservation_id: held.reservation.reservation_id, actual: 1 });
  assert.equal(secondReconcile.reconciled, false, "a settled charge is not rewritten twice");
  assert.match(secondReconcile.reason, /already had a measured charge/);
  portable.recordGap(crashLedger, { kind: "unwrapped-host-call", detail: "browser tool outside the wrapper" });
  assert.equal(crashLedger.gaps[0].kind, "unwrapped-host-call");

  // ---------- review capacity stops admission ----------
  const stopped = portable.reviewCapacity({ pending: 3, limit: 3, decisions: [{ task_id: "T-2" }] });
  assert.equal(stopped.admission, "stopped");
  assert.equal(stopped.over_limit, true);
  assert.match(stopped.message, /stops until a decided review is recorded/);
  assert.equal(stopped.next_decision.task_id, "T-2");
  assert.equal(portable.reviewCapacity({ pending: 1, limit: 3 }).admission, "open");
  assert.equal(portable.reviewCapacity({ pending: 0, limit: 0 }).limit, 1, "a limit of zero cannot disable the cap");

  // ---------- ledger persistence and corruption ----------
  portable.saveLedger(root, ledger);
  const loaded = portable.loadLedger(root);
  assert.equal(portable.windowUsage(loaded, "2026-11-04").total, portable.windowUsage(ledger, "2026-11-04").total);
  fs.writeFileSync(portable.economicsPaths(root).ledger, "{ truncated");
  const corrupt = portable.loadLedger(root);
  assert.equal(corrupt.corrupt, true);
  assert.equal(corrupt.gaps[0].kind, "ledger-corrupt", "a lost ledger is visible instead of resetting allowances silently");
  assert.equal(portable.windowUsage(corrupt, "2026-11-04").total, 0);

  // ---------- recorded runtime executions map onto the same contract ----------
  recordExecution(root, { id: "exec-1", taskId: "T-1", role: "rowan", provider: "codex", tokens: tokens(2000, 1500), startedAt: "2026-11-04T00:00:00.000Z", finishedAt: "2026-11-04T00:05:00.000Z", statusAfter: "done", exitCode: 0 });
  recordExecution(root, { id: "exec-2", taskId: "T-2", role: "nova", provider: "codex", tokens: unknownTokens(), startedAt: "2026-11-04T00:06:00.000Z", finishedAt: "2026-11-04T00:07:00.000Z", statusAfter: "blocked", exitCode: 1 });
  const report = runtime.outcomeReportFromRoot(root, { review: { pending: 1, limit: 3 } });
  assert.equal(report.summary.denominators.attempts, 2);
  assert.equal(report.summary.outcomes.accepted, 1);
  assert.equal(report.summary.outcomes.failed, 1);
  assert.equal(report.summary.usage.coverage, "partial");
  assert.equal(report.summary.usage.total, 2000);
  assert.ok(report.summary.coverage_gaps.some((gap) => gap.kind === "missing-telemetry"));
  assert.ok(report.summary.coverage_gaps.every((gap) => gap.kind !== "outside-admission-boundary") === false, "external host calls are declared outside the admission boundary");
  assert.equal(report.admission.enforcement_scope, "wrapped");
  assert.equal(report.review.admission, "open");
  assert.match(report.admission.gaps.map((gap) => gap.kind).join(",") || "ledger-corrupt", /ledger-corrupt/);

  // ---------- the Control Plane serves the same numbers ----------
  const { startControlPlaneServer } = await import("../runtime/lib/control-plane-server.mjs");
  const running = await startControlPlaneServer(root);
  let browser;
  try {
    const snapshotResponse = await fetch(new URL("/api/snapshot", running.url));
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshotResponse.status, 200, `snapshot responds: ${JSON.stringify(snapshot).slice(0, 200)}`);
    assert.equal(snapshot.usage.economics.summary.denominators.attempts, 2, "the snapshot reports the same attempt denominator");
    assert.equal(snapshot.usage.economics.summary.usage.total, 2000);
    assert.equal(snapshot.usage.economics.admission.enforcement_scope, "wrapped");
    assert.ok(snapshot.usage.economics.admission.gaps.some((gap) => gap.kind === "ledger-corrupt"));
    browser = await (await import("playwright")).chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(9000);
    await page.goto(running.url);
    await page.locator('[data-page="usage"]:visible').first().click();
    await page.getByText("Accepted outcomes & review capacity").waitFor();
    await page.waitForFunction(() => document.querySelector("#content")?.textContent?.includes("Unknown usage is counted, never priced as zero"));
    assert.match(await page.locator("#content").innerText(), /Usage coverage/);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => running.server.close(resolve));
  }

  // ---------- both surfaces decide identically ----------
  const parityArgs = { ledger: portable.createLedger({ window: "2026-11-04" }), records, expectedAttempts: 4, review: { pending: 2, limit: 4 } };
  assert.deepEqual(runtime.economicsReport(parityArgs), portable.economicsReport(parityArgs));
  assert.deepEqual(runtime.outcomeSummary(records), portable.outcomeSummary(records));
  assert.deepEqual(runtime.reviewCapacity({ pending: 4, limit: 4 }), portable.reviewCapacity({ pending: 4, limit: 4 }));
  console.log("outcome economics parity tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
