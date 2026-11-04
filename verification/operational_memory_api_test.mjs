import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { memoryPaths, recordFailure, proposePrevention, authorizePrevention, selectContext, failureSignature } from "../skills/atl/scripts/operational-memory.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-memory-api-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
saveState(root, emptyState());
fs.mkdirSync(path.dirname(memoryPaths(root).sources), { recursive: true });
fs.writeFileSync(memoryPaths(root).sources, JSON.stringify({
  version: 1,
  sources: [
    { source_id: "s-queue", title: "Queue checkpoint recovery", text: "A restarted batch resumes from its checkpoint and never repeats a settled item.", observed_at: "2026-10-01T00:00:00.000Z", revision: "r1" },
    { source_id: "s-fa", title: "بازیابی صف", text: "صف شبانه از نقطه بازرسی ادامه می‌دهد.", observed_at: "2026-10-02T00:00:00.000Z", revision: "r2" },
  ],
}, null, 2));
recordFailure(root, { blocker: "stale-plan-review", reason: "approved plan became stale at revision 4", at: "2026-10-30T00:00:00.000Z" });
recordFailure(root, { blocker: "stale-plan-review", reason: "approved plan became stale at revision 7", at: "2026-10-31T00:00:00.000Z" });
const proposal = proposePrevention(root, { signature_id: failureSignature({ blocker: "stale-plan-review", reason: "approved plan became stale at revision 1" }).signature_id, preventer: "hash only declared plan evidence", rollback: "revert planFingerprint" });
authorizePrevention(root, proposal.candidate_id, { actor: "owner", evidence: { command: "node verification/task_dependency_contract_test.mjs", result: "passed", at: "2026-11-02T00:00:00.000Z" } });

let running, browser;
try {
  running = await startControlPlaneServer(root);
  const response = await fetch(new URL(`/api/memory?q=${encodeURIComponent("queue checkpoint resume")}`, running.url));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.items[0].source_id, "s-queue");
  assert.equal(body.items[0].selected_because.includes("checkpoint"), true);
  assert.equal(body.coverage.selected, 1);
  assert.equal(body.recovery.status, "clean");
  assert.equal(body.preventions.enforced.length, 1);
  assert.equal(body.preventions.enforced[0].before_occurrences, 2);
  assert.equal(body.signatures[0].count, 2);

  const portable = selectContext(root, { query: "queue checkpoint resume", budgetChars: 1200 });
  assert.deepEqual({ items: body.items, coverage: body.coverage, status: body.status }, { items: portable.items, coverage: portable.coverage, status: portable.status }, "the API serves exactly what the portable helper selects");

  const empty = await (await fetch(new URL(`/api/memory?q=${encodeURIComponent("kubernetes helm")}`, running.url))).json();
  assert.equal(empty.status, "no-evidence");
  assert.equal(empty.items.length, 0);

  const snapshot = await (await fetch(new URL("/api/snapshot", running.url))).json();
  assert.equal(snapshot.operational.recovery.status, "clean");
  assert.equal(snapshot.operational.preventions.enforced.length, 1);
  assert.equal(snapshot.operational.signatures[0].cause_class, "stale-plan-review");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(9000);
  await page.goto(running.url);
  await page.locator('[data-page="brain"]:visible').first().click();
  await page.getByText("Operational memory", { exact: true }).waitFor();
  await page.getByText("hash only declared plan evidence").waitFor();
  await page.getByText(/before 2 · after 0/).waitFor();
  await page.locator("#memoryQuery").fill("صف بازرسی");
  await page.locator('[data-action="memory-context"]').click();
  await page.getByText("بازیابی صف", { exact: true }).waitFor();
  assert.match(await page.locator("#memoryContext").innerText(), /revision r2/, "the UI shows the source revision behind the selection");
  await page.locator("#memoryQuery").fill("kubernetes helm");
  await page.locator('[data-action="memory-context"]').click();
  await page.waitForFunction(() => document.querySelector("#memoryContext")?.textContent?.includes("No evidence matched"), null, { timeout: 15000 });
  assert.match(await page.locator("#memoryContext").innerText(), /missing evidence|No evidence matched/, "the UI reports missing evidence instead of a guess");
  console.log("operational memory API and UI tests passed");
} finally {
  if (browser) await browser.close();
  if (running) await new Promise((resolve) => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
