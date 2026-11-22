import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { emptyMyTasksStore, workItemKey } from "../runtime/lib/my-tasks.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Spec 022 UI journey, in the browser: preparation chips and filter on the
// task list, the Preparation tab (brief edit → ready, owner question → needs
// your answer → answered, bounded discovery run, handoff into Plan Studio).

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-prep-ui-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.ATL_HOME = path.join(fakeHome, ".atl");
process.env.AZDO_PAT = "synthetic-ui-token";
fs.mkdirSync(process.env.ATL_HOME, { recursive: true });
fs.writeFileSync(path.join(process.env.ATL_HOME, "providers.json"), JSON.stringify({
  providers: { testprov: { id: "testprov", label: "Test Provider", worker: "openai-http", protocol: "openai", base_url: "https://example.test/api", api_key: "sk-secret-value", model: "m-1", models: ["m-1"] } },
}, null, 2));

const CONNECTION = "https://devops.example.invalid/Collection";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-prep-ui-root-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.mkdirSync(path.join(root, ".trust", "manager", "my-tasks"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, providers: { use: "testprov" }, intake: { azure: { enabled: true, org_url: CONNECTION, project: "Alpha", token_env: "AZDO_PAT" } } }));
saveState(root, emptyState());
const item = (id, over = {}) => ({
  key: workItemKey(CONNECTION.toLowerCase(), "Alpha", id), connection: CONNECTION.toLowerCase(), project: "Alpha", id,
  rev: 1, title: over.title || `Item ${id}`, type: "Task", state: over.state || "New", state_category: over.state_category || "proposed", priority: 2,
  source_priority: { rank: 2, label: "P2" }, due_at: null, dependencies: [], area_path: "Alpha\\Portal",
  iteration_path: "Alpha\\Sprint 74", url: `${CONNECTION}/Alpha/_workitems/edit/${id}`,
  description_html: "", description_text: over.descriptionText || "", acceptance_criteria: "",
  assignee_id: "ui", assignee_name: "Owner", tags: [], changed_at: "2026-11-12T10:00:00Z",
});
const store = emptyMyTasksStore();
for (const entry of [item(101, { descriptionText: "plain description", title: "Cart lost after login" }), item(102), item(103, { state: "Done", state_category: "complete" })]) {
  store.records[entry.key] = { ...entry, first_seen_at: entry.changed_at, last_seen_at: entry.changed_at };
}
fs.writeFileSync(path.join(root, ".trust", "manager", "my-tasks", "store.json"), JSON.stringify(store, null, 2));
fs.writeFileSync(path.join(root, ".trust", "manager", "my-tasks", "settings.json"), JSON.stringify({ enabled: true, schedule_on: false, interval_minutes: 60, projects: ["Alpha"] }));
fs.writeFileSync(path.join(root, ".trust", "manager", "my-tasks", "reviews.json"), JSON.stringify({ version: 1, locale: "en-US", entries: {}, jobs: [], paused: null }));

const discoveryOutput = {
  code_locations: [{ repository_id: "", path: "src/login.ts", line: 10, note: "merge point" }],
  findings: ["login flow drops the guest cart object"],
  questions: [{ kind: "owner_decision", question: "Merge or discard the guest cart?", why: "behavior contract", options: ["Merge", "Discard"] }],
};
let discoveryCalls = 0;
const running = await startControlPlaneServer(root, {
  planningInvoke: async ({ request }) => {
    if (request.task_preparation_discovery) { discoveryCalls += 1; return { code: 0, text: JSON.stringify(discoveryOutput), provider: "testprov", model: "m-1" }; }
    return { code: 0, text: "{}", provider: "testprov", model: "m-1" };
  },
});

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(running.url, { waitUntil: "domcontentloaded" });
  await page.click('[data-page="mytasks"]');
  await page.waitForSelector(".mt-row");

  // 1. Preparation chips on cards; filter narrows by state; Done is historical.
  await page.waitForFunction(() => [...document.querySelectorAll(".mt-row .pill")].some((node) => node.textContent.includes("Needs investigation")));
  await page.locator('[data-mtr-group="complete"] > summary').click();
  await page.waitForSelector('.mt-row:has-text("Item 103")');
  assert.equal(await page.locator('.mt-row:has-text("Item 103") .pill:has-text("Historical")').count(), 1, "Done task shows the historical chip");
  // Open the advanced filters directly: a synthetic summary click races the
  // periodic re-render, while setAttribute both opens the row and lets the
  // toggle listener persist the preference.
  await page.evaluate(() => document.querySelector(".mtr-more-filters")?.setAttribute("open", ""));
  await page.waitForSelector('[data-mtr-filter="prep"]', { state: "visible" });
  const filter = page.locator('[data-mtr-filter="prep"]');
  await filter.selectOption("ready");
  await page.waitForFunction(() => document.querySelectorAll(".mt-row").length === 0, null, { timeout: 10000 }).catch(() => {});
  assert.equal(await page.locator(".mt-row").count(), 0, "nothing is ready yet");
  await filter.selectOption("needs_investigation");
  await page.waitForFunction(() => document.querySelectorAll(".mt-row").length === 2, null, { timeout: 10000 }).catch(() => {});
  assert.equal(await page.locator(".mt-row").count(), 2, "two active unprepared tasks");
  const firstCard = page.locator('.mtr-card').first();
  assert.match(await firstCard.innerText(), /Azure Boards/);
  assert.match(await firstCard.innerText(), /Sprint 74/);
  assert.match(await firstCard.innerText(), /P2/);
  assert.equal(await firstCard.locator('.mtr-card-meta .pill.amber').count(), 1, 'source priority has a colored badge as well as text');
  await filter.selectOption("");

  // 2. Preparation tab: brief edit flips the status to ready.
  await page.locator('.mt-row:has-text("Cart lost after login") .mtr-card-open').click();
  await page.waitForSelector(".mtr-detail-dialog");
  await page.click('[data-mtr-action="tab:prep"]');
  await page.waitForSelector("#prepOutcome");
  assert.ok((await page.locator(".mtr-prep-status").innerText()).includes("Needs investigation"), "tab opens in the honest state");
  assert.equal(await page.locator("#prepOutcome").inputValue(), "plain description", "outcome seeds from the saved description");
  await page.fill("#prepOutcome", "Guest cart survives login");
  await page.fill("#prepRequested", "Merge the guest cart into the account cart");
  await page.click('[data-mtr-action="prep-save"]');
  await page.waitForFunction(() => document.querySelector(".mtr-prep-status")?.textContent.includes("Ready to plan"));

  // 3. Owner question: needs your answer → answered via option button → ready.
  await page.click(".mtr-prep-add summary");
  await page.selectOption("#prepQKind", "owner_decision");
  await page.fill("#prepQText", "Merge or keep the carts separate?");
  await page.click('[data-mtr-action="prep-question"]');
  await page.waitForFunction(() => document.querySelector(".mtr-prep-status")?.textContent.includes("Needs your answer"));
  await page.fill("#prepAnswer-q1", "Merge the carts");
  await page.click('[data-mtr-action="prep-answer:q1"]');
  await page.waitForFunction(() => document.querySelector(".mtr-prep-status")?.textContent.includes("Ready to plan"));

  // 4. Bounded discovery through the planning seam: run recorded with its
  //    question raised; the brief panel never went blank.
  await page.click('[data-mtr-action="prep-discover"]');
  await page.waitForFunction(() => document.querySelectorAll(".mtr-prep-run").length >= 1, null, { timeout: 30000 });
  assert.ok((await page.locator(".mtr-prep").innerText()).includes("login flow drops the guest cart object"), "discovery findings render");
  await page.waitForFunction(() => document.querySelector(".mtr-prep-status")?.textContent.includes("Needs your answer"), null, { timeout: 10000 });
  assert.equal(discoveryCalls, 1, "exactly one bounded provider call");
  await page.click('[data-mtr-action="prep-answer:q2"][data-prep-option="Merge"]');
  await page.waitForFunction(() => document.querySelector(".mtr-prep-status")?.textContent.includes("Ready to plan"));

  // 5. Handoff: lands in Plan Studio with the source context bound.
  await page.click('[data-mtr-action="prep-handoff"]');
  await page.waitForSelector("#goal", { timeout: 30000 });
  const goal = await page.locator("#goal").inputValue();
  assert.ok(goal.includes("Cart lost after login"), "studio goal prefilled from the handed-off request");

  // 6. Back on My Tasks: the chip reflects the linked state after refresh.
  await page.click('[data-page="mytasks"]');
  await page.waitForSelector(".mt-row");
  assert.ok(await page.locator('.mt-row:has-text("Cart lost after login") .pill:has-text("Ready to plan")').count() === 1, "chip persists across navigation");

  // 7. RTL Persian: labels translate.
  await page.click("#localeBtn");
  await page.waitForFunction(() => document.documentElement.dir === "rtl");
  await page.locator('.mt-row:has-text("Cart lost after login") .mtr-card-open').click();
  await page.waitForSelector(".mtr-detail-dialog");
  await page.click('[data-mtr-action="tab:prep"]');
  await page.waitForSelector("#prepOutcome");
  assert.ok((await page.locator(".mtr-prep-status").innerText()).includes("آمادهٔ برنامه‌ریزی"), "Persian preparation label");
  assert.equal(errors.filter((message) => !/ResizeObserver/.test(message)).length, 0, `no page errors: ${errors.join(" | ")}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => running.server.close(resolve));
}

console.log("PASS: Task preparation UI journey — chips + filter, preparation tab brief edit, owner question lifecycle, bounded discovery run, handoff into Plan Studio with source context, persistence across navigation, RTL Persian labels");
