import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Browser journey for the EGM deep-review UI: pick the review depth, run the
// deep review against a fake glm-goldfish runner, see the backend badge and
// findings, and confirm the approval gate behaves (blocked stays shut; a
// passing deep review approves and creates the Plan Queue).

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-egm-journey-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-egm-journey-home-"));
const oldHome = process.env.USERPROFILE; const oldHomePosix = process.env.HOME;
process.env.USERPROFILE = home; process.env.HOME = home;
fs.mkdirSync(path.join(home, ".atl"), { recursive: true });
fs.writeFileSync(path.join(home, ".atl", "providers.json"), JSON.stringify({ providers: { test: { id: "test", label: "Test", worker: "claude", base_url: "https://example.test", api_key: "test-key", model: "test-model" } } }));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, egmReview: { enabled: true, backend: "glm-goldfish", versionSha: "5ba5afa03f62627639fa4f71b7ac3bd4d8d07e24", maxReviewsPerDay: 10 } }));
saveState(root, emptyState());
fs.mkdirSync(path.join(root, "test"), { recursive: true });
fs.writeFileSync(path.join(root, "test", "search.mjs"), "// verifier fixture\n");

const REPORT = (ready) => `# Consolidated EGM Review Report

## Verdict

${ready ? "ready for implementation. The plan is bounded and verifiable." : "not ready for implementation. The verification story is thin."}

## Action items by priority

${ready ? "" : "### 🔴 Blockers\n\n#### A1 — Strengthen the verifier\n\nThe single verifier command does not cover the negative search case.\n"}
### 🟢 Nits

#### A${ready ? "1" : "2"} — Wording

Replace vague terms with observable behavior.
`;

let mode = "blocked";
const planningInvoke = async ({ request }) => {
  if (request.review) return { code: 0, provider: "test", model: "test-model", text: JSON.stringify({ verdict: "passed", findings: [] }) };
  return { code: 0, provider: "test", model: "test-model", text: JSON.stringify({ plan_contract_version: 2, title: "Search project rooms", objective: request.intent, requirements: [{ id: "r1", text: "Search filters by repository name", source: "original request" }], constraints: [], observed_evidence: [{ description: "Verifier", path: "test/search.mjs" }], assumptions: [], open_questions: [], risks: [], completion_checks: ["Search filters by repository name"], acceptance_examples: [{ given: "two repositories", when: "the user searches Alpha", then: "only Alpha is shown" }], selected_skills: ["atl-implement"], skill_route: [], proposed_worker: "pip", implementation_steps: [{ step: "Implement search", files: ["test/search.mjs"], verify: "node test/search.mjs" }], verifier_commands: ["node test/search.mjs"], task_proposals: [{ id: "p1", title: "Implement repository search", objective: request.intent, instructions: "Add repository name filtering with bounded scope.", deliverables: ["search behavior"], requirement_ids: ["r1"], completion_checks: ["node test/search.mjs"], proposed_worker: "pip", selected_skills: ["atl-implement"], skill_reasons: { "atl-implement": "Implements the bounded behavior." }, depends_on: [], files: ["test/search.mjs"], verify: "node test/search.mjs" }] }) };
};
const egmRunner = async (rootArg, { draft }) => {
  const workdir = path.join(draft.dir, "egm", `journey-${Date.now()}`);
  fs.mkdirSync(workdir, { recursive: true });
  for (const name of ["zoom_out_report.md", "comprehension_report.md", "critic_report.md", "intermediate_zoom_out_report.md", "implementation_readiness_report.md", "consolidated_review_report.md"]) {
    fs.writeFileSync(path.join(workdir, name), name === "consolidated_review_report.md" ? REPORT(mode === "passed") : `# ${name}\n`);
  }
  return { workdir, exitCode: 0, durationMs: 5, lastMessage: "journey" };
};

const started = await startControlPlaneServer(root, { planningInvoke, egmRunner });
const browser = await chromium.launch({ headless: true });
let failed = "";
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30000); // slow filesystems (WSL drvfs) need headroom
  await page.goto(started.url);
  await page.locator('[data-page="tasks"]').first().click();
  await page.locator('[data-action="new"]').first().click();
  await page.locator('#fTitle').fill("Search project rooms");
  await page.locator('#fDesc').fill("Filter repositories by name. Preserve deletion behavior.");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await page.getByText("Search project rooms", { exact: true }).first().click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("button", { name: "Plan task", exact: true }).click();
  await page.locator("#goal").waitFor();
  await page.locator("#goal").fill("Filter repositories by name. Preserve deletion behavior.");
  await page.getByRole("button", { name: "Generate with model", exact: true }).click();
  await page.locator('button[data-action="generate"]').last().click();
  await page.getByText("Model plan ready", { exact: false }).waitFor();  await page.getByText("Model plan ready", { exact: false }).waitFor();

  // Pick the deep review depth; the run button relabels accordingly.
  await page.locator("#reviewKindSelect").selectOption("egm");
  let reviewResponse = page.waitForResponse((r) => r.url().includes("/api/plan/review"));
  await page.getByRole("button", { name: "Run EGM deep review" }).click();
  const blockedResponse = await reviewResponse;
  const blockedBody = await blockedResponse.json();
  assert.equal(blockedResponse.status(), 200, `blocked deep review HTTP: ${JSON.stringify(blockedBody).slice(0, 300)}`);

  // Scenario A: blocked deep review keeps the approval gate shut.
  await page.getByText(`EGM deep review ${blockedBody.review.verdict}`, { exact: false }).waitFor();
  await page.getByText("EGM deep review (glm-goldfish · 5ba5afa", { exact: false }).waitFor();
  await page.getByText("A1 — Strengthen the verifier", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Approve and create Plan Queue" }).click();
  await page.getByText("Plan approval failed", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(Object.values(loadState(root).tasks).filter((task) => task.plan_draft_id).length, 0, "a blocked deep review creates no queue tasks");

  // Scenario B: after a passing deep review the same draft approves.
  mode = "passed";
  reviewResponse = page.waitForResponse((r) => r.url().includes("/api/plan/review"));
  await page.getByRole("button", { name: "Run EGM deep review" }).click();
  const passedResponse = await reviewResponse;
  assert.equal(passedResponse.status(), 200, JSON.stringify(await passedResponse.json()).slice(0, 300));
  await page.getByText("EGM deep review passed", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Approve and create Plan Queue" }).click();
  await page.getByText("Plan approved — Plan Queue created").waitFor();
  const tasks = Object.values(loadState(root).tasks).filter((task) => task.plan_draft_id);
  assert.equal(tasks.length, 1, "the passing deep review approves into exactly one queued task");
  assert.equal(tasks[0].status, "new", "approval creates membership only — the queue is not executed");

  console.log("PASS: EGM deep-review journey — depth picker, backend badge, blocked gate, passing approval");
} catch (error) {
  failed = error;
  try { await browser.screenshot({ path: path.join(root, "journey-failure.png"), fullPage: true }); } catch { /* diagnostics */ }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => started.server.close(resolve));
  if (oldHome === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldHome;
  if (oldHomePosix === undefined) delete process.env.HOME; else process.env.HOME = oldHomePosix;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
