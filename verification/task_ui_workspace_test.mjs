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
  Object.assign(state.tasks["T-001"], { status: "verifying", recovery: { status: "exhausted" } });
  state.tasks["T-002"] = { id: "T-002", title: "Planned follow-up", objective: "Not started yet.", status: "triaged", completion_checks: [] };
  state.tasks["T-003"] = { id: "T-003", title: "Imported request", status: "triaged", intake_only: true, plan_review_required: true, completion_checks: [] };
  logEvent(state, { task: "T-001", actor: "manager", event: "task_created", detail: "fixture intake" });
  logEvent(state, { task: "T-001", actor: "rowan", event: "worker_start", detail: "lease acquired" });
  addEvidence(state, "T-001", { kind: "check", check: "behavior", result: "pass", actor: "rowan", detail: "verified locally", command: "npm test", exit_code: 0, coverage: "complete", code_revision: "abc123", packet_revision: 1, session_id: "SESS-1" });
  for (let index = 1; index <= 8; index++) {
    const check = `Check ${index}`;
    state.tasks["T-001"].completion_checks.push(check);
    addEvidence(state, "T-001", { kind: "check", check, result: "pass", actor: "rowan" });
  }
  saveState(f.root, state);
  recordExecution(f.root, { id: "SESS-1", taskId: "T-001", role: "rowan", provider: "codex", startedAt: "2026-11-16T08:00:00Z" });
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
  assert.equal(await segments.count(), 4, "All / Running / Needs you / Done");
  assert.match(await segments.nth(2).textContent(), /Needs you/, "attention filter present");
  assert.equal(await segments.nth(2).locator(".tasks-seg-count").textContent(), "1");
  await page.locator(".tasks-import-notice").getByText(/1 source request/).waitFor();
  await page.locator("#taskWorkspace").getByRole("button", { name: "1 need attention", exact: true }).click();
  assert.deepEqual(await layout.locator(".task-card").evaluateAll(cards => cards.map(card => card.dataset.task)), ["T-001"]);
  await page.locator('[data-action="filter:All"]').click();
  assert.match(await segments.nth(3).textContent(), /Done/, "completed filter present");
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
  assert.equal(await segments.nth(1).locator(".tasks-seg-count").textContent(), "0");
  assert.match(await layout.locator('[data-task="T-001"] .pill').first().textContent(), /Needs you/);
  assert.match(await workspace.locator(".task-run-indicator").textContent(), /Needs you/);
  assert.equal(await workspace.locator('.task-workspace-primary-actions [data-action="task-recovery:T-001"]').count(), 1);
  assert.equal(await workspace.locator('.task-workspace-primary-actions [data-action="run-task:T-001"]').count(), 0);
  assert.equal(await implementation.locator(".activity-attempt summary").getByText("Running", { exact: true }).count(), 0);
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
  await workspace.locator(".process-impact [data-action=process-execution]").click();
  const executionCanvas = workspace.locator(".process-execution-diagram .process-impact-canvas");
  await executionCanvas.locator("svg").waitFor();
  assert.ok(await executionCanvas.evaluate(canvas => canvas.clientHeight < 150 && canvas.scrollHeight === canvas.clientHeight),
    "a long execution timeline stays in one compact row without vertical scrolling");
  assert.match(await workspace.locator(".process-flow").textContent(), /workspace/, "repository node shows the recorded workspace");
  assert.ok(await workspace.locator(".process-attempt").count() >= 2, "stage attempts render as connected nodes");
  assert.ok(await workspace.locator(".process-check").count() >= 1, "completion checks render");
  // Render-quality guard: node text stays inside its rect and evidence rows
  // keep label/title/pill in their own grid tracks (no painted-over text).
  const renderAudit = await workspace.locator(".process-flow").evaluate((flow) => {
    const problems = [];
    for (const g of flow.querySelectorAll(".process-execution-svg g.node")) {
      const rect = g.querySelector("rect"), text = g.querySelector("text");
      if (!rect || !text) continue;
      if (text.getBBox().width > rect.getBBox().width - 16) problems.push(`node text overflows its rect: ${(text.textContent || "").slice(0, 30)}`);
    }
    for (const row of flow.querySelectorAll(".process-attempt")) {
      const label = row.querySelector(":scope > b"), title = row.querySelector(":scope > span");
      if (label && title && title.getBoundingClientRect().left < label.getBoundingClientRect().right - 1) problems.push(`evidence row overlap: ${label.textContent}`);
    }
    for (const row of flow.querySelectorAll(".process-check")) {
      const name = row.querySelector(":scope > span"), result = row.querySelector(":scope > b");
      if (name && result && result.getBoundingClientRect().left < name.getBoundingClientRect().right - 1) problems.push(`check row overlap: ${name.textContent.slice(0, 30)}`);
    }
    return problems;
  });
  assert.deepEqual(renderAudit, [], "execution graph text fits nodes and evidence rows keep their columns");
  await workspace.locator(".process-execution-diagram [data-action=process-impact]").click();
  const impactSvg = workspace.locator(".process-impact-svg"); await impactSvg.waitFor();
  assert.ok(await impactSvg.locator("[role=button]").count() > 0, "Mermaid nodes have keyboard-accessible actions");
  await impactSvg.locator("[role=button][aria-label^=\"file: runtime/example.js\"]").press("Enter");
  await workspace.locator(".review-patch .diff-line").first().waitFor();
  assert.match(await workspace.locator(".review-patch").textContent(), /after/, "a graph file node opens its captured diff");
  // Line-level comment via the gutter plus button (reference comment UX).
  await workspace.locator('[data-review-action^="comment-at:new:"]').first().click();
  await workspace.locator("#reviewDraft").fill("Browser review note");
  await workspace.locator("[data-review-action=comment-save]").click();
  await workspace.getByText("Browser review note", { exact: true }).waitFor();
  await workspace.locator('[data-review-action^="reply:"]').click();
  await workspace.locator("#reviewDraft").fill("Browser reply");
  await workspace.locator("[data-review-action=comment-save]").click();
  await workspace.getByText("Browser reply", { exact: true }).waitFor();
  await workspace.locator("[data-review-action=file-reviewed]").click();
  // The captured-file tree sits beside the graph-opened patch.
  await workspace.locator(".review-tree").waitFor();
  await page.reload();
  await workspace.getByText("Browser review note", { exact: true }).waitFor();
  await workspace.getByText("Browser reply", { exact: true }).waitFor();
  await workspace.locator(".review-patch .diff-line").first().waitFor();
  assert.equal(await workspace.locator("[data-review-action=file-reviewed]").textContent(), "Reviewed", "reviewed-file state survives reload");
  assert.ok(await workspace.locator(".review-patch").evaluate((node) => node.scrollWidth <= node.clientWidth + 2), "diff pane remains bounded at desktop width");
  await page.setViewportSize({ width: 390, height: 740 });
  await workspace.locator('[data-review-action="back-files"]').click();
  await workspace.locator(".review-tree").waitFor();
  assert.equal(await workspace.locator(".review-patch").isVisible(), false, "narrow review shows one pane at a time");
  assert.ok(await workspace.locator(".review-files").evaluate((node) => node.scrollWidth <= node.clientWidth + 2), "narrow Changes layout fits the harness pane");
  await page.setViewportSize({ width: 1280, height: 800 });

  // Changes view embeds the pinned review with its revision picker.
  await workspace.locator('[data-action="workspace-view:changes"]').click();
  await workspace.locator("#reviewRevision").waitFor({ state: "attached" });
  await workspace.locator(".review-file").first().waitFor({ state: "attached" });
  assert.ok((await workspace.locator(".review-file").count()) >= 1, "file tree embedded");
  // A file link from Activity opens the diff in the embedded review.
  await workspace.locator('[data-action="workspace-view:activity"]').click();
  await workspace.locator('[data-stage="changes"] .review-file').first().click();
  await workspace.locator("#reviewRevision").waitFor({ state: "attached" });
  await workspace.locator(".review-diff, .review-patch").first().waitFor();

  // Task B: planned work renders the honest unrun state.
  await workspace.locator('[data-action="workspace-back"]').click();
  await page.locator('[data-task="T-002"]').first().click();
  await workspace.locator(".task-detail-title").waitFor();
  assert.equal(await workspace.getAttribute("data-workspace-task-id", { exact: true }) ?? (await workspace.locator(".task-workspace").getAttribute("data-workspace-task-id")), "T-002");
  await workspace.locator('[data-action="workspace-view:activity"]').click();
  await workspace.getByText("Planned. ATL has not started yet.").waitFor();

  // Selection and view survive a reload.
  await workspace.locator('[data-action="workspace-view:process"]').click();
  await workspace.locator(".process-flow").waitFor();
  await page.reload();
  await page.locator("#taskWorkspace .task-workspace").waitFor();
  assert.equal(await page.locator("#taskWorkspace .task-workspace").getAttribute("data-workspace-task-id"), "T-002", "selection persists across reload");
  assert.equal(await page.locator("#taskWorkspace .task-workspace").getAttribute("data-workspace-view"), "process", "view persists across reload");

  // Ask ATL mounts inline from the workspace composer.
  await workspace.locator('[data-action="workspace-back"]').click();
  await page.locator('[data-page="tasks"]:visible').first().click();
  await page.locator('[data-task="T-001"]').first().click();
  await workspace.locator(".task-detail-title").waitFor();
  await workspace.locator("#workspaceMessage").fill("What changed in this task?");
  await workspace.locator('[data-action="workspace-ask:T-001"]').click();
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
  await workspace.locator("#workspaceMessage").fill("Diagnose the planned scope.");
  await workspace.locator('[data-action="workspace-ask:T-002"]').click();
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
  await page.unrouteAll({ behavior: "wait" });

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
