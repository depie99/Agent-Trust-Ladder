import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { ownerJson } from "./helpers/owner-http.mjs";
import { queueAdd, queueCreate } from "../runtime/lib/queue.mjs";

// Shipped archive contract: only real queues become collapsible groups with a
// per-queue bulk delete; tasks without a queue render flat; archived records
// (already deleted from the archive) stay out of the view.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-shipped-archive-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config/manager.json"), JSON.stringify({ version: 1 }));
const state = emptyState();
state.tasks["T-101"] = { id: "T-101", title: "Queue done task", status: "done", priority: "normal", completion_checks: [], evidence: [] };
state.tasks["T-102"] = { id: "T-102", title: "Queue rejected task", status: "rejected", priority: "normal", completion_checks: [], evidence: [] };
state.tasks["T-201"] = { id: "T-201", title: "Standalone done task", status: "done", priority: "normal", completion_checks: [], evidence: [] };
state.tasks["T-301"] = { id: "T-301", title: "Active task", status: "new", priority: "normal", completion_checks: [], evidence: [] };
state.tasks["T-401"] = { id: "T-401", title: "Archived leftover", status: "archived", priority: "normal", completion_checks: [], evidence: [] };
saveState(root, state);
queueCreate(root, "alpha", { name: "Alpha" });
queueAdd(root, "T-101", { queueId: "alpha" });
queueAdd(root, "T-102", { queueId: "alpha" });

const running = await startControlPlaneServer(root);
const apiUrl = (route) => `${running.url.replace(/\/$/, "")}${route}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(running.url, { waitUntil: "networkidle" });
  await page.locator('[data-page="shipped"]').first().click();
  await page.locator("h1").filter({ hasText: "Shipped archive" }).waitFor({ state: "visible" });

  // Queue group: both terminal tasks of the finished queue, collapsible head.
  const group = page.locator(".shipped-queue").filter({ hasText: "Alpha" });
  await group.waitFor({ state: "visible" });
  assert.equal(await group.locator(".task-row").count(), 2, "finished queue group holds both shipped tasks");
  assert.match(await group.locator(".shipped-queue-head").innerText(), /2 shipped/);
  assert.equal(await group.locator('button[data-action^="shipped-delete:"]').count(), 1, "queue group has one bulk delete button");

  // Standalone done task renders flat under the unqueued panel, not in a queue card.
  const unqueued = page.locator("section.panel").filter({ hasText: "Unqueued tasks" });
  await unqueued.waitFor({ state: "visible" });
  assert.equal(await unqueued.locator(".task-row").count(), 1, "unqueued shipped task renders flat");
  assert.equal(await unqueued.locator(".shipped-queue-head").count(), 0, "unqueued panel is not a queue card");

  // Already-archived records stay deleted from the archive view; active work stays off it.
  assert.equal(await page.getByText("T-401").count(), 0, "archived leftover is hidden from the archive");
  assert.equal(await page.getByText("T-301").count(), 0, "active task stays on the board");

  // Collapse hides the rows and survives the 2s snapshot repaint.
  await group.locator(".shipped-collapse").click();
  assert.equal(await group.locator(".shipped-queue-body").isHidden(), true, "collapse hides queue tasks");
  await page.waitForTimeout(2300);
  const stillCollapsed = await page.locator(".shipped-queue").filter({ hasText: "Alpha" }).locator(".shipped-queue-body").isHidden();
  assert.equal(stillCollapsed, true, "collapse survives snapshot repaints");
  await page.locator(".shipped-queue").filter({ hasText: "Alpha" }).locator(".shipped-collapse").click();
  await group.locator(".shipped-queue-body").waitFor({ state: "visible" });

  // Persian locale keeps the queue affordances translated while the group exists.
  await page.locator("#localeBtn").click();
  await page.waitForTimeout(300);
  const faDelete = await page.locator('.shipped-queue button[data-action^="shipped-delete:"]').first().innerText();
  assert.match(faDelete, /حذف صف/, "queue bulk delete button is localized");
  assert.equal(await page.locator(".shipped-collapse").first().getAttribute("aria-label"), "جمع‌کردن صف", "collapse control is localized");
  await page.locator("#localeBtn").click();
  await page.waitForTimeout(300);

  // Bulk delete for the standalone task through the selection bar.
  await unqueued.locator('input[data-tsel="T-201"]').check();
  await page.locator('[data-action="shipped-delete-selected"]').click();
  await page.locator('[data-action="shipped-delete-selected-confirm"]').click();
  await page.waitForFunction(() => !document.body.innerText.includes("T-201"), null, { timeout: 15000 });
  let snapshot = await ownerJson(new URL("/api/snapshot", running.url));
  assert.equal(snapshot.state.tasks["T-201"].status, "archived", "standalone delete archives the record");

  // Per-queue bulk delete removes the whole queue group.
  await page.locator('.shipped-queue button[data-action^="shipped-delete:"]').click();
  await page.locator('[data-action^="shipped-delete-confirm:"]').click();
  await page.waitForFunction(() => !document.body.innerText.includes("T-101"), null, { timeout: 15000 });
  assert.equal(await page.locator(".shipped-queue").count(), 0, "emptied queue group leaves the page");
  snapshot = await ownerJson(new URL("/api/snapshot", running.url));
  assert.equal(snapshot.state.tasks["T-101"].status, "archived", "queue bulk delete archives queue tasks");
  assert.equal(snapshot.state.tasks["T-102"].status, "archived", "queue bulk delete archives rejected tasks");
  assert.equal(snapshot.state.tasks["T-301"].status, "new", "active work is never touched by archive deletes");
  assert.match(await page.locator("#content").innerText(), /Nothing shipped yet/);
  console.log("PASS: shipped archive groups queues with collapse and bulk delete, unqueued tasks stay flat");
} finally {
  await browser.close();
  await new Promise((resolve) => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
