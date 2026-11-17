import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { emptyState, saveState } from "../runtime/lib/state.mjs";

// A blocked accuracy review must be legible: the approve button is visibly
// disabled WITH its reason, findings carry a tally, and one action prepares
// the revision instead of the owner staring at a stale failure notice.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-review-blocked-"));
saveState(root, emptyState()); // a connected snapshot keeps controls enabled (offline mode disables them)
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-review-home-"));
const savedHome = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
process.env.USERPROFILE = home;
process.env.HOME = home;
fs.mkdirSync(path.join(home, ".atl"), { recursive: true });
fs.writeFileSync(path.join(home, ".atl", "providers.json"), JSON.stringify({ providers: { test: { id: "test", label: "Test", worker: "claude", base_url: "https://example.test", api_key: "test-key", model: "test-model" } } }));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "app.js"), "// fixture\n");

const plan = (intent) => ({
  plan_contract_version: 2,
  title: "Fix the cart merge",
  objective: intent,
  requirements: [{ id: "r1", text: "cart lines merge without duplicates", source: "original request" }],
  constraints: [], observed_evidence: [{ description: "app source", path: "src/app.js" }],
  assumptions: [], open_questions: [], risks: [],
  completion_checks: ["cart lines merge without duplicates"],
  acceptance_examples: [{ given: "two carts", when: "the guest logs in", then: "lines merge" }],
  selected_skills: ["atl-implement"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [{ step: "Fix merge", files: ["src/app.js"], verify: "node -e \"\"" }],
  verifier_commands: ["node -e \"\""],
  task_proposals: [{ id: "p1", title: "Fix cart merge", objective: intent, instructions: "Merge duplicate cart lines for the same product variant when the guest cart is merged into the authenticated cart after login.", deliverables: ["Cart module merges duplicate lines on login"], requirement_ids: ["r1"], completion_checks: ["cart lines merge without duplicates"], selected_skills: ["atl-implement"], skill_reasons: { "atl-implement": "Implements the bounded fix." }, depends_on: [], files: ["src/app.js"], verify: "node -e \"\"" }],
});
const blockedFindings = [
  { severity: "blocker", requirement_id: "r1", message: "The cart-merge contract is deferred to discovery instead of decided.", correction: "Decide the merge rule explicitly before approval." },
  { severity: "blocker", requirement_id: "r2", message: "Failure and retry behavior is unspecified.", correction: "Specify the retry invariant." },
  { severity: "major", requirement_id: "r1", message: "Verification does not cover duplicate lines.", correction: "Add a duplicate-line check." },
  { severity: "minor", requirement_id: "r1", message: "Wording of the acceptance example.", correction: "Rephrase." },
];
let browser, server;
try {
  let reviewCalls = 0;
  const started = await startControlPlaneServer(root, {
    planningInvoke: async ({ request }) => {
      if (request.review) {
        reviewCalls++;
        return reviewCalls === 1
          ? { code: 0, provider: "test", model: "m", text: JSON.stringify({ verdict: "blocked", findings: blockedFindings }) }
          : { code: 0, provider: "test", model: "m", text: JSON.stringify({ verdict: "passed", findings: [] }) };
      }
      return { code: 0, provider: "test", model: "m", text: JSON.stringify(plan(request.intent)) };
    },
  });
  server = started.server;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  await page.goto(started.url);
  await page.locator('[data-page="studio"]').first().click();
  await page.locator("#goal").fill("Fix the cart merge without duplicates");
  await page.locator(".studio-settings > summary").click();
  await page.getByRole("button", { name: "Generate with model", exact: true }).click();
  await page.locator('[data-action="generate"]').click();
  await page.getByText("Model plan ready", { exact: false }).waitFor();

  // The plan lands on the Tasks tab; review controls live in the Review tab.
  const reviewTab = page.locator('.planpane-tabs [data-action="studio-plantab:review"]');
  await reviewTab.click();
  // The disabled approve states its reason before any review exists.
  // The header CTA and next-step bar mirror the review-section control, so
  // scope approval assertions to the Plan review region.
  const approve = page.getByRole("region", { name: "Plan review" }).getByRole("button", { name: "Approve → Plan Queue" });
  assert.equal(await approve.isDisabled(), true, "Approve is disabled before any review");
  assert.ok(Number(await approve.evaluate((node) => getComputedStyle(node).opacity)) < 0.6, "a disabled Approve looks disabled, not clickable");
  await page.locator("[data-approval-state]").waitFor();
  assert.match(await page.locator("[data-approval-state]").innerText(), /Ready for review/);

  await page.getByRole("button", { name: "Run review" }).click();
  await page.getByText(/Changes needed before approval/, { exact: false }).waitFor();
  assert.equal(await approve.isDisabled(), true, "a blocked review keeps Approve disabled");
  assert.equal(await page.getByRole("button", { name: "Run review" }).isDisabled(), false, "the review can run again");
  const stateText = await page.locator("[data-approval-state]").innerText();
  assert.match(stateText, /needs changes before approval/);
  assert.match(stateText, /run the review again/);
  assert.match(await page.locator(".review-findings").innerText(), /Correction|What to change/i);

  // One click prepares the revision request instead of retyping findings.
  await page.getByRole("button", { name: /Create revised draft from findings/ }).click();
  await page.locator("[data-studio-notice]").getByText(/Revision request prepared from 3 review finding/).waitFor();
  assert.match(await page.locator(".studio-revision").innerText(), /cart-merge contract/);

  // A passing review flips the state: Approve unlocks and the notice disappears.
  await page.locator('[data-action="generate"]').click();
  await page.getByText("Model plan ready", { exact: false }).waitFor();
  await reviewTab.click();
  await page.getByRole("button", { name: "Run review" }).click();
  await page.getByRole("heading", { name: "Review passed" }).waitFor();
  assert.equal(await page.getByRole("region", { name: "Plan review" }).getByRole("button", { name: "Approve → Plan Queue" }).isDisabled(), false);
  assert.equal(await page.locator("[data-approval-state]").count(), 0, "no approval-state notice once approval is unlocked");

  console.log("PASS: blocked review UX — disabled Approve states its reason, findings tallied, revise action, passing review unlocks");
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(savedHome)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
