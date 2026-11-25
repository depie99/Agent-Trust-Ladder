import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { emptyState, loadState, saveState, createTask } from "../runtime/lib/state.mjs";
import { planDraftIndex } from "../runtime/lib/plan-studio.mjs";
import { registerProject } from "../runtime/lib/supervisor.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Projects work map + multi-repository requests, end to end in the browser:
// a request reported once (by a product team or a user) can affect the
// storefront and the backend; each linked repository gets its own plan.

// Pin the machine-level supervisor registry to a throwaway home.
const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, ATL_HOME: process.env.ATL_HOME };
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-workmap-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.ATL_HOME = path.join(fakeHome, ".atl");

const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
const repo = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `atl-workmap-${name.toLowerCase()}-`));
  git(["init", "-q"], dir);
  git(["config", "user.email", "atl-test@example.invalid"], dir);
  git(["config", "user.name", "ATL test"], dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }));
  git(["add", "-A"], dir);
  git(["commit", "-qm", "baseline"], dir);
  return dir;
};
const frontendRoot = repo("Storefront");
const backendRoot = repo("Backend");
const vendorRoot = repo("VendorPanel");
const frontend = registerProject(frontendRoot, { name: "Storefront" });
const backend = registerProject(backendRoot, { name: "Backend" });
const vendor = registerProject(vendorRoot, { name: "VendorPanel" });

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-workmap-project-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
const state = emptyState();
const imported = (title, remoteId, links = []) => {
  const task = createTask(state, { title, source: { type: "azure", remote_id: remoteId, revision: "1", url: `https://devops.example.invalid/_workitems/edit/${remoteId}` }, plan_review_required: true, resources: [] });
  task.intake_only = true;
  task.imported_at = new Date().toISOString();
  task.intake_snapshot = { title, objective: "Reported by the product team", completion_checks: [], source: task.source, resources: [] };
  if (links.length) { task.repository_ids = links.map((entry) => entry.id); task.repository_id = links[0].id; task.repository_name = links[0].name; }
  return task.id;
};
const lonelyId = imported("Task 6380: wishlist badge wrong", "6380");
const sharedId = imported("Task 6376: cart item lost after login", "6376", [frontend, backend]);
saveState(root, state);

let running, browser;
try {
  running = await startControlPlaneServer(root);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", error => console.error(error.message));
  const planTraffic = [];
  page.on("request", request => { if (request.url().includes("/api/plan/")) planTraffic.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  page.on("response", response => { if (response.url().includes("/api/plan/")) planTraffic.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.setDefaultTimeout(9000);
  await page.goto(running.url);

  const nav = id => page.locator(`[data-page="${id}"]:visible`).first();
  const openRepo = id => page.locator(`[data-action="repositories-open:${id}"]`).click();
  const inspector = page.getByRole("complementary", { name: "Repository details" });
  await nav("projects").waitFor();
  await page.keyboard.press("7");
  await page.getByRole("heading", { name: "Repositories", exact: true }).waitFor();
  await page.locator(`[data-repo-card="${backend.id}"]`).waitFor();
  assert.equal(await page.locator("[data-repo-card]").count(), 3);
  await openRepo(backend.id);
  assert.match(await inspector.innerText(), /cart item lost after login/);
  await openRepo(frontend.id);
  assert.match(await inspector.innerText(), /Shared w\/ Backend/);
  await inspector.locator(`[id="repoAssignTitle-${frontend.id}"]`).fill("Align the wishlist badge color with the theme");
  await inspector.locator(`[data-action="repo-assign:${frontend.id}"]`).click();
  await page.getByText(/now belongs to/).waitFor();
  const assigned = Object.values(loadState(root).tasks).find(task => task.title === "Align the wishlist badge color with the theme");
  assert.equal(assigned.repository_id, frontend.id);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await inspector.getByRole("button", { name: "Close repository details" }).click();
  assert.equal(await inspector.count(), 0);
  await openRepo(vendor.id);
  assert.match(await inspector.innerText(), /No linked requests/);

  await nav("inbox").click();
  const requestPanel = page.getByRole("complementary", { name: "Request details" });
  await page.locator('[data-action="inbox-stage:Needs repos"]').click();
  await page.getByRole("button", { name: "Choose repos", exact: true }).click();
  await requestPanel.locator("#inboxRepoSearch").fill("Storefront");
  assert.equal(await requestPanel.locator("[data-inbox-repo-option]:visible").count(), 1);
  await requestPanel.locator(`[data-inbox-repo="${frontend.id}"]`).check();
  await requestPanel.getByRole("button", { name: "Save links" }).click();
  await page.getByText("Repository links saved.").waitFor();
  assert.deepEqual(loadState(root).tasks[lonelyId].repository_ids, [frontend.id]);

  await page.locator('[data-action="inbox-stage:All"]').click();
  await page.locator(`[data-inbox-check="${lonelyId}"]`).check();
  await page.locator(`[data-inbox-check="${sharedId}"]`).check();
  await page.locator('[data-action="inbox-send-checked"]').click();
  await page.getByText("3 repository drafts are ready in Saved plans.").waitFor().catch(async error => {
    throw new Error(`Bulk planning did not reach Plan Studio. ${await page.locator("#content [role=status], #content [data-studio-notice]").allTextContents()} · saved ${planDraftIndex(root).length} · ${planTraffic.join(", ")}`, { cause: error });
  });
  const index = planDraftIndex(root);
  assert.deepEqual(index.filter(draft => draft.source_task_id === sharedId).map(draft => draft.repository.id).sort(), [backend.id, frontend.id].sort());
  assert.equal(index.filter(draft => draft.source_task_id === lonelyId).length, 1);
  assert.equal(index.filter(draft => draft.approved).length, 0);

  await nav("inbox").click();
  await page.locator(`.intake-title[data-action="inbox-open:${sharedId}"]`).click();
  assert.equal(await requestPanel.locator(`[data-inbox-repo="${backend.id}"]`).isDisabled(), true);
  const replay = await page.evaluate(async ({ sourceTaskId, repositoryId }) => {
    const response = await fetch("/api/plan/local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "Restore the cart after login", sourceTaskId, repositoryId, fromInbox: true }) });
    return response.json();
  }, { sourceTaskId: sharedId, repositoryId: backend.id });
  assert.equal(replay.reused, true);
  assert.equal(planDraftIndex(root).length, 3);

  await page.getByRole("button", { name: /^Sources/ }).click();
  await page.getByRole("heading", { name: "Connected sources" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Watch settings" }).isVisible(), true);
  await page.getByRole("button", { name: "Back to Inbox" }).click();
  await page.getByRole("button", { name: "+ Import issues", exact: true }).click();
  await page.getByRole("heading", { name: "Import issues", exact: true }).waitFor();
  assert.equal(await page.locator("#sourceConnectionSelect").isVisible(), true);
  await page.getByRole("button", { name: "Back to Inbox" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`.intake-title[data-action="inbox-open:${lonelyId}"]`).click();
  assert.equal(await requestPanel.isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await nav("projects").click();
  await openRepo(backend.id);
  assert.equal(await inspector.isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log("PASS: Inbox and Repositories desktop/mobile, filters, links, assignment, idempotent bulk planning, source and import tools");

} finally {
  await browser?.close();
  if (running) await new Promise((resolve) => running.server.close(resolve));
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  for (const dir of [root, frontendRoot, backendRoot, vendorRoot, fakeHome]) fs.rmSync(dir, { recursive: true, force: true });
}
