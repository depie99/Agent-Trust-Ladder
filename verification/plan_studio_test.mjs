import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { advanceStage, approvePlanDraft, frameIntent, generateLocalPlan, listPlanDrafts, loadPlanDraft, normalizeModelArtifact, reviewPlanArtifact, runPlanProvider, savePlanDraft, validatePlanArtifact } from "../runtime/lib/plan-studio.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-studio-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "multi_queue_test.mjs"), "// verifier fixture\n");
saveState(root, emptyState());

const localPlan = generateLocalPlan("Build the complete browser planning and queue execution flow");
assert.equal(validatePlanArtifact(localPlan), true, "local generation produces a complete SDD/TDD plan, not a frame placeholder");
assert.ok(localPlan.task_proposals.every((task) => task.objective.includes(localPlan.objective)), "every local task retains the user request");
assert.ok(localPlan.planning_limitations.length, "local template discloses its limits");
assert.throws(() => validatePlanArtifact({ ...localPlan, title: " " }), /title and objective/);
assert.throws(() => validatePlanArtifact({ ...localPlan, acceptance_examples: [{ given: {}, when: "w", then: "t" }] }), /given\/when\/then/);
assert.throws(() => validatePlanArtifact({ ...localPlan, verifier_commands: [null] }), /non-empty strings/);
const localDraft = savePlanDraft(root, { intent: localPlan.objective, artifact: localPlan, stage: "plan" });
assert.equal(listPlanDrafts(root)[0].id, localDraft.id, "browser-ready plan drafts are discoverable for full preview");

const framed = frameIntent("Make the TUI manage named queues and show provider usage", { constraints: ["do not bypass launch confirmation"], skills: ["atl-plan", "atl-verify"] });
assert.equal(framed.stage, "frame");
assert.throws(() => validatePlanArtifact(framed), /implementation_steps/, "incomplete frame is not a final plan");

// Staged SDD: intent → frame → specify → route → plan, each schema-checked.
const frameDraft = savePlanDraft(root, { intent: "Make the TUI manage named queues and show provider usage", artifact: framed, stage: "frame" });
assert.throws(() => advanceStage(root, frameDraft, "specify", { acceptance_examples: [], in_scope: ["queue book"], out_of_scope: ["providers"] }), /acceptance_examples/, "specify needs observable acceptance examples");
const specify = advanceStage(root, frameDraft, "specify", {
  in_scope: ["named queue storage", "usage display"],
  out_of_scope: ["provider quota adapters"],
  completion_checks: ["queue membership persists across reload"],
  acceptance_examples: [{ given: "two queues exist", when: "one launches", then: "the other is unchanged" }],
});
assert.equal(specify.stage, "specify");
assert.throws(() => advanceStage(root, specify, "route", { selected_skills: [], skill_route: [], proposed_worker: "pip" }), /route artifact missing/, "route needs skills and a worker");
const routed = advanceStage(root, specify, "route", {
  selected_skills: ["atl-plan", "atl-verify"],
  skill_route: [{ skill: "atl-plan", reason: "map the spec onto the runtime" }],
  proposed_worker: "pip",
});
assert.equal(routed.stage, "route");
assert.equal(fs.existsSync(path.join(frameDraft.dir, "stage-specify.json")), true, "specify stage is persisted");
assert.equal(fs.existsSync(path.join(frameDraft.dir, "stage-route.json")), true, "route stage is persisted");
const before = fs.readFileSync(frameDraft.intentPath, "utf8");
advanceStage(root, routed, "plan", {
  risks: [],
  implementation_steps: [{ step: "Add named queue storage", files: ["runtime/lib/queue.mjs"], verify: "node verification/multi_queue_test.mjs" }],
  verifier_commands: ["node verification/multi_queue_test.mjs"],
});
assert.equal(fs.readFileSync(frameDraft.intentPath, "utf8"), before, "advancing stages never rewrites the raw intent");

await assert.rejects(() => runPlanProvider(root, "unsafe provider call", { invoke: async () => ({ code: 0, text: "{}" }) }), /explicit confirmation/);
await assert.rejects(
  () => runPlanProvider(root, "exhausted budget call", { confirm: true, invoke: async () => ({ code: 0, text: "{}" }), budget: { sessions: 5, maxSessions: 5 } }),
  /exhausted/,
  "an exhausted local budget refuses the provider call before any spend",
);

const providerDraft = await runPlanProvider(root, "Make the TUI manage named queues", {
  confirm: true,
  role: "pip",
  provider: "codex",
  invoke: async ({ logPath, request }) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, "fake provider response\n");
    return { code: 0, text: JSON.stringify({
      plan_contract_version: 2,
      title: "Manage named queues",
      objective: request.intent,
      requirements: [{ id: "r1", text: "queue membership persists", source: "original request" }],
      observed_evidence: [{ description: "Queue verifier exists", path: "verification/multi_queue_test.mjs" }], assumptions: [], open_questions: [],
      constraints: [], risks: [],
      completion_checks: ["queue membership persists"],
      acceptance_examples: [{ given: "two queues exist", when: "one launches", then: "the other is unchanged" }],
      selected_skills: ["atl-plan"], proposed_worker: "pip", skill_route: [],
      implementation_steps: [{ step: "Implement queue book", files: ["runtime/lib/queue.mjs"], verify: "node verification/multi_queue_test.mjs" }],
      verifier_commands: ["node verification/multi_queue_test.mjs"],
      task_proposals: [{ id: "p1", title: "Implement queue book", objective: request.intent, instructions: "Implement persistent queue membership.", deliverables: ["named queue storage"], requirement_ids: ["r1"], completion_checks: ["queue membership persists"], selected_skills: ["atl-plan"], skill_reasons: { "atl-plan": "Maps requested behavior onto an evidence-backed implementation plan." }, depends_on: [], files: ["runtime/lib/queue.mjs"], verify: "node verification/multi_queue_test.mjs" }],
    }), provider: "codex", model: "glm-5.3" };
  },
});
assert.equal(providerDraft.stage, "plan", "provider output is stored as a plan draft");
assert.equal(providerDraft.provider, "codex", "the provider behind a draft is visible");
assert.equal(providerDraft.model, "glm-5.3", "the model behind a draft is visible");
assert.equal(loadPlanDraft(root, providerDraft.id).provider, "codex", "provider selection persists on the draft envelope");
assert.equal(Object.keys(loadState(root).tasks).length, 0, "unapproved provider output cannot create or mutate canonical tasks");

assert.throws(() => approvePlanDraft(root, providerDraft, { note: "approved test plan" }), /fresh, passing accuracy review/);
const reviewedDraft = reviewPlanArtifact(root, providerDraft.id, { verdict: "passed", findings: [] });
const approved = approvePlanDraft(root, reviewedDraft, { note: "approved test plan" });
assert.equal(approved.created, true, "approval creates the canonical task");
assert.equal(loadState(root).tasks[approved.task.id].plan_draft_id, providerDraft.id, "task links to its approved draft");
assert.equal(approvePlanDraft(root, providerDraft.id).created, false, "approval is idempotent");

// Common model output drift is normalized onto given/when/then and
// step/files/verify before the gate; a still-unrecognizable shape passes
// through and stays refused.
const drifted = normalizeModelArtifact({
  title: "t", objective: "o",
  completion_checks: ["c"],
  acceptance_criteria: [
    { scenario: "two queues exist", condition: "one launches", expected: "the other is unchanged" },
    "Given a saved draft when the studio reloads then the draft is still there",
    { nonsense: true },
  ],
  implementation_steps: [
    "Evidence sweep before prose: read the CLI source of truth and record the inventory.",
    { description: "Fix naming and scope in a short terms note", paths: "docs/team.html, README.md", evidence: "Terms note exists with both names" },
    { step: "s", files: ["f"], verify: "v" },
    { nonsense: true },
  ],
  verifier_commands: ["v"],
});
assert.deepEqual(drifted.acceptance_examples[0], { given: "two queues exist", when: "one launches", then: "the other is unchanged" }, "scenario/condition/expected maps to given/when/then");
assert.deepEqual(drifted.acceptance_examples[1], { given: "a saved draft", when: "the studio reloads", then: "the draft is still there" }, "prose given/when/then strings map");
assert.throws(() => validatePlanArtifact(drifted), /acceptance_examples/, "an unrecognizable example shape is still refused");
assert.deepEqual(drifted.implementation_steps[0], { step: "Evidence sweep before prose: read the CLI source of truth and record the inventory.", files: [], verify: "" }, "a plain-string step becomes a step object with empty files/verify");
assert.deepEqual(drifted.implementation_steps[1], { step: "Fix naming and scope in a short terms note", files: ["docs/team.html", "README.md"], verify: "Terms note exists with both names" }, "description/paths/evidence aliases map onto step/files/verify");
assert.deepEqual(drifted.implementation_steps[2], { step: "s", files: ["f"], verify: "v" }, "canonical steps pass through untouched");
assert.throws(() => validatePlanArtifact({ ...drifted, acceptance_examples: [{ given: "g", when: "w", then: "t" }], implementation_steps: [{ nonsense: true }] }), /implementation_steps/, "an unrecognizable step shape is still refused");
assert.throws(() => validatePlanArtifact({ ...drifted, acceptance_examples: [{ given: "g", when: "w", then: "t" }], implementation_steps: ["  "] }), /implementation_steps/, "a blank string step is still refused");

await assert.rejects(() => runPlanProvider(root, "drift tolerant run", {
  confirm: true,
  provider: "codex",
  invoke: async ({ request }) => ({
    code: 0,
    text: JSON.stringify({
      title: "Drift", objective: request.intent, completion_checks: ["x"],
      acceptance_criteria: [{ scenario: "s", condition: "c", expected: "e" }],
      implementation_steps: ["wire the studio to the registry", { description: "harden the prompt rule", files: ["runtime/lib/plan-studio.mjs"], verify: "rule names the step shape" }],
      verifier_commands: ["v"],
    }),
    provider: "codex", model: "m",
  }),
}), /Plan Contract v2/, "mappable legacy-shaped output remains a draft candidate but cannot pass the strict v2 planning contract");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: Plan Studio — staged framing, explicit provider confirmation, schema validation, draft approval");
