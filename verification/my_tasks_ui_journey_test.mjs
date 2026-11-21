import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { readMyTasksStore } from "../runtime/lib/my-tasks.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Spec 021 UI journey, end to end in the browser: setup (reuse saved Azure
// connection), first check, collapsible project/area groups, search/filters,
// sanitized detail panel, keyboard access, RTL Persian locale.

const ME = { id: "ui-identity", displayName: "Owner Account" };
const base = "https://devops.example.invalid:32678/Collection";

const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, ATL_HOME: process.env.ATL_HOME, APPDATA: process.env.APPDATA, AZDO_PAT: process.env.AZDO_PAT };
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-ui-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.ATL_HOME = path.join(fakeHome, ".atl");
process.env.APPDATA = fakeHome;
process.env.AZDO_PAT = "synthetic-ui-token";

const item = (id, over = {}) => ({ id, fields: {
  "System.Id": id, "System.Rev": 1, "System.Title": `Item ${id}`, "System.State": "New", "System.WorkItemType": "Task",
  "System.AssignedTo": { id: ME.id, displayName: ME.displayName }, "Microsoft.VSTS.Common.Priority": 2,
  "System.IterationPath": "Alpha\\Sprint 74", "System.AreaPath": "Alpha\\Portal",
  "System.Description": "<p>plain description</p>", "Microsoft.VSTS.Common.AcceptanceCriteria": "<ul><li>works</li></ul>",
  "System.Tags": "ui; journey", "System.ChangedDate": "2026-11-11T09:00:00Z",
  ...over,
} });
const workItems = {
  Alpha: [
    item(101),
    item(102, { "System.Title": "اصلاح نمایش فاکتور", "System.WorkItemType": "Bug", "System.State": "Doing", "Microsoft.VSTS.Common.Priority": 1, "System.AreaPath": "Alpha\\Billing" }),
  ],
  Beta: [item(201, { "System.State": "Done", "System.Description": "<p>safe paragraph</p><script>alert('xss')</script>", "System.AreaPath": "Beta\\Core", "System.IterationPath": "Beta\\Sprint 8", "Microsoft.VSTS.Common.Priority": 4 })],
};
const transport = async (url, options = {}) => {
  if (url.endsWith("/_apis/ConnectionData")) return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
  if (url.includes("/_apis/projects")) return { data: { value: [{ id: "1", name: "Alpha", state: "wellFormed" }, { id: "2", name: "Beta", state: "wellFormed" }] }, headers: {}, status: 200 };
  const project = decodeURIComponent(url.split("/Collection/")[1]?.split("/_apis")[0] || "");
  if (url.includes("/_apis/wit/wiql")) return { data: { workItems: (workItems[project] || []).map((entry) => ({ id: entry.id })) }, headers: {}, status: 200 };
  if (url.includes("/_apis/wit/workitemsbatch")) return { data: { value: workItems[project] || [] }, headers: {}, status: 200 };
  if (url.includes("/states")) return { data: { value: [{ name: "New", category: "Proposed" }, { name: "Doing", category: "InProgress" }, { name: "Done", category: "Complete" }] }, headers: {}, status: 200 };
  throw new Error(`unexpected call ${url}`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-ui-root-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { enabled: true, org_url: base, project: "Alpha", token_env: "AZDO_PAT", tls_allow_untrusted: true } } }));

const reviewCalls = [];
const reviewInvoke = async packet => {
  reviewCalls.push({ id: packet.item.id, locale: packet.locale });
  const persian = packet.locale === 'fa-IR';
  return { provider: 'fixture', model: 'fixture', result: {
    brief: persian ? 'خلاصهٔ درخواست تسک' : `Brief for ${packet.item.id}`,
    summary: persian ? 'این درخواست تغییر رفتار محصول را توضیح می‌دهد.' : `Task ${packet.item.id} requests a product behavior change.`,
    expected: persian ? 'رفتار مورد انتظار مطابق معیار پذیرش باشد.' : 'Meet the stated acceptance criteria.', ambiguity: '',
    findings: [{ text: persian ? 'کد هنوز متصل نشده است.' : 'Connect a repository for code evidence.', evidence_ids: [] }], checks: ['Confirm acceptance criteria.'],
    diagram: { nodes: [{ label: 'Current state unknown', kind: 'unknown', evidence_ids: [] }, { label: 'Requested change', kind: 'proposed', evidence_ids: [] }, { label: 'Expected behavior', kind: 'proposed', evidence_ids: [] }], edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }] },
  } };
};
let running, browser;
try {
  running = await startControlPlaneServer(root, { myTasksFetch: transport, myTasksReviewInvoke: reviewInvoke });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(running.url, { waitUntil: "domcontentloaded" });

  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.click('[data-page="mytasks"]');
  await page.waitForSelector('.mtr-status-group');
  assert.equal(await page.locator('[data-mtr-group]').count(), 3, 'three state groups');
  assert.equal(await page.locator('[data-mtr-group="complete"]').getAttribute('open'), null, 'Done starts collapsed');
  assert.equal(await page.locator('[data-action="mt-save-toggle"]').count(), 0, 'no off control');
  await page.click('[data-action="mt-settings"]');
  await page.waitForSelector('[data-mt-project="Alpha"]');
  assert.ok(await page.locator('[data-mt-project="Alpha"]').isChecked());
  assert.ok(await page.locator('[name="mtStartupMode"][value="runtime"]').isChecked());
  await page.check('[data-mt-project="Beta"]');
  await page.click('[data-action="mt-save"]');
  await page.waitForFunction(() => document.querySelectorAll('.mt-row').length === 3);
  await page.waitForFunction(() => !document.querySelector('.dialog'));
  await page.waitForFunction(() => [...document.querySelectorAll('.mtr-brief')].some(n => n.textContent.includes('Brief')));
  assert.equal(Object.keys(readMyTasksStore(root).records).length, 3);
  assert.equal(await page.locator('.mt-row.is-done .mt-state.green').count(), 1);
  assert.equal(await page.locator('.mtr-sync[open]').count(), 0, 'technical status is collapsed');
  await page.fill('#mtrSearch', 'فاکتور');
  assert.equal(await page.locator('.mt-row').count(), 1, 'Persian title search');
  await page.fill('#mtrSearch', '');
  await page.selectOption('[data-mtr-filter="type"]', 'Bug');
  assert.equal(await page.locator('.mt-row').count(), 1, 'type filter');
  await page.reload(); await page.waitForSelector('.mt-row');
  assert.equal(await page.locator('[data-mtr-filter="type"]').inputValue(), 'Bug', 'filters survive reload');
  await page.selectOption('[data-mtr-filter="type"]', '');
  await page.click('[data-mtr-action="view:kanban"]');
  assert.equal(await page.locator('.mtr-board.is-kanban').count(), 1);
  await page.reload(); await page.waitForSelector('.mtr-board.is-kanban');
  await page.click('[data-mtr-action="view:list"]');
  await page.locator('[data-mtr-group="complete"] > summary').click();
  await page.locator('.mt-row:has-text("Item 201")').click();
  await page.waitForSelector('.mtr-summary');
  assert.equal(await page.locator('[role="tab"]').count(), 4, 'overview, review, original, preparation');
  assert.equal(await page.locator('.mt-desc').count(), 0, 'original description is hidden on overview');
  await page.waitForSelector('.mtr-diagram-render svg', { timeout: 20000 });
  assert.equal(await page.locator('.mtr-diagram-render script').count(), 0);
  const callsBeforeOpen = reviewCalls.length;
  await page.click('[data-mtr-action="tab:review"]');
  assert.match(await page.locator('.mtr-tabpanel').innerText(), /Suggested checks/);
  await page.click('[data-mtr-action="tab:original"]');
  assert.equal(await page.locator('.mt-desc p:has-text("safe paragraph")').count(), 1);
  assert.ok(!(await page.locator('.dialog').innerText()).includes('alert('), 'HTML sanitized');
  assert.match(await page.locator('.dialog a:has-text("Open in Azure")').getAttribute('href'), /edit\/201$/);
  assert.match(await page.locator('.mtr-tabpanel').innerText(), /works/);
  await page.keyboard.press('Escape');
  await page.locator('.mt-row:has-text("Item 101") .mtr-card-open').focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('.mtr-summary');
  assert.match(await page.locator('.mtr-summary').innerText(), /101/);
  assert.equal(reviewCalls.length, callsBeforeOpen, 'opening cached tasks does not call agent');
  await page.locator('[role="tab"]').first().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#mtr-tab-review').getAttribute('aria-selected'), 'true', 'keyboard tab navigation');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('.mt-row:has-text("Item 101") .mtr-card-open').evaluate(el => el === document.activeElement), 'focus returns to task');
  await page.click('#localeBtn'); await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  await page.waitForSelector('.mtr-root');
  assert.match(await page.locator('.mtr-pagehead h1').innerText(), /تسک‌های من/);
  await page.waitForFunction(() => [...document.querySelectorAll('.mtr-brief')].some(n => n.textContent.includes('خلاصه')));
  await page.click('#localeBtn'); await page.waitForFunction(() => document.documentElement.dir === 'ltr');
  await page.waitForSelector('.mtr-root');
  await page.click('#themeBtn');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page does not overflow');
  await page.locator('.mt-row:has-text("Item 101")').click(); await page.waitForSelector('.mtr-summary');
  assert.ok(await page.locator('.dialog').evaluate(el => el.getBoundingClientRect().width <= innerWidth), 'mobile modal fits');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, [], 'no browser runtime errors');

  // 10. Empty state on a fresh store (no records yet) shows guidance, not a blank page.
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-ui-empty-"));
  fs.mkdirSync(path.join(emptyRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(emptyRoot, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { org_url: base, project: "Alpha", token_env: "AZDO_PAT" } } }));
  const emptyServer = await startControlPlaneServer(emptyRoot, {
    myTasksFetch: async (url) => {
      if (url.endsWith("/_apis/ConnectionData")) return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
      if (url.includes("/_apis/projects")) return { data: { value: [{ id: "1", name: "Alpha", state: "wellFormed" }] }, headers: {}, status: 200 };
      if (url.includes("wiql")) return { data: { workItems: [] }, headers: {}, status: 200 };
      if (url.includes("workitemsbatch")) return { data: { value: [] }, headers: {}, status: 200 };
      if (url.includes("states")) return { data: { value: [{ name: "New", category: "Proposed" }] }, headers: {}, status: 200 };
      throw new Error(`unexpected call ${url}`);
    },
  });
  const page2 = await browser.newPage({ viewport: { width: 820, height: 900 } }); // narrow: mobile-ish
  await page2.goto(emptyServer.url, { waitUntil: "domcontentloaded" });
  await page2.click('[data-page="mytasks"]');
  await page2.waitForSelector('.mtr-empty', { timeout: 20000 });
  await page2.click('[data-action="mt-settings"]');
  await page2.waitForSelector('.dialog [data-mt-setup]', { timeout: 15000 });
  await page2.waitForSelector('[data-mt-project="Alpha"]', { timeout: 15000 });
  await page2.click('[data-action="mt-save"]');
  await page2.waitForSelector('.mtr-empty, .mtr-board', { timeout: 20000 });
  const emptyText = await page2.locator("#content").innerText();
  assert.ok(emptyText.includes("No assigned work items yet") || emptyText.includes("مورد بازی وجود ندارد"), "empty state guidance shown");
  assert.ok(emptyText.length > 50, "empty page still carries KPIs and setup");
  await emptyServer.server.close(); emptyServer.server.closeAllConnections?.();

  // 11. Saving from a dialog whose project list failed to load must keep the
  // saved projects — the empty checkbox list may not wipe the watched list.
  {
    const wipeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-ui-wipe-"));
    fs.mkdirSync(path.join(wipeRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(wipeRoot, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { org_url: base, project: "Alpha", token_env: "AZDO_PAT" } } }));
    let authRejected = false;
    const wipeServer = await startControlPlaneServer(wipeRoot, {
      myTasksFetch: async (url) => {
        if (url.endsWith("/_apis/ConnectionData")) {
          if (authRejected) { const error = new Error("HTTP 401 Unauthorized"); error.status = 401; throw error; }
          return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
        }
        if (url.includes("/_apis/projects")) { const error = new Error("HTTP 500 project list outage"); error.status = 500; throw error; }
        throw new Error(`unexpected call ${url}`);
      },
    });
    const wipeGet = async (path1) => (await fetch(new URL(path1, wipeServer.url))).json();
    try {
      await (await fetch(new URL("/api/my-tasks/settings", wipeServer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false, interval_minutes: 30, projects: ["Alpha", "Beta"] }) })).json();
      const page3 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page3.goto(wipeServer.url, { waitUntil: "domcontentloaded" });
      await page3.click('[data-page="mytasks"]');
      await page3.click('[data-action="mt-settings"]');
      await page3.waitForSelector('.dialog [data-mt-setup]', { timeout: 15000 });
      await page3.waitForSelector('.dialog:has-text("Could not list projects")', { timeout: 15000 });
      assert.equal(await page3.locator('.dialog [data-mt-project]').count(), 0, "no checkboxes when the project list failed to load");
      authRejected = true;
      await page3.click('[data-action="mt-projects"]');
      await page3.waitForSelector('.dialog:has-text("Reconnect with a PAT")', { timeout: 15000 });
      assert.equal(await page3.locator('.dialog [data-action^="mt-reconnect:"]').count(), 1, "auth failure offers one direct reconnect action");
      await page3.click('.dialog [data-action^="mt-reconnect:"]');
      await page3.waitForSelector('.dialog #sourceConnectionPat', { timeout: 15000 });
      assert.match(await page3.locator('.dialog').innerText(), /Personal access token/, "reconnect opens the saved Azure credential editor");
      await page3.click('.dialog [data-action="close"]');
      await page3.click('[data-action="mt-save"]');
      await page3.waitForFunction(() => !document.querySelector(".dialog"), { timeout: 15000 });
      const after = await wipeGet("/api/my-tasks/settings");
      assert.deepEqual(after.settings.projects, ["Alpha", "Beta"], "a save with no rendered checkbox list keeps the saved projects");
      assert.equal(after.settings.interval_minutes, 30, "interval untouched by the list-outage save");
      assert.equal(after.settings.enabled, true, "the save still applies the flag it did change");
      await page3.close();
    } finally { wipeServer.server.close(); wipeServer.server.closeAllConnections?.(); }
  }

  console.log("PASS: My Tasks UI journey — setup, three status groups, persistent list/kanban and filters, pre-generated tabbed reviews, sanitized originals, real Mermaid, keyboard/focus, language regeneration, mobile and project-list outage recovery");
} catch (error) {
  console.error("FAIL:", error.message);
  if (error.stack) console.error(error.stack.split("\n").filter((line) => line.includes("my_tasks_ui")).join("\n"));
  process.exitCode = 1;
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (browser) await browser.close();
  if (running) running.server.close(); running?.server.closeAllConnections?.();
}
