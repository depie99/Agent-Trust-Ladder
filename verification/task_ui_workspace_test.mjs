import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fixture } from "./fixtures/task-changes/project.mjs";
import { loadState, saveState, logEvent, addEvidence } from "../runtime/lib/state.mjs";
import { recordExecution } from "../runtime/lib/execution-report.mjs";
import { captureChangeReview } from "../runtime/lib/change-review-store.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const f = fixture(); f.edit();
{
  const state = loadState(f.root);
  state.tasks["T-002"] = { id: "T-002", title: "Planned follow-up", objective: "Not started yet.", status: "triaged", completion_checks: [] };
  logEvent(state, { task: "T-001", actor: "manager", event: "task_created", detail: "fixture intake" });
  logEvent(state, { task: "T-001", actor: "rowan", event: "worker_start", detail: "lease acquired" });
  addEvidence(state, "T-001", { kind: "check", check: "behavior", result: "pass", actor: "rowan", detail: "verified locally", command: "npm test", exit_code: 0, coverage: "complete", code_revision: "abc123", packet_revision: 1, session_id: "SESS-1" });
  saveState(f.root, state);
  recordExecution(f.root, { id: "SESS-1", taskId: "T-001", role: "rowan", provider: "codex", model: "test-model", startedAt: "2026-11-16T08:00:00Z", finishedAt: "2026-11-16T08:05:00Z", exitCode: 0, timedOut: false, statusBefore: "assigned", statusAfter: "in_progress", packetRevision: 1 });
  recordExecution(f.root, { id: "SESS-2", taskId: "T-001", role: "planning", provider: "gapgpt", model: "glm", startedAt: "2026-11-16T07:00:00Z", finishedAt: "2026-11-16T07:04:00Z", exitCode: 1, timedOut: true, statusBefore: "triaged", statusAfter: "triaged", packetRevision: 1 });
  captureChangeReview(f.root, state.tasks["T-001"]);
}

let browser, server;
try {
  const started = await startControlPlaneServer(f.root);
  server = started.server;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(started.url);
  await page.locator('[data-page="tasks"]:visible').first().click();
  // Two-column workspace: searchable list left, focused workspace right.
  const layout = page.locator(".task-workspace-layout");
  await layout.waitFor();
  assert.ok(await layout.locator(".task-workspace-side .task-row").count() >= 2, "task list renders in the side column");
  await page.locator("#taskWorkspace").getByText("Select a task").waitFor();
  // Workspace filters with counts.
  const segments = page.locator(".tasks-seg-btn");
  assert.equal(await segments.count(), 4, "All / Running / Needs attention / Completed");
  assert.match(await segments.nth(2).textContent(), /Needs attention/, "attention filter present");
  assert.match(await segments.nth(3).textContent(), /Completed/, "completed filter present");
  await page.locator("#taskSearch").fill("follow-up");
  assert.equal(await layout.locator(".task-row").count(), 1, "search narrows the list");
  await page.locator("#taskSearch").fill("");

  // Selecting task A opens the workspace on Activity with the projection.
  await page.locator('[data-task="T-001"]').first().click();
  const workspace = page.locator("#taskWorkspace");
  await workspace.locator(".task-detail-title").waitFor();
  assert.equal(await workspace.getAttribute("data-task-view"), "activity");
  const implementation = workspace.locator('[data-stage="implementation"]');
  await implementation.waitFor();
  assert.match(await implementation.textContent(), /rowan/, "session attempt shows its actor");
  assert.match(await implementation.textContent(), /codex\/test-model/, "attempt shows provider and model");
  // The failed planning attempt is expanded automatically; completed details stay collapsed.
  const failed = workspace.locator('[data-stage="planning"] .activity-attempt.is-failed');
  await failed.waitFor();
  assert.equal(await failed.getAttribute("open"), "", "failed step expanded initially");
  const done = workspace.locator('[data-stage="implementation"] .activity-attempt').first();
  assert.equal(await done.getAttribute("open"), null, "completed step collapsed initially");
  // Captured changes section links files into the review.
  await workspace.locator('[data-stage="changes"]').waitFor();

  // Process view: repository → stages → files → checks.
  await workspace.locator('[data-action="workspace-view:process"]').click();
  await workspace.locator(".process-flow").waitFor();
  assert.match(await workspace.locator(".process-flow").textContent(), /workspace/, "repository node shows the recorded workspace");
  assert.ok(await workspace.locator(".process-attempt").count() >= 2, "stage attempts render as connected nodes");
  assert.ok(await workspace.locator(".process-check").count() >= 1, "completion checks render");

  // Changes view embeds the pinned review with its revision selector.
  await workspace.locator('[data-action="workspace-view:changes"]').click();
  await workspace.locator("#reviewRevision").waitFor();
  await workspace.locator('[data-review-action="tab:files"]').click();
  await workspace.locator(".review-file").first().waitFor({ state: "attached" });
  assert.ok((await workspace.locator(".review-file").count()) >= 1, "file tree embedded");
  // A file link from Activity opens the diff in the embedded review.
  await workspace.locator('[data-action="workspace-view:activity"]').click();
  await workspace.locator('[data-stage="changes"] .review-file').first().click();
  await workspace.locator("#reviewRevision").waitFor();
  await workspace.locator(".review-diff, .review-patch").first().waitFor();

  // Task B: planned work renders the honest unrun state.
  await page.locator('[data-task="T-002"]').first().click();
  await workspace.locator(".task-detail-title").waitFor();
  assert.equal(await workspace.getAttribute("data-workspace-task-id", { exact: true }) ?? (await workspace.locator(".task-workspace").getAttribute("data-workspace-task-id")), "T-002");
  await workspace.locator('[data-action="workspace-view:activity"]').click();
  await workspace.getByText("Planned — ATL has not started this task yet.").waitFor();

  // Selection and view survive a reload.
  await workspace.locator('[data-action="workspace-view:process"]').click();
  await workspace.locator(".process-flow").waitFor();
  await page.reload();
  await page.locator("#taskWorkspace .task-workspace").waitFor();
  assert.equal(await page.locator("#taskWorkspace .task-workspace").getAttribute("data-workspace-task-id"), "T-002", "selection persists across reload");
  assert.equal(await page.locator("#taskWorkspace .task-workspace").getAttribute("data-workspace-view"), "process", "view persists across reload");

  // Ask ATL mounts inline from the composer invite.
  await page.locator('[data-page="tasks"]:visible').first().click();
  await page.locator('[data-task="T-001"]').first().click();
  await workspace.locator(".task-detail-title").waitFor();
  await workspace.locator('[data-action="assistant-open:T-001"]').click();
  await workspace.locator("#assistantTranscript").waitFor();
  assert.equal(await workspace.locator("#assistantTranscript").count(), 1, "inline assistant lives in the workspace");

  // Race regression: a live task repaints the workspace while /api/assistant
  // is in flight; the composer must re-query the mount after the fetch and
  // never surface "Assistant unavailable … reading 'dataset'".
  await page.route("**/api/assistant", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const response = await route.fetch(); const result = await response.json();
    result.providers = [{ id: "codex", label: "Codex", installed: true, signedIn: true, defaultModel: "test-model", models: [{ id: "test-model" }] }];
    await route.fulfill({ response, json: result });
  });
  await page.locator('[data-task="T-002"]').first().click();
  await workspace.locator('[data-action="assistant-open:T-002"]').click();
  // Two task switches while the read is in flight: the captured mount detaches.
  await page.waitForTimeout(250);
  await page.locator('[data-task="T-001"]').first().click();
  await workspace.locator(".task-detail-title").waitFor();
  await page.locator('[data-task="T-002"]').first().click();
  await workspace.locator(".task-detail-title").waitFor();
  await workspace.locator("#assistantTranscript").waitFor();
  assert.equal(await workspace.locator("#assistantTranscript").count(), 1, "inline assistant survives a mid-fetch workspace repaint");
  await page.waitForTimeout(300);
  assert.equal(await page.getByText("Assistant unavailable").count(), 0, "no assistant-unavailable error dialog");
  await page.unroute("**/api/assistant");

  // Disclosures start collapsed and survive the polling tick.
  const acceptance = workspace.locator('[data-workspace-disclosure="acceptance"]');
  assert.equal(await acceptance.getAttribute("open"), null, "verbose sections start collapsed");
  await acceptance.locator("summary").click();
  await page.waitForTimeout(2600);
  assert.equal(await acceptance.getAttribute("open"), "", "disclosure state survives the live tick");

  // Narrow viewport: one pane at a time with Back navigation.
  await page.setViewportSize({ width: 390, height: 740 });
  await page.waitForTimeout(400);
  await page.locator('[data-task="T-002"]').first().click();
  await page.waitForTimeout(400);
  const layoutClass = await page.locator(".task-workspace-layout").getAttribute("class");
  assert.match(layoutClass, /show-detail/, "narrow selection shows the workspace pane");
  assert.equal(await page.locator(".task-workspace-side .tasks-shell").isVisible(), false, "list hidden while detail is open");
  await page.locator('[data-action="workspace-back"]').click();
  assert.doesNotMatch(await page.locator(".task-workspace-layout").getAttribute("class"), /show-detail/, "Back returns to the list");
  assert.equal(await page.locator("#taskWorkspace").isVisible(), false, "workspace hidden while the list is open");

  assert.deepEqual(errors, [], "no page errors during the workspace journey");
  await page.close();
  console.log("PASS: task workspace — two-column layout, filters, Activity/Process/Changes, planned state, retention, inline assistant, narrow Back");
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  f.cleanup();
}
