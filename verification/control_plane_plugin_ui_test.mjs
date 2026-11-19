// Plugin presentation journey (ZCode native panel context).
// The suite serves the real Control Plane with synthetic tasks and marks the
// document exactly the way plugins/panel-entry.mjs does (dataset.atlContext)
// before any client script runs, then drives the compact task-first UI:
// destinations, landing, filters, ordering, detail navigation (narrow screen
// and wide split), overflow menu, stale/retry, creation, RTL and viewports.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plugin-ui-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
const state = emptyState();
state.tasks["T-101"] = { id: "T-101", title: "Plugin running task", status: "in_progress", priority: "high", completion_checks: [], evidence: [] };
state.tasks["T-102"] = { id: "T-102", title: "Plugin queued task", status: "new", priority: "normal", completion_checks: [], evidence: [] };
state.tasks["T-103"] = { id: "T-103", title: "Plugin blocked task", status: "blocked", priority: "normal", blocker: { reason: "Waiting on owner decision" }, completion_checks: [], evidence: [] };
state.tasks["T-104"] = { id: "T-104", title: "Plugin done task " + "with a deliberately long title ".repeat(5), status: "done", priority: "low", completion_checks: [], evidence: [] };
saveState(root, state);
const running = await startControlPlaneServer(root);
let browser;
const allPageErrors = [];
const openPluginPage = async (options = {}) => {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 800 } });
  await context.addInitScript((boot) => {
    if (boot.locale) localStorage.setItem("atl-cp-lang", boot.locale);
    if (boot.theme) localStorage.setItem("atl-cp-theme", boot.theme);
  }, options);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.stack || error.message));
  allPageErrors.push(pageErrors);
  // Mark the presentation context exactly where plugins/panel-entry.mjs sets
  // it in production: on the root element, before any client script runs.
  // (An init script cannot do this — documentElement does not exist yet at
  // that point — so the root document is rewritten on the wire instead.)
  const documentUrl = new URL(running.url).pathname === "/" ? running.url : `${running.url}/`;
  await context.route(documentUrl, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace("<html", '<html data-atl-context="plugin"');
    await route.fulfill({ response, body });
  });
  await page.goto(running.url);
  return { context, page };
};
try {
  browser = await chromium.launch({ headless: true });

  // Fresh plugin session lands on Tasks with the four destinations.
  {
    const { context, page } = await openPluginPage({ viewport: { width: 768, height: 900 } });
    await page.locator('#mobile [data-page="tasks"]').waitFor();
    for (const destination of ["tasks", "attention", "studio", "more"]) await page.locator(`#mobile [data-page="${destination}"]`).waitFor();
    const navIcon = await page.locator('#mobile [data-page="tasks"] svg').evaluate(el => { const s = getComputedStyle(el); return { width: s.width, height: s.height, fill: s.fill, stroke: s.stroke }; });
    assert.deepEqual([navIcon.width, navIcon.height, navIcon.fill], ["17px", "17px", "none"], "plugin navigation uses compact line icons");
    assert.notEqual(navIcon.stroke, "none", "plugin navigation icons inherit a visible stroke");
    assert.equal(await page.locator(".sidebar").evaluate(el => getComputedStyle(el).display), "none", "plugin hides the browser sidebar");
    // Reduced filter set; oversized KPI cards are gone.
    for (const status of ["All", "Running", "Blocked", "Done"]) await page.locator(`.tasks-seg-btn[data-action="filter:${status}"]`).waitFor();
    assert.equal(await page.locator('.tasks-seg-btn[data-action="filter:Queued"]').count(), 0, "plugin filters are reduced");
    assert.equal(await page.locator(".tasks-kpi-grid").count(), 0, "plugin omits KPI cards");
    // Active runs lead the board.
    const rows = await page.locator(".task-row [data-task], .tableitem[data-task]").evaluateAll(nodes => nodes.map(node => node.dataset.task));
    assert.equal(rows[0], "T-101", "running task sorts first");
    // Blocked shortcut from the Attention badge path.
    await page.locator('#mobile [data-page="attention"]').click();
    await page.getByText("Blocked tasks", { exact: false }).waitFor();
    await page.locator('[data-task="T-103"]').waitFor();
    assert.equal(await page.getByText("Waiting on owner decision", { exact: false }).count() >= 1, true, "blocker reason is explained");
    // More links keep every specialist screen reachable; the CLI dock is hidden.
    await page.locator('#mobile [data-page="more"]').click();
    for (const label of ["Plan Studio", "Queues", "Knowledge", "Settings"]) await page.getByRole("button", { name: new RegExp(label, "i") }).first().waitFor();
    await page.getByRole("button", { name: /CLI console/i }).click();
    await page.locator("#cliInput").waitFor();
    assert.equal(await page.locator(".cliDock").evaluate(el => getComputedStyle(el).display), "none", "plugin hides the persistent CLI dock");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    // Keyboard: plugin destinations answer to number keys.
    await page.keyboard.press("1");
    await page.locator('[data-task="T-101"]').waitFor();
    // Overflow menu carries language, theme and command search.
    await page.locator('[data-action="plugin-overflow"]').click();
    await page.getByRole("menuitem", { name: /command search/i }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('.plugin-overflow-menu').count(), 0, "Escape closes the overflow menu");
    assert.equal(await page.locator('[data-action="plugin-overflow"]').evaluate(el => el === document.activeElement), true, "Escape restores focus to the overflow toggle");
    await page.locator('[data-action="plugin-overflow"]').click();
    const wasLight = await page.evaluate(() => document.documentElement.classList.contains("light"));
    await page.getByRole("menuitem", { name: /toggle theme/i }).click();
    await page.waitForFunction((before) => document.documentElement.classList.contains("light") !== before, wasLight);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), wasLight ? "dark" : "light", "native controls follow the selected theme");
    // Task creation from the compact header.
    await page.locator("#newBtn").click();
    await page.locator("#fTitle").fill("Plugin created task");
    await page.getByRole("button", { name: "Create task", exact: true }).click();
    await page.getByText("Plugin created task").waitFor();
    await context.close();
  }

  // Narrow widths open a dedicated detail screen; Back restores the list,
  // focus and disclosure state; live resizing moves to the split layout.
  {
    const { context, page } = await openPluginPage({ viewport: { width: 420, height: 760 } });
    await page.locator('[data-task="T-101"]').waitFor();
    // Bottom navigation is docked below 640px.
    const docked = await page.locator("#mobile").evaluate(el => getComputedStyle(el).position);
    assert.equal(docked, "fixed", "bottom navigation below 640px");
    for (const label of ["Tasks", "Attention", "Plan Studio", "More"]) assert.equal(await page.locator("#mobile .plugin-nav-label").getByText(label, { exact: true }).isVisible(), true, `${label} is visible in the navigation`);
    assert.equal(await page.locator('[data-action="tasks-select-visible"]:visible').count(), 1, "selection action is not duplicated");
    await page.locator('[data-task="T-101"] .task-main-copy').click();
    await page.locator(".task-detail-screen").waitFor();
    await page.getByRole("button", { name: "← Back" }).waitFor();
    // Progressive disclosure survives leaving and re-entering the screen.
    const disclosure = page.locator(".task-detail-screen details").first();
    await disclosure.locator("summary").click();
    assert.equal(await disclosure.evaluate(el => el.open), true);
    await page.getByRole("button", { name: "← Back" }).click();
    await page.locator('[data-task="T-101"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.closest("[data-task]")?.dataset.task), "T-101", "Back restores focus to the originating row");
    await page.locator('[data-task="T-101"] .task-main-copy').click();
    await page.locator(".task-detail-screen").waitFor();
    assert.equal(await page.locator(".task-detail-screen details").first().evaluate(el => el.open), true, "disclosure state survives Back + reopen");
    // A second, different task selection (Blocked row through the filter).
    // Done tasks ship off the board to the Shipped archive, so the Done
    // filter must show no rows here.
    await page.getByRole("button", { name: "← Back" }).click();
    await page.screenshot({ path: ".tmp-ui-review/pluginui-before-done-filter.png", fullPage: true }).catch(() => {});
    await page.locator('.tasks-seg-btn[data-action="filter:Done"]').click();
    assert.equal(await page.locator(".task-row").count(), 0, "Done rows ship off the board to the Shipped archive");
    await page.locator('.tasks-seg-btn[data-action="filter:Blocked"]').click();
    await page.screenshot({ path: ".tmp-ui-review/pluginui-after-done-filter.png", fullPage: true }).catch(() => {});
    await page.locator('[data-task="T-103"] .task-main-copy').click();
    await page.locator(".task-detail-screen").waitFor();
    // Resize into the split range and select from the list instead.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "← Back" }).click();
    await page.locator('.tasks-seg-btn[data-action="filter:All"]').click();
    await page.locator('[data-task="T-102"] .task-main-copy').click();
    await page.locator(".plugin-task-pane").waitFor();
    assert.equal(await page.locator('[data-task="T-102"]').evaluate(el => el.classList.contains("plugin-selected")), true, "selected row is marked in split view");
    await context.close();
  }

  // Temporary disconnection keeps visible data, labels it stale and retries.
  {
    const { context, page } = await openPluginPage();
    await page.locator('[data-task="T-102"]').waitFor();
    // The delta client polls /api/snapshot?cursor=N — the glob must cover the
    // query string or the abort never matches and the page stays live.
    await context.route("**/api/events*", route => route.abort());
    await context.route("**/api/snapshot*", route => route.abort());
    await page.locator("#plugin-topbar").getByText("● offline").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Retry" }).waitFor();
    await page.locator('[data-task="T-102"]').waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Retry" }).click();
    await context.unroute("**/api/events*");
    await context.unroute("**/api/snapshot*");
    await page.locator("#plugin-topbar").getByText("● live").waitFor({ timeout: 15000 });
    await context.close();
  }

  // Persian RTL and a host light theme render the same plugin composition.
  {
    const { context, page } = await openPluginPage({ locale: "fa-IR", theme: "light", viewport: { width: 420, height: 760 } });
    await page.locator('[data-task="T-101"]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
    assert.equal(await page.evaluate(() => document.body.classList.contains("atl-rtl")), true);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("light")), true);
    await page.locator('#mobile [data-page="attention"]').click();
    await page.locator("#content").getByText("وظایف مسدود").waitFor();
    await page.locator('[data-task="T-103"]').waitFor();
    await context.close();
  }

  // Smallest supported viewport does not overflow horizontally.
  {
    const { context, page } = await openPluginPage({ viewport: { width: 320, height: 600 } });
    await page.locator('[data-task="T-101"]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "320px plugin page must not overflow");
    await context.close();
  }

  assert.deepEqual(allPageErrors.flat(), [], "plugin pages must not raise JavaScript errors");
  console.log("PASS: plugin presentation — task-first navigation, detail screens, split view, stale retry, RTL, light theme, 320–1280px");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
