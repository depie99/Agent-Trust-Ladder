import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { emptyState, loadState, saveState, createTask } from "../runtime/lib/state.mjs";
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
  page.setDefaultTimeout(9000);
  await page.goto(running.url);

  // Projects page is a work map: one card per repository with its relations.
  await page.locator('[data-page="projects"]:visible').first().click();
  await page.locator(`[data-repo-card="${backend.id}"]`).waitFor();
  assert.equal(await page.locator("[data-repo-card]").count(), 3, "one card per registered repository (active or idle)");
  const storefrontCard = page.locator(`[data-repo-card="${frontend.id}"]`);
  assert.match(await storefrontCard.innerText(), /cart item lost after login/, "the shared request appears on the storefront card");
  assert.match(await storefrontCard.innerText(), /Shared w\/ Backend/, "the card badge names the sibling repositories");
  assert.ok(await page.locator(`[data-repo-card="${backend.id}"] [data-action="plan:${sharedId}:${backend.id}"]`).first().isVisible(), "each card offers planning in its own repository");
  assert.ok(await storefrontCard.locator(`[id="repoAssignTitle-${frontend.id}"]`).isVisible(), "each active card carries the direct assignment bar");
  assert.match(await page.locator(`[data-repo-card="${vendor.id}"]`).innerText(), /IDLE|Assign task/, "a repository with no work shows as an idle card");
  assert.equal(await page.locator("[data-repo-card]").count(), 3, "one card per registered repository");

  // Direct assignment from an active card: new task bound to the repository.
  await storefrontCard.locator(`[id="repoAssignTitle-${frontend.id}"]`).fill("Align the wishlist badge color with the theme");
  await storefrontCard.locator(`[id="repoAssignWorker-${frontend.id}"]`).selectOption("rowan");
  await page.locator(`[data-action="repo-assign:${frontend.id}"]`).click();
  await page.getByText(/now belongs to/).waitFor();
  const assigned = Object.values(loadState(root).tasks).find((task) => task.title === "Align the wishlist badge color with the theme");
  assert.ok(assigned, "assignment creates the task");
  assert.equal(assigned.repository_id, frontend.id, "the new task is bound to the repository");
  assert.equal(assigned.proposed_worker, "rowan", "the chosen worker is honored");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Requests without a repository can be linked from the Projects page, even
  // before the Issue sources page has ever been opened in this tab.
  assert.match(await page.locator("#content").innerText(), /Requests without a repository/);
  await page.locator(`[data-action="source-repos:${lonelyId}"]`).click();
  await page.locator(`[data-repo-check="${frontend.id}"]`).check();
  await page.locator(`[data-action="source-repos-save:${lonelyId}"]`).click();
  await storefrontCard.getByText("wishlist badge wrong").first().waitFor();
  assert.deepEqual(loadState(root).tasks[lonelyId].repository_ids, [frontend.id], "assignment links the request to the chosen repository");
  assert.doesNotMatch(await page.locator("#content").innerText(), /Requests without a repository/, "the unassigned strip disappears once every request is linked");

  // Plan here opens Plan Studio already targeting that repository.
  await page.locator(`[data-action="plan:${sharedId}:${backend.id}"]`).first().click();
  assert.match(await page.locator("[data-plan-source-context]").innerText(), /Planning in Backend/, "Plan here targets the card's repository");
  assert.match(await page.locator("#goal").inputValue(), /cart item lost after login/);

  // Opening the multi-repository request without a target asks which repository to plan.
  await page.evaluate((id) => { const button = document.createElement("button"); button.dataset.action = `plan:${id}`; button.id = "probePlan"; document.body.append(button); }, sharedId);
  await page.locator("#probePlan").click();
  assert.match(await page.locator("[data-plan-source-context]").innerText(), /affects 2 repositories/, "a request linked to two repositories never silently picks one");
  await page.locator(`[data-action="studio-pick-repo:${frontend.id}"]`).click();
  assert.match(await page.locator("[data-plan-source-context]").innerText(), /Planning in Storefront/);

  // Issue sources: chips per linked repository and one Plan button per repository.
  await page.locator('[data-page="sources"]:visible').first().click();
  const sharedRow = page.locator(`[data-import-request="${sharedId}"]`);
  await sharedRow.waitFor();
  assert.match(await sharedRow.innerText(), /Storefront[\s\S]*Backend/, "the row shows every linked repository");
  assert.equal(await sharedRow.locator(`[data-action^="plan:${sharedId}:"]`).count(), 2, "one Plan button per linked repository");

  // Link a second repository through the Repositories dialog.
  await page.locator(`[data-action="source-repos:${lonelyId}"]`).click();
  await page.locator(`[data-repo-check="${backend.id}"]`).check();
  await page.locator(`[data-action="source-repos-save:${lonelyId}"]`).click();
  await page.locator(`[data-import-request="${lonelyId}"] [data-action="plan:${lonelyId}:${backend.id}"]`).waitFor();
  assert.deepEqual(loadState(root).tasks[lonelyId].repository_ids, [frontend.id, backend.id], "the dialog saves the full ordered link list");

  // A repository that already has plan work for the request cannot be unlinked.
  const draft = await page.evaluate(async ({ taskId, repositoryId }) => {
    const response = await fetch("/api/plan/local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "Restore the cart after login", sourceTaskId: taskId, repositoryId }) });
    return { status: response.status, body: await response.json() };
  }, { taskId: sharedId, repositoryId: backend.id });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  await page.locator(`[data-action="source-repos:${sharedId}"]`).click();
  await page.locator(`[data-repo-check="${backend.id}"]`).uncheck();
  await page.locator(`[data-action="source-repos-save:${sharedId}"]`).click();
  await page.getByText("Could not save links").waitFor();
  assert.match(await page.locator("#dialog, .dialog, [role=dialog]").first().innerText(), /Cannot unlink Backend/, "the refusal names the pinned repository");
  assert.deepEqual(loadState(root).tasks[sharedId].repository_ids, [frontend.id, backend.id], "a refused unlink leaves the links untouched");
  await page.keyboard.press("Escape");

  // The draft shows up on the Backend card; Plan new work targets a repository directly.
  await page.locator('[data-page="projects"]:visible').first().click();
  const backendCard = page.locator(`[data-repo-card="${backend.id}"]`);
  await backendCard.getByText("draft in progress").first().waitFor();
  // Idle card: direct task through the popup.
  await page.locator(`[data-action="direct-task:${vendor.id}"]`).click();
  await page.locator("#directTaskTitle").fill("Sweep stale vendor sessions nightly");
  await page.locator(`[data-action="direct-task-save:${vendor.id}"]`).click();
  await page.getByText(/now belongs to/).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(Object.values(loadState(root).tasks).find((task) => task.title === "Sweep stale vendor sessions nightly")?.repository_id, vendor.id, "the idle-card popup binds the task to its repository");
  await page.locator(`[data-action="plan-repo:${frontend.id}"]`).click();
  assert.match(await page.locator("[data-plan-source-context]").innerText(), /Planning in Storefront/, "Plan new work opens Plan Studio visibly bound to that repository");
  assert.match(await page.locator("[data-studio-notice]").innerText(), /Planning new work in Storefront/);

  console.log("PASS: Projects work map — per-repository relations, assignment, multi-repository linking, per-repository planning, pinned links");
} finally {
  await browser?.close();
  if (running) await new Promise((resolve) => running.server.close(resolve));
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  for (const dir of [root, frontendRoot, backendRoot, vendorRoot, fakeHome]) fs.rmSync(dir, { recursive: true, force: true });
}
