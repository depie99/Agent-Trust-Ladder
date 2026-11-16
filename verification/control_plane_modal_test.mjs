import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-modals-"));
fs.mkdirSync(path.join(root, "config"));
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
const state = emptyState();
state.tasks["T-022"] = { id: "T-022", title: "Handle mixed-direction dynamic content across task details and evidence", objective: "Make dynamic Control Plane content bidi-safe while preserving readable task evidence.", status: "blocked", priority: "normal", blocker: { reason: "Rendered inspection remains blocked because the task workspace lacks the required snapshot. Review the scoped diff and evidence before resuming." }, completion_checks: ["Rendered inspection shows correct task title", "Bidi paths remain isolated"], review_required: true, input_revisions: { "T-018": "a".repeat(40), "T-019": "b".repeat(40) }, execution_budget: { used: 1, max_sessions: 3 } };
saveState(root, state);
fs.mkdirSync(path.join(root, ".trust/manager/assistant"), { recursive: true });
fs.writeFileSync(path.join(root, ".trust/manager/assistant/T-022.json"), JSON.stringify({ scope: "T-022", status: "failed", mode: "fix", provider: "gapgpt", messages: [], output: "browser_preview was denied.", diagnostic: "MCP tool call requires approval, but approval policy is never" }));
let browser, server;
try {
  const started = await startControlPlaneServer(root);
  server = started.server;
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 667 }]) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(8000);
    await page.goto(started.url);
    await page.locator('#newBtn').click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.count(), 1);
    assert.equal(await dialog.getAttribute("aria-labelledby"), "modalTitle");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "fTitle");
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, `task modal fits ${viewport.width}x${viewport.height}`);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-action")), "close", "reverse tab stays within dialog");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "newBtn", "focus returns to opener");

    await page.locator('#noticesBtn').click();
    assert.equal(await dialog.count(), 1);
    await page.keyboard.press("n");
    assert.match(await dialog.locator("#modalTitle").textContent(), /Notifications/, "page shortcuts cannot replace an open dialog");
    await page.keyboard.press("Escape");

    await page.locator('[data-page="tasks"]:visible').first().click();
    await page.locator('[data-task="T-022"]').first().click();
    const workspace = page.locator("#taskWorkspace");
    await workspace.locator(".task-detail-title").waitFor();
    assert.equal(await workspace.getAttribute("data-task-view"), "activity", "task-detail links open the Activity view");
    if (process.env.ATL_MODAL_SCREENSHOT && viewport.width === 390) { await page.evaluate(() => document.documentElement.classList.remove("light")); await workspace.screenshot({ path: process.env.ATL_MODAL_SCREENSHOT }); }
    const titleFont = await workspace.locator(".task-detail-title").evaluate((node) => getComputedStyle(node).fontFamily);
    assert.doesNotMatch(titleFont, /ui-monospace|Consolas/i, "task text uses a reading font");
    // Blocker surfaces inline above the composer with its recovery actions.
    await workspace.locator('[data-action="unblock:T-022"]').waitFor();
    await workspace.locator('[data-action="task-recovery:T-022"]').waitFor();
    // Operator tools stay reachable; the route flow returns to the workspace.
    await workspace.locator('[data-action="task-actions:T-022"]').click();
    await dialog.locator('[data-action="task-route:T-022"]').click();
    await dialog.locator("#taskRouteSelect").waitFor();
    assert.equal(await dialog.locator("#taskRouteSelect").inputValue(), "", "task route inherits the project by default");
    await dialog.locator('[data-action="task-route-save:T-022"]').click();
    await page.keyboard.press("Escape");
    await workspace.locator(".task-detail-title").waitFor();
    const budgetBefore = JSON.stringify(state.tasks["T-022"].execution_budget);
    // Browser access lives in its disclosure; the inline decision points there.
    await workspace.locator('[data-workspace-disclosure="browser"] summary').click();
    await workspace.locator("#taskBrowserAccess").waitFor();
    await page.route("**/api/browser-access", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not found" }) }));
    await workspace.locator('[data-action="browser-check:T-022"]').click();
    await workspace.getByText("The running server does not support browser access settings. Restart it from this project's runtime, then reload this page.", { exact: true }).waitFor();
    await page.unroute("**/api/browser-access");
    await workspace.locator("#taskBrowserAccess").selectOption("approved");
    await workspace.locator('[data-action="browser-task-save:T-022"]').click();
    await workspace.locator('[data-workspace-disclosure="browser"] [data-browser-access] .pill.green').waitFor();
    const browserConfig = JSON.parse(fs.readFileSync(path.join(root, "config/manager.json"), "utf8"));
    assert.equal(browserConfig.ui_review.browser_access.tasks["T-022"], "approved");
    assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, ".trust/manager/state.json"), "utf8")).tasks["T-022"].execution_budget), budgetBefore);
    await workspace.locator("#taskBrowserAccess").selectOption("inherit");
    await workspace.locator('[data-action="browser-task-save:T-022"]').click();
    await workspace.locator('[data-workspace-disclosure="browser"] [data-browser-access] .pill.amber').waitFor();
    assert.equal(await workspace.locator("#taskBrowserAccess").inputValue(), "inherit");
    const taskOverflow = await workspace.locator('[data-workspace-disclosure="browser"] [data-browser-access]').evaluate((node) => node.scrollWidth - node.clientWidth);
    assert.ok(taskOverflow <= 1, "browser access controls fit the desktop/mobile task inspector");
    await workspace.locator('[data-workspace-disclosure="acceptance"] summary').click();
    assert.equal(await workspace.locator('[data-workspace-disclosure="acceptance"]').getAttribute("open"), "", "acceptance criteria expand on demand");
    // Ask ATL mounts inline in the workspace composer.
    await page.route("**/api/assistant", async (route) => {
      const response = await route.fetch(); const result = await response.json();
      result.providers = [{ id: "codex", label: "Codex", installed: true, signedIn: true, defaultModel: "test-model", models: [{ id: "test-model" }] }];
      await route.fulfill({ response, json: result });
    });
    await workspace.locator('[data-action="assistant-open:T-022"]').click();
    await workspace.locator(".assistant-guidance").waitFor();
    assert.equal(await workspace.locator("#assistantTranscript").count(), 1, "inline assistant lives in the workspace");
    let checkedProvider;
    await page.route("**/api/execution-access", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      checkedProvider = route.request().postDataJSON().provider;
      await route.fulfill({ json: { ok: true, check: { ok: true, detail: "Selected provider verified" } } });
    });
    await workspace.locator('[data-action="access-open:T-022"]').first().click();
    await dialog.locator('[data-action="access-check:T-022"]').click();
    await dialog.getByText("Selected provider verified", { exact: true }).waitFor();
    assert.equal(checkedProvider, "codex", "the probe checks the selected provider, not the unrelated GapCode default");
    await page.unroute("**/api/execution-access");
    await page.keyboard.press("Escape");
    // MCP denial shortcut lands on the browser permission control.
    await workspace.locator('[data-action="browser-open:T-022"]').first().click();
    await workspace.locator("#taskBrowserAccess").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "taskBrowserAccess", "MCP denial leads directly to the task browser permission control");

    await page.locator('[data-page="assistant"]:visible').first().click();
    await page.locator('[data-action="assistant-open:global"]').first().click();
    await dialog.locator("#assistantTranscript").waitFor();
    if (process.env.ATL_ASSISTANT_SCREENSHOT && viewport.width === 390) await dialog.screenshot({ path: process.env.ATL_ASSISTANT_SCREENSHOT });
    await dialog.locator(".assistant-guidance").evaluate((node) => { node.open = true; });
    await dialog.locator('[data-action="assistant-suggest"]').click();
    assert.match(await dialog.locator("#assistantMessage").inputValue(), /T-022/, "suggestion names the current blocked task");
    const assistantBounds = await dialog.boundingBox();
    assert.ok(assistantBounds.y >= 0 && assistantBounds.y + assistantBounds.height <= viewport.height + 1, "Ask ATL modal fits viewport");
    await dialog.locator('[data-action="access-open:global"]').click();
    await dialog.waitFor();
    await dialog.locator('#taskAccessMode').waitFor();
    const accessBounds = await dialog.boundingBox();
    assert.ok(accessBounds.y >= 0 && accessBounds.y + accessBounds.height <= viewport.height + 1, "workspace access modal fits viewport");
    const overflow = await dialog.evaluate((node) => ({ body: node.querySelector(".dialogbody").scrollWidth - node.querySelector(".dialogbody").clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    assert.ok(overflow.body <= 1 && overflow.page <= 1, "workspace access has no horizontal overflow");
    await page.keyboard.press("Escape");
    await page.locator('[data-page="settings"]:visible').first().click();
    await page.locator("#browserAccessDefault").waitFor();
    await page.locator("#browserAccessDefault").selectOption("approved");
    await page.locator('[data-action="browser-default-save"]').click();
    await page.getByText("Browser access saved for future runs. No run was started.", { exact: true }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "config/manager.json"), "utf8")).ui_review.browser_access.default, "approved");
    await page.locator("#browserAccessDefault").selectOption("approval-required");
    await page.locator('[data-action="browser-default-save"]').click();
    await page.waitForFunction(() => document.querySelector("#browserAccessDefault")?.value === "approval-required" && !document.querySelector('[data-action="browser-default-save"]')?.disabled);
    await page.close();
  }
  console.log("PASS: desktop/mobile modal bounds, focus, escape, workspace access, browser project/task controls and MCP failure shortcut");
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
