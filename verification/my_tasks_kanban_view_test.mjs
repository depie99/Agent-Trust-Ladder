import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Owner feedback 2026-11-15: kanban looked identical to a closed list.
// Kanban lanes must render always-open with the collapse affordance gone,
// while list view keeps its collapsible groups (Done starts collapsed).
const ME = { id: "ui-identity", displayName: "Owner Account" };
const base = "https://devops.example.invalid:32678/Collection";
const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, ATL_HOME: process.env.ATL_HOME, APPDATA: process.env.APPDATA, AZDO_PAT: process.env.AZDO_PAT };
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-kanban-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.ATL_HOME = path.join(fakeHome, ".atl");
process.env.APPDATA = fakeHome;
process.env.AZDO_PAT = "synthetic-kanban-token";

const item = (id, over = {}) => ({ id, fields: {
  "System.Id": id, "System.Rev": 1, "System.Title": `Item ${id}`, "System.State": "New", "System.WorkItemType": "Task",
  "System.AssignedTo": { id: ME.id, displayName: ME.displayName }, "Microsoft.VSTS.Common.Priority": 2,
  "System.IterationPath": "Alpha\\Sprint 74", "System.AreaPath": "Alpha\\Portal",
  "System.Description": "<p>plain</p>", "Microsoft.VSTS.Common.AcceptanceCriteria": "<ul><li>works</li></ul>",
  "System.Tags": "", "System.ChangedDate": "2026-11-15T09:00:00Z",
  ...over,
} });
const workItems = {
  Alpha: [item(301), item(302, { "System.State": "Doing" }), item(303, { "System.State": "Done" })],
  Beta: [],
};
const transport = async (url) => {
  if (url.endsWith("/_apis/ConnectionData")) return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
  if (url.includes("/_apis/projects")) return { data: { value: [{ id: "1", name: "Alpha", state: "wellFormed" }, { id: "2", name: "Beta", state: "wellFormed" }] }, headers: {}, status: 200 };
  const project = decodeURIComponent(url.split("/Collection/")[1]?.split("/_apis")[0] || "");
  if (url.includes("/_apis/wit/wiql")) return { data: { workItems: (workItems[project] || []).map((entry) => ({ id: entry.id })) }, headers: {}, status: 200 };
  if (url.includes("/_apis/wit/workitemsbatch")) return { data: { value: workItems[project] || [] }, headers: {}, status: 200 };
  if (url.includes("/states")) return { data: { value: [{ name: "New", category: "Proposed" }, { name: "Doing", category: "InProgress" }, { name: "Done", category: "Complete" }] }, headers: {}, status: 200 };
  throw new Error(`unexpected call ${url}`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-kanban-root-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { enabled: true, org_url: base, project: "Alpha", token_env: "AZDO_PAT", tls_allow_untrusted: true } } }));
// Keep the snapshot endpoint healthy; without a valid project state the client
// goes offline and disables every action button (same setup as the UI journey).
saveState(root, emptyState());
let running, browser;
try {
  running = await startControlPlaneServer(root, { myTasksFetch: transport });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(running.url, { waitUntil: "domcontentloaded" });
  await page.goto(new URL("?page=mytasks", page.url()).href);
  await page.waitForSelector(".mtr-status-group");
  await page.click('[data-action="mt-settings"]');
  await page.check('[data-mt-project="Beta"]');
  await page.click('[data-action="mt-save"]');
  await page.waitForFunction(() => document.querySelectorAll(".mt-row").length >= 3);

  // List view keeps collapsible groups; Done starts collapsed.
  await page.waitForSelector('[data-mtr-action="view:list"]');
  await page.click('[data-mtr-action="view:list"]');
  assert.equal(await page.locator('[data-mtr-group="complete"]').getAttribute("open"), null, "list view: Done starts collapsed");
  const listAfter = await page.locator('[data-mtr-group="proposed"] > summary').count();

  // Kanban: all lanes render open and the +/- affordance disappears.
  await page.click('[data-mtr-action="view:kanban"]');
  await page.waitForSelector(".mtr-board.is-kanban");
  for (const group of ["proposed", "inprogress", "complete"]) {
    const open = await page.locator(`[data-mtr-group="${group}"]`).getAttribute("open");
    assert.equal(open, "", `kanban lane ${group} is always open`);
  }
  const aff = await page.locator(".mtr-board.is-kanban .mtr-status-group > summary").evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n, "::after").content));
  assert.ok(aff.every((c) => c === "none" || c === "normal"), "kanban summaries carry no +/− affordance");
  const cards = await page.locator(".mtr-board.is-kanban .mt-row").count();
  assert.ok(cards >= 3, `kanban lanes show their cards (${cards})`);

  // Reload keeps kanban lanes open (view persisted, never stored collapsed).
  await page.reload();
  await page.waitForSelector(".mtr-board.is-kanban");
  for (const group of ["proposed", "inprogress", "complete"]) {
    assert.notEqual(await page.locator(`[data-mtr-group="${group}"]`).getAttribute("open"), null, `kanban lane ${group} stays open after reload`);
  }

  // Back to list: collapsible behavior returns.
  await page.click('[data-mtr-action="view:list"]');
  await page.waitForSelector(".mtr-board.is-list");
  assert.equal(await page.locator('[data-mtr-group="complete"]').getAttribute("open"), null, "list view: Done collapses again");
  assert.equal(listAfter > 0, true, "list groups still have summaries");
  assert.deepEqual(errors, []);
  console.log("PASS: kanban lanes are always-open columns without the collapse affordance; list view keeps collapsible groups");
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (browser) await browser.close();
  if (running) { running.server.closeAllConnections?.(); await new Promise((resolve) => running.server.close(resolve)); }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}
