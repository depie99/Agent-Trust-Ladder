// Captured source is the oracle. Exercise large-graph expansion and the real
// review UI in browser and harness presentation, retaining visual evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fixture } from "./fixtures/task-changes/project.mjs";
import { snapshot } from "../runtime/lib/handoffs.mjs";
import { captureChangeReview } from "../runtime/lib/change-review-store.mjs";
import { loadState, saveState } from "../runtime/lib/state.mjs";
import { recordExecution } from "../runtime/lib/execution-report.mjs";
import { digest, fileDiff } from "../runtime/lib/task-changes.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const f = fixture();
const before = Array.from({ length: 1200 }, (_, index) => `const row${index} = 'before <&> 123';`);
f.write("runtime/multiple.js", before.join("\n") + "\n");
f.task.objective = 'Inspect <img src=x onerror="window.__unsafeReview=true"> [recorded changes]';
f.task.handoff_baseline = snapshot(f.root, f.workspace); f.persist();
f.edit();
const after = before.map((line, index) => index % 8 === 0 ? `const row${index} = 'after <&> 456';` : line);
after[16] = "++ text resembling a patch header";
f.write("runtime/multiple.js", after.join("\n") + "\n");
for (let index = 0; index < 230; index++) f.write(`generated/file-${String(index).padStart(3, "0")}.js`, `export const value = ${index};\n`);
const capture = captureChangeReview(f.root, f.task);
{
  const state = loadState(f.root);
  state.tasks["T-001"].evidence = [
    { kind: "check", check: "behavior", result: "fail", at: "2026-11-20T01:10:00Z", session_id: "failed-attempt", coverage: "complete", command: "check-fixture", code_revision: capture.output.revision, packet_revision: 1 },
    { kind: "check", check: "behavior", result: "pass", at: "2026-11-20T01:20:00Z", session_id: "retry-attempt", coverage: "complete", command: "check-fixture", code_revision: capture.output.revision, packet_revision: 1 },
  ];
  state.tasks["T-002"] = { id: "T-002", title: "Missing baseline", status: "new", completion_checks: [], evidence: [] };
  saveState(f.root, state);
  for (const [id, exitCode, minute] of [["failed-attempt", 1, "00"], ["retry-attempt", 0, "15"]]) recordExecution(f.root, { id, taskId: "T-001", role: "rowan", provider: "fixture", startedAt: `2026-11-20T01:${minute}:00Z`, finishedAt: `2026-11-20T01:${minute === "00" ? "10" : "20"}:00Z`, exitCode, packetRevision: 1 });
}
const evidenceDir = path.resolve(".atl-evidence/task-review-workspace"); fs.mkdirSync(evidenceDir, { recursive: true });
const running = await startControlPlaneServer(f.root);
let browser;
try {
  const boot = await fetch(running.url), html = await boot.text();
  const headers = { cookie: boot.headers.get("set-cookie").split(";")[0], "x-atl-csrf": html.match(/name="atl-csrf" content="([^"]+)"/)[1], "content-type": "application/json" };
  const get = async (route) => { const response = await fetch(`${running.url}${route}`, { headers }); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const childUrl = `api/task-impact-children?taskId=T-001&changeSetId=${capture.id}`;
  assert.equal((await fetch(`${running.url}${childUrl}`)).status, 403);
  assert.equal((await fetch(`${running.url}${childUrl}&cursor=-1`, { headers })).status, 400);
  assert.equal((await fetch(`${running.url}${childUrl}&fileId=foreign`, { headers })).status, 404);
  const metaBefore = fs.readFileSync(path.join(f.root, ".trust/manager/state.json"), "utf8");
  const late = await get(`${childUrl}&cursor=200`);
  assert.ok(late.nodes.some((node) => node.label === "generated/file-229.js"), "files beyond the initial graph remain expandable");
  const fileId = digest("runtime/multiple.js"), patch = fileDiff(f.root, capture, fileId);
  const headersInPatch = patch.patch.match(/^@@[^\n]*/gm);
  assert.equal(headersInPatch.length, 150, "fixture contains multiple separated hunks");
  const first = await get(`${childUrl}&fileId=${fileId}`), next = await get(`${childUrl}&fileId=${fileId}&cursor=${first.next_cursor}`);
  assert.equal(first.nodes.length, 100); assert.equal(next.nodes.length, 50); assert.equal(next.next_cursor, null);
  assert.deepEqual([...first.nodes, ...next.nodes].map((node) => node.header), headersInPatch);
  assert.equal(next.nodes.at(-1).hunk_index, 149);
  assert.equal(fs.readFileSync(path.join(f.root, ".trust/manager/state.json"), "utf8"), metaBefore, "expansion never mutates task state");
  assert.equal((await get(`${childUrl}&fileId=${digest("binary.bin")}`)).availability, "binary");
  assert.equal((await get(`${childUrl}&fileId=${digest(".env")}`)).availability, "redacted");
  const found = await get(`api/task-changes?taskId=T-001&changeSetId=${capture.id}&q=multiple.js`);
  assert.equal(found.files.length, 1, "search finds paths beyond the initial metadata page");
  const graph = (await get("api/task-execution?taskId=T-001")).graph;
  assert.equal(graph.total_files, 236); assert.equal(graph.files_truncated, true);
  assert.deepEqual(graph.nodes.filter((node) => node.kind === "check").map((node) => node.result), ["fail", "pass"]);

  browser = await chromium.launch({ headless: true });
  const matrix = [];
  for (const config of [
    { name: "browser-dark", width: 1280, plugin: false, theme: "dark", rtl: false },
    { name: "harness-light", width: 1280, plugin: true, theme: "light", rtl: false },
    { name: "harness-narrow-rtl", width: 390, plugin: true, theme: "light", rtl: true },
  ]) {
    console.log(`RUN: ${config.name}`);
    const context = await browser.newContext({ viewport: { width: config.width, height: 850 }, acceptDownloads: true });
    await context.addInitScript(({ theme }) => localStorage.setItem("atl-cp-theme", theme), config);
    if (config.plugin) await context.route(running.url, async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace("<html", '<html data-atl-context="plugin"') }); });
    const page = await context.newPage(), errors = [], writes = [];
    page.setDefaultTimeout(15000); page.on("pageerror", (error) => errors.push(String(error)));
    page.on("request", (request) => { if (request.method() !== "GET") writes.push({ route: new URL(request.url()).pathname, body: request.postData() }); });
    await page.goto(running.url);
    if (!config.plugin) await page.locator('[data-page="tasks"]:visible').first().click();
    await page.locator('[data-task="T-001"] .task-main-copy').press("Enter");
    const workspace = page.locator(".task-workspace");
    await workspace.locator('[data-action="workspace-view:changes"]').press("Enter");
    await workspace.locator("#reviewSearch").fill("multiple.js");
    await workspace.locator(`[data-review-action="file:${fileId}"]`).click();
    await workspace.locator(".diff-line.add").first().waitFor();
    assert.equal(await workspace.locator(".diff-hunkbar").count(), 150);
    assert.equal(await workspace.locator(".diff-line.add .diff-code").first().textContent(), after[0], "highlighting preserves escaped source exactly");
    assert.equal(await workspace.locator('.diff-line.add[data-line="17"] .diff-code').textContent(), after[16], "patch-header-like source is preserved");
    const unified = await workspace.locator(".diff-line.add, .diff-line.del").evaluateAll((rows) => rows.map((row) => [row.dataset.side, row.dataset.line, row.querySelector(".diff-code").textContent]));
    await workspace.locator('[data-review-action="split-toggle"]').click();
    const split = await workspace.locator(".split-line.add, .split-line.del").evaluateAll((rows) => rows.map((row) => [row.dataset.side, row.dataset.line, row.querySelector("code").textContent]));
    assert.deepEqual(split.sort(), unified.sort(), "split and unified represent identical source lines and anchors");
    await workspace.locator('[data-review-action="split-toggle"]').click();
    await workspace.locator("#reviewPanel").focus(); await page.keyboard.press("n");
    assert.equal(await page.locator("#modal[open]").count(), 0, "hunk shortcut must not open the global new-task dialog");
    await workspace.locator('[data-review-action="comment-at:new:17"]').click();
    await workspace.locator("#reviewDraft").fill(`${config.name}: header-like line`);
    await workspace.locator('[data-review-action="comment-save"]').click();
    await workspace.getByText(`${config.name}: header-like line`, { exact: true }).waitFor();
    if ((await workspace.locator('[data-review-action="file-reviewed"]').textContent()) !== "Reviewed") await workspace.locator('[data-review-action="file-reviewed"]').click();
    if (config.name === "browser-dark") {
      await workspace.locator('[data-review-action="comment-file"]').click();
      await workspace.locator("#reviewDraft").fill("Draft belongs to the multiple-hunk file");
      await workspace.locator("#reviewSearch").fill("file-229.js");
      await workspace.locator(`[data-review-action="file:${digest("generated/file-229.js")}"]`).click();
      assert.equal(await workspace.locator("#reviewDraft").count(), 0, "switching files never retargets an unfinished comment");
      await workspace.locator("#reviewSearch").fill("multiple.js");
      await workspace.locator(`[data-review-action="file:${fileId}"]`).click();
      assert.equal(await workspace.locator("#reviewDraft").inputValue(), "Draft belongs to the multiple-hunk file");
    }
    await page.reload();
    await workspace.getByText(`${config.name}: header-like line`, { exact: true }).waitFor();
    await workspace.locator(".diff-line.add").first().waitFor();
    assert.equal(await workspace.locator("#reviewRevision").inputValue(), capture.id);
    assert.equal(await workspace.locator('[data-review-action="file-reviewed"]').textContent(), "Reviewed");
    if (config.name === "browser-dark") {
      assert.equal(await workspace.locator("#reviewDraft").inputValue(), "Draft belongs to the multiple-hunk file", "draft survives reload on the same capture and file");
      await workspace.locator('[data-review-action="comment-cancel"]').click();
    }
    if (config.rtl) await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    assert.equal(await workspace.locator(".diff-view").evaluate((node) => getComputedStyle(node).direction), "ltr");
    const aria = await workspace.locator("#reviewPanel").ariaSnapshot();
    assert.match(aria, /Comment on new line 17/); assert.match(aria, /Previous hunk/);
    fs.writeFileSync(path.join(evidenceDir, `${config.name}-accessibility.yml`), aria);
    await workspace.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(evidenceDir, `${config.name}-changes.png`), fullPage: false });
    if (config.width < 760) {
      assert.equal(await workspace.locator(".review-tree").isVisible(), false);
      await workspace.locator('[data-review-action="back-files"]').click();
      await workspace.locator(".review-tree").waitFor();
      assert.equal(await workspace.locator(".review-patch").isVisible(), false);
      await workspace.locator(`[data-review-action="file:${fileId}"]`).click();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, "review must fit the viewport");
    await workspace.locator('[data-action="workspace-view:process"]').click();
    await workspace.locator(".process-execution-svg").waitFor();
    const execution = workspace.locator(".process-execution-diagram");
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Clipboard unavailable in fixture"); } } }));
    await execution.locator('[data-action="impact-copy"]').click();
    const source = page.locator('textarea[aria-label="Mermaid source"]');
    await source.waitFor(); assert.match(await source.inputValue(), /attempt/); assert.doesNotMatch(await source.inputValue(), /file:/);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await source.waitFor({ state: "hidden" });
    await workspace.locator('[data-action="process-impact"]').click();
    await workspace.locator(".process-impact-svg").waitFor();
    assert.equal(await workspace.locator(".process-impact-svg foreignObject, .process-impact-svg script").count(), 0, "safe renderer uses SVG text without active HTML");
    const downloadEvent = page.waitForEvent("download");
    await workspace.locator('.process-impact [data-action="impact-export"]').click();
    const exported = await downloadEvent;
    await exported.saveAs(path.join(evidenceDir, `${config.name}-impact.svg`));
    assert.match(fs.readFileSync(path.join(evidenceDir, `${config.name}-impact.svg`), "utf8"), /<svg/);
    await page.screenshot({ path: path.join(evidenceDir, `${config.name}-process.png`), fullPage: false });
    await workspace.locator('.process-impact [data-action="impact-list"]').click();
    if (!(await workspace.locator(".process-impact-list").isVisible())) await workspace.locator('.process-impact [data-action="impact-list"]').click();
    const lateCapture = workspace.locator(`.process-impact-list [data-action="impact-expand:${encodeURIComponent(`capture:${capture.id}`)}"]`);
    await lateCapture.click();
    await workspace.locator('[data-impact-status]').filter({ hasText: "captured items loaded" }).waitFor();
    await workspace.locator('.process-impact-list [data-action^="impact-node:group%3Adirectory%3Aruntime"]').click();
    const expandFile = workspace.locator(`[data-action="impact-expand:${encodeURIComponent(`file:${capture.id}:${fileId}`)}"]`);
    await expandFile.click();
    await workspace.locator('[data-impact-status]').filter({ hasText: "100 captured items loaded" }).waitFor();
    await expandFile.click();
    await workspace.locator('[data-impact-status]').filter({ hasText: "50 captured items loaded" }).waitFor();
    await workspace.locator('.process-impact-list [data-action^="impact-node:group%3Ahunks"]').click();
    const lastHunk = workspace.locator('.process-impact-list button').filter({ hasText: headersInPatch.at(-1) });
    await lastHunk.press("Enter");
    await workspace.locator(".diff-hunkbar").last().waitFor();
    assert.equal(await workspace.locator("#reviewRevision").inputValue(), capture.id, "lazy hunk navigation remains pinned");
    assert.equal(await page.evaluate(() => Boolean(window.__unsafeReview)), false, "artifact labels never execute HTML");
    assert.deepEqual(errors, []); assert.ok(writes.every(({ route, body }) => route === "/api/task-review-state" || (route === "/api/plan/drafts" && body === "{}")), `opening and expanding only reads saved drafts or writes explicit local review notes: ${JSON.stringify(writes)}`);
    matrix.push({ ...config, result: "pass", interactions: "search, split parity, keyboard, comment, reload, accessible labels, captured file/hunk expansion" });
    console.log(`PASS: ${config.name} review journey`);
    await context.close();
  }
  // Re-capture never presents annotations on previous source as current.
  f.write("runtime/multiple.js", "const currentRevision = true;\n");
  const newer = captureChangeReview(f.root, loadState(f.root).tasks["T-001"]);
  const historyContext = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const historyPage = await historyContext.newPage();
  await historyPage.goto(running.url); await historyPage.locator('[data-page="tasks"]:visible').first().click();
  await historyPage.locator('[data-task="T-001"] .task-main-copy').click();
  await historyPage.locator('[data-action="workspace-view:changes"]').click();
  await historyPage.locator("#reviewSearch").fill("multiple.js");
  await historyPage.locator(`[data-review-action="file:${fileId}"]`).click();
  await historyPage.locator(".review-history summary").click();
  assert.equal(await historyPage.locator("#reviewRevision").inputValue(), newer.id);
  assert.equal(await historyPage.locator(".review-notes > .review-comment").count(), 0);
  assert.equal(await historyPage.locator(".review-history .review-comment").count(), 3);
  assert.equal(await historyPage.locator('[data-review-action="file-reviewed"]').textContent(), "Mark reviewed");
  await historyPage.screenshot({ path: path.join(evidenceDir, "historical-comments.png"), fullPage: false });
  await historyPage.locator("#reviewRevision").selectOption(capture.id);
  await historyPage.getByText("browser-dark: header-like line", { exact: true }).waitFor();
  await historyPage.reload(); await historyPage.getByText("browser-dark: header-like line", { exact: true }).waitFor();
  assert.equal(await historyPage.locator("#reviewRevision").inputValue(), capture.id, "an older revision remains explicitly selected across reloads");
  await historyContext.close();
  fs.writeFileSync(path.join(evidenceDir, "acceptance-matrix.json"), JSON.stringify({ at: new Date().toISOString(), cases: matrix, external_screen_reader: "not exercised; browser accessibility tree and keyboard observed" }, null, 2));
  console.log("PASS: task review acceptance — paged graph, pinned multi-hunk navigation, source parity, labels, browser/harness themes and RTL");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => running.server.close(resolve)); f.cleanup();
}
