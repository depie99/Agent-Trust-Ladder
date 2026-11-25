import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { chromium } from "playwright";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-modals-"));
fs.mkdirSync(path.join(root, "config"));
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
const state = emptyState();
state.tasks["T-021"] = { id: "T-021", title: "Record the baseline", status: "done", completion_checks: [], evidence: [] };
state.tasks["T-022"] = { id: "T-022", title: "Handle mixed-direction dynamic content across task details and evidence", objective: "Make dynamic Control Plane content bidi-safe while preserving readable task evidence.", status: "blocked", priority: "normal", blocker: { reason: "worker did not advance T-022 from assigned; inspect the log and feed", cause: "provider-model-unavailable", detail: "The selected model gpt-6.2-sol is not available to this provider CLI or login. Rerun with gpt-5.6-terra or update the provider CLI.", log_path: ".trust/manager/overnight/T-022/session-01-rowan-123.log", next_actions: [{ kind: "provider-model", label: "Use a supported model", instruction: "Rerun with gpt-5.6-terra or update the provider CLI.", provider: "codex", model: "gpt-5.6-terra" }] }, plan_depends_on: ["T-021"], completion_checks: ["Rendered inspection shows correct task title", "Bidi paths remain isolated"], review_required: true, input_revisions: { "T-018": "a".repeat(40), "T-019": "b".repeat(40) }, execution_budget: { used: 1, max_sessions: 3 } };
saveState(root, state);
// A session that changed nothing must never inherit the green "Complete" pill.
const clientSource = fs.readFileSync(new URL("../runtime/control-plane-client.js", import.meta.url), "utf8");
const pillStart = clientSource.indexOf("  const workspaceOutcomePill =");
assert.ok(pillStart >= 0);
const pillScope = vm.createContext({});
vm.runInContext(`${clientSource.slice(pillStart, clientSource.indexOf("\n  };", pillStart) + 5)}\nglobalThis.workspaceOutcomePill = workspaceOutcomePill;`, pillScope);
assert.match(pillScope.workspaceOutcomePill("no-state-change"), /No state change/);
assert.doesNotMatch(pillScope.workspaceOutcomePill("no-state-change"), /Complete/);
assert.match(pillScope.workspaceOutcomePill("complete"), /✓ Complete/);
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
    // Blocker surfaces inline with its recovery actions; the redesigned
    // workspace renders the bar in both the detail decisions and the activity
    // body, so target the first instance.
    await workspace.locator('[data-action="unblock:T-022"]').first().waitFor();
    await workspace.locator('[data-action="task-recovery:T-022"]').first().waitFor();
    await workspace.locator(".blocker-detail").first().waitFor();
    assert.match(await workspace.locator(".blocker-detail").first().textContent(), /What happened/);
    assert.match(await workspace.locator(".blocker-detail").first().textContent(), /gpt-6\.2-sol/);
    assert.match(await workspace.locator(".blocker-detail").first().textContent(), /gpt-5\.6-terra/);
    // The recovery popup names the actual handoff and its next action instead
    // of showing a generic "unavailable handoff" step.
    await workspace.locator('[data-action="task-recovery:T-022"]').first().click();
    await dialog.locator('[data-action="unblock:T-022"]').waitFor();
    assert.match(await dialog.locator("#modalTitle").textContent(), /Recovery proposal · T-022/, "the recovery proposal popup is open");
    const proposalText = await dialog.locator(".dialogbody").textContent();
    assert.match(proposalText, /T-021 · Record the baseline/);
    assert.match(proposalText, /Next actions/);
    assert.doesNotMatch(proposalText, /Review each unavailable handoff/);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0, "closing the recovery popup leaves the task untouched");
    // A recorded fix is previewed with its exact solution, then confirmed.
    let confirmedFix = null;
    await page.route("**/api/task-recovery/fix", async (route) => {
      confirmedFix = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true, detail: "Provider route set to codex/gpt-5.6-terra.", requiresUnblock: true } });
    });
    await workspace.locator('[data-action="blocker-fix:T-022:0"]').first().click();
    assert.match(await dialog.locator(".dialogbody").textContent(), /codex\/gpt-5\.6-terra/);
    await dialog.locator('[data-action="blocker-fix-confirm:T-022:0"]').click();
    assert.equal(confirmedFix?.confirm, true);
    assert.equal(confirmedFix?.fix?.model, "gpt-5.6-terra");
    await dialog.getByText(/Provider route set to codex\/gpt-5\.6-terra/).waitFor();
    await page.keyboard.press("Escape");
    await page.unroute("**/api/task-recovery/fix");
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
    // The redesigned disclosure carries the state in its summary text; the
    // pill card lives only in the task-detail dialog.
    await workspace.locator('[data-workspace-disclosure="browser"] summary').getByText("allowed", { exact: false }).waitFor();
    const browserConfig = JSON.parse(fs.readFileSync(path.join(root, "config/manager.json"), "utf8"));
    assert.equal(browserConfig.ui_review.browser_access.tasks["T-022"], "approved");
    assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, ".trust/manager/state.json"), "utf8")).tasks["T-022"].execution_budget), budgetBefore);
    await workspace.locator("#taskBrowserAccess").selectOption("inherit");
    await workspace.locator('[data-action="browser-task-save:T-022"]').click();
    await workspace.locator('[data-workspace-disclosure="browser"] summary').getByText("needs approval", { exact: false }).waitFor();
    assert.equal(await workspace.locator("#taskBrowserAccess").inputValue(), "inherit");
    const taskOverflow = await workspace.locator('[data-workspace-disclosure="browser"]').evaluate((node) => node.scrollWidth - node.clientWidth);
    assert.ok(taskOverflow <= 1, "browser access controls fit the desktop/mobile task inspector");
    await workspace.locator('[data-workspace-disclosure="acceptance"] summary').click();
    assert.equal(await workspace.locator('[data-workspace-disclosure="acceptance"]').getAttribute("open"), "", "acceptance criteria expand on demand");
    // Ask ATL mounts inline in the workspace composer.
    let verifiedConversation = false;
    await page.route("**/api/assistant", async (route) => {
      const request = route.request().postDataJSON();
      if (request.action === "send") {
        assert.equal(request.scope, "T-022");
        assert.match(request.message, /What blocks T-022/);
        verifiedConversation = true;
        return route.fulfill({ json: { ok: true } });
      }
      const response = await route.fetch(); const result = await response.json();
      result.providers = [{ id: "codex", label: "Codex", installed: true, signedIn: true, defaultModel: "test-model", models: [{ id: "test-model" }] }];
      if (verifiedConversation && request.scope === "T-022") {
        result.session = { ...result.session, status: "complete", output: "", diagnostic: "",
          messages: [{ role: "assistant", text: "The task workspace lacks the required snapshot. Restore the snapshot and rerun rendered inspection." }] };
      }
      await route.fulfill({ response, json: result });
    });
    await workspace.locator("#workspaceMessage").fill("What blocks T-022?");
    await workspace.locator('[data-action="workspace-ask:T-022"]').click();
    await workspace.locator(".assistant-guidance").waitFor();
    assert.equal(await workspace.locator("#assistantTranscript").count(), 1, "inline assistant lives in the workspace");
    let checkedProvider;
    await page.route("**/api/execution-access", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      checkedProvider = route.request().postDataJSON().provider;
      await route.fulfill({ json: { ok: true, check: { ok: true, detail: "Selected provider verified" } } });
    });
    // After workspace-ask, the mounted assistant panel carries the Workspace
    // access control in its toolbar; the activity disclosures stay behind the
    // takeover, so drive the visible toolbar button.
    await workspace.locator('.assistant-toolbar [data-action="access-open:T-022"]').click();
    await dialog.locator('[data-action="access-check:T-022"]').click();
    await dialog.getByText("Selected provider verified", { exact: true }).waitFor();
    assert.equal(checkedProvider, "codex", "the probe checks the selected provider, not the unrelated GapCode default");
    await page.unroute("**/api/execution-access");
    await page.keyboard.press("Escape");
    // MCP denial shortcut lands on the browser permission control.
    await workspace.locator('[data-action="browser-open:T-022"]').first().click();
    await workspace.locator("#taskBrowserAccess").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "taskBrowserAccess", "MCP denial leads directly to the task browser permission control");

    // Workspace assistant round-trip through the redesigned composer:
    // workspace-ask mounts the panel, then the panel composer sends.
    await workspace.locator("#assistantMessage").fill("What blocks T-022?");
    const assistant = workspace.locator("[data-workspace-assistant]");
    const screenshotDir = process.env.ATL_ASK_TEST_EVIDENCE_DIR;
    if (screenshotDir && viewport.width === 390) await assistant.screenshot({ path: path.join(screenshotDir, "before.png") });
    await assistant.locator('[data-action="assistant-send"]').click();
    await assistant.getByText(/Restore the snapshot and rerun rendered inspection/).waitFor();
    assert.equal(verifiedConversation, true);
    if (screenshotDir && viewport.width === 390) await assistant.screenshot({ path: path.join(screenshotDir, "after.png") });

    // The redesigned Ask ATL page: landing hero, chat rail, context picker
    // (imported tasks only) and the segmented Ask/Diagnose/Fix composer.
    await page.locator('[data-page="assistant"]:visible').first().click();
    await page.locator(".ask-landing").waitFor();
    await page.locator("#askInput").waitFor();
    if (viewport.width === 390) {
      await page.locator(".ask-burger").click();
      assert.equal(await page.locator(".ask-page.ask-rail-open").count(), 1, "the mobile burger opens the chat drawer");
      // The drawer covers the viewport's left ~300px, so tap the scrim on
      // its far side (the pane is ~374px wide; stay inside its box).
      await page.locator(".ask-scrim").click({ position: { x: 360, y: 300 } });
      assert.equal(await page.locator(".ask-page.ask-rail-open").count(), 0, "tapping the scrim closes the chat drawer");
    } else {
      await page.locator(".ask-rail .ask-new").waitFor();
    }
    await page.locator('[data-action="ask-picker"]').first().click();
    await dialog.locator(".ask-picker").waitFor();
    assert.match(await dialog.locator(".ask-picker-body").textContent(), /No imported tasks yet/, "the picker lists imported tasks only; native tasks stay out");
    await dialog.locator('[data-action="ask-picker-tab:project"]').click();
    await dialog.locator("#askPickerProject").check();
    await dialog.locator('[data-action="ask-picker-apply"]').click();
    assert.equal(await dialog.count(), 0, "the picker closes on apply");
    assert.ok(await page.locator(".ask-composer-chips .ask-chip").count() >= 1, "applied context appears as a composer chip");
    assert.ok(await page.locator('[data-action="ask-mode:fix"]').isDisabled(), "fix stays disabled without a workspace-capable task context");
    assert.ok(await page.locator(".ask-attach").count() === 1, "the composer carries the square attach button");
    if (viewport.width === 390) {
      // Narrow screens collapse the segmented pills into the mode select.
      assert.equal(await page.locator("#askModeSelect").count(), 1, "the mobile mode pill renders");
      assert.ok(await page.locator('#askModeSelect option[value="fix"]').isDisabled(), "fix stays disabled in the mobile mode pill");
      await page.locator("#askModeSelect").selectOption("diagnose");
      assert.equal(await page.locator("#askModeSelect").inputValue(), "diagnose", "the mobile mode pill switches mode");
    } else {
      await page.locator('[data-action="ask-mode:diagnose"]').click();
      assert.match(await page.locator(".ask-seg.on").textContent(), /Diagnose/, "mode switches update the segmented control");
    }
    // Measure after scroll-reset and two stable frames so a racing snapshot
    // repaint cannot skew the box (CI runners repaint later than locals).
    const composerFit = await page.evaluate(() => new Promise((resolve) => {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const node = document.querySelector(".ask-composer");
        if (!node) return resolve(false);
        const rect = node.getBoundingClientRect();
        resolve(rect.top >= 0 && rect.bottom <= window.innerHeight + 2);
      }));
    }));
    assert.ok(composerFit, "the Ask ATL composer fits the viewport");
    if (process.env.ATL_ASSISTANT_SCREENSHOT && viewport.width === 390) await page.locator(".ask-page").screenshot({ path: process.env.ATL_ASSISTANT_SCREENSHOT });
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
