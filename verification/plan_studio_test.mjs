import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { advanceStage, approvePlanDraft, frameIntent, generateLocalPlan, listPlanDrafts, loadPlanDraft, normalizeModelArtifact, normalizeModelEvidence, normalizePlanContract, repairPlanDraft, reviewPlanArtifact, runPlanProvider, savePlanDraft, validatePlanArtifact, validatePlanGrounding } from "../runtime/lib/plan-studio.mjs";
import { legacyLocalPlan } from "./plan_local_fixture.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-studio-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "multi_queue_test.mjs"), "// verifier fixture\n");
saveState(root, emptyState());

// Local generation is a skeleton, never an approvable plan: it reads no
// repository, so it cannot satisfy the grounded-evidence plan contract.
const skeleton = generateLocalPlan("Build the complete browser planning and queue execution flow");
assert.equal(skeleton.plan_skeleton, true, "local generation marks its output as a skeleton");
assert.ok(!skeleton.task_proposals, "a local skeleton emits no task proposals");
assert.throws(() => validatePlanArtifact(skeleton), /implementation_steps/, "a skeleton is refused as a plan artifact");
assert.throws(() => savePlanDraft(root, { intent: skeleton.objective, artifact: skeleton, stage: "plan" }), /implementation_steps/, "a skeleton cannot be saved as an approvable plan draft");
const skeletonDraft = savePlanDraft(root, { intent: skeleton.objective, artifact: skeleton, stage: "frame" });
assert.equal(listPlanDrafts(root)[0].id, skeletonDraft.id, "skeleton drafts stay discoverable for the studio preview");

// The rest of the suite exercises plan semantics on the legacy local plan
// shape (no plan_contract_version, generic template paths).
const localPlan = legacyLocalPlan("Build the complete browser planning and queue execution flow");
assert.equal(validatePlanArtifact(localPlan), true, "the legacy local plan fixture validates as a (pre-contract) plan");
assert.ok(localPlan.task_proposals.every((task) => task.objective.includes(skeleton.objective)), "every local task retains the user request");
assert.ok(skeleton.planning_limitations.length, "local skeleton discloses its limits");
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

const omittedVerifierIndex = normalizeModelArtifact({
  task_proposals: [{ verify: "node test/scroll.mjs" }, { verify: "node test/scroll.mjs" }, { verify: "Review the viewport manually" }],
  implementation_steps: [{ step: "Fix scrolling", verify: "node test/scroll.mjs" }],
});
assert.deepEqual(omittedVerifierIndex.verifier_commands, ["node test/scroll.mjs", "Review the viewport manually"], "missing plan-level verifier list is derived from explicit task checks without inventing checks");
assert.equal(normalizeModelArtifact({ implementation_steps: [{ step: "Investigate", verify: "" }] }).verifier_commands, undefined, "no project check is synthesized when the model supplied none");

// Task 6341 drift (2026-11-07): the provider returned verifier_commands as an
// empty array (present, not omitted) and put per-card checks in list-shaped
// verify fields. The index must still be derived, and list verify must count.
const emptyIndexListVerify = normalizeModelArtifact({
  task_proposals: [{ verify: ["Owner approval of the behavior spec"] }],
  implementation_steps: [{ step: "Probe product selection", verify: ["node test/sales_test.mjs"] }],
  verifier_commands: [],
});
assert.deepEqual(emptyIndexListVerify.verifier_commands, ["Owner approval of the behavior spec", "node test/sales_test.mjs"], "an empty verifier_commands array is treated as missing and list-shaped verify entries are collected");

// Real drift seen from a subscription provider (Bug 6336 report, 2026-11-07):
// requirements named with statement/source and R1-style ids. The normalizer
// maps the text and lowercases ids, remapping task links, so a semantically
// correct plan is not burned after a full provider session.
const statementShaped = normalizeModelArtifact({
  plan_contract_version: 2, title: "Bug 6336", objective: "Restore table scrolling with Infinite Scroll and Load More pagination.",
  requirements: [
    { id: "R1", source: "User-provided Bug 6336 intent", statement: "Identify and reproduce the reported table scrolling failure." },
    { id: "R2", source: "User-provided Bug 6336 intent", statement: "Restore the agreed scrolling behavior when Infinite Scroll pagination is enabled." },
  ],
  observed_evidence: [], assumptions: [], open_questions: [], constraints: [], risks: [],
  completion_checks: ["Scrolling works with Infinite Scroll enabled"], acceptance_examples: [{ given: "infinite scroll is on", when: "the table is scrolled", then: "all rows stay reachable" }],
  implementation_steps: [{ step: "Reproduce the scroll failure", files: [], verify: "" }],
  verifier_commands: ["node verification/scroll_test.mjs"],
  task_proposals: [
    { id: "p1", title: "Reproduce", objective: "Reproduce", instructions: "Reproduce the reported scrolling failure against the real table surface.", deliverables: ["reproduction notes"], requirement_ids: ["R1"], completion_checks: ["failure reproduced"], selected_skills: ["atl-implement"], skill_reasons: { "atl-implement": "implements the fix" }, files: [], verify: "" },
    { id: "p2", title: "Restore scrolling", objective: "Restore", instructions: "Restore scrolling under Infinite Scroll and Load More without regressing pagination.", deliverables: ["fix"], requirement_ids: ["R1", "R2"], completion_checks: ["scrolling restored"], selected_skills: ["atl-implement"], skill_reasons: { "atl-implement": "implements the fix" }, files: [], verify: "" },
  ],
});
assert.deepEqual(statementShaped.requirements.map((item) => item.id), ["r1", "r2"], "R-style requirement ids normalize to r-ids");
assert.equal(statementShaped.requirements[1].text, "Restore the agreed scrolling behavior when Infinite Scroll pagination is enabled.", "statement maps onto text");
assert.deepEqual(statementShaped.task_proposals[1].requirement_ids, ["r1", "r2"], "task requirement links follow the normalized ids");
assert.equal(validatePlanArtifact(statementShaped), true, "a statement/R-id shaped v2 plan passes the contract gate after normalization");

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

// Task 6341: structured checks and per-task aliases must reach editable cards.
const structured = structuredClone(statementShaped);
structured.completion_checks = [{ id: "CHECK-001", statement: "Scrolling works with Infinite Scroll enabled" }];
for (const proposal of structured.task_proposals) {
  proposal.completion_checks = proposal.completion_checks.map((statement) => ({ statement }));
  proposal.concrete_instructions = [proposal.instructions];
  delete proposal.instructions;
  proposal.affected_files = proposal.files;
  delete proposal.files;
  proposal.verify = ["node verification/multi_queue_test.mjs"];
  proposal.skill_reasons = Object.entries(proposal.skill_reasons).map(([skill, reason]) => ({ skill, reason }));
}
structured.verifier_commands = [{ command: "node verification/multi_queue_test.mjs", source: "project scripts", purpose: "Verify behavior" }];
const structuredBefore = structuredClone(structured);
const repaired = normalizeModelArtifact(structured);
assert.equal(validatePlanArtifact(repaired), true);
assert.deepEqual(structured, structuredBefore, "normalization never mutates the provider response");
assert.deepEqual(normalizeModelArtifact(repaired), repaired, "normalization is idempotent");
assert.throws(() => validatePlanArtifact(normalizeModelArtifact({ ...structured, completion_checks: [{ id: "unknown" }] })), /completion_checks/);
assert.throws(() => validatePlanArtifact(normalizeModelArtifact({ ...structured, completion_checks: [{ statement: "one", text: "conflicting" }] })), /completion_checks/);
assert.throws(() => validatePlanArtifact(normalizeModelArtifact({ ...structured, completion_checks: [] })), /completion_checks/);
const recovered = await runPlanProvider(root, "Recover structured planning output", {
  confirm: true,
  invoke: async ({ request }) => {
    assert.ok(request.field_shapes.task_proposals[0].skill_reasons);
    return { code: 0, text: JSON.stringify(structured) };
  },
});
assert.deepEqual(loadPlanDraft(root, recovered.id).artifact.completion_checks, repaired.completion_checks);
assert.throws(() => approvePlanDraft(root, recovered.id), /fresh, passing accuracy review/);

// The second Task 6341 incident passed the schema and then failed grounding:
// summaries of supplied context had no path. Preserve claims honestly and
// block approval for clarification instead of discarding the model plan.
const proseEvidence = { ...structured, observed_evidence: ["package.json supplies the test script.", { source: "project_evidence", fact: "No homepage files were inspected." }] };
const proseBefore = structuredClone(proseEvidence);
const evidenceNormalized = normalizeModelEvidence(proseEvidence);
assert.deepEqual(proseEvidence, proseBefore);
assert.deepEqual(normalizeModelEvidence(evidenceNormalized), evidenceNormalized);
assert.deepEqual(evidenceNormalized.observed_evidence, []);
assert.ok(evidenceNormalized.assumptions.some((item) => item.includes("No homepage files were inspected.")));
assert.equal(evidenceNormalized.open_questions.at(-1).blocks_approval, true);
const groundedDraft = await runPlanProvider(root, "Preserve prose evidence", { confirm: true, invoke: async () => ({ code: 0, text: JSON.stringify(proseEvidence) }) });
const grounded = loadPlanDraft(root, groundedDraft.id);
assert.equal(validatePlanGrounding(root, grounded.artifact), true);
assert.equal(reviewPlanArtifact(root, grounded.id, { verdict: "passed", findings: [] }).review.verdict, "blocked", "unverified claims block approval even if a reviewer says passed");
assert.throws(() => approvePlanDraft(root, grounded.id), /fresh, passing accuracy review/);

// Codex commonly uses `text` for the evidence statement. It is an unlinked
// claim, not malformed evidence: preserve it as an assumption and make the
// missing citation an explicit approval-blocking question.
const textEvidence = { ...structured, observed_evidence: [{ source: "project_evidence", text: "The supplied repository summary names src and tests." }] };
const textEvidenceNormalized = normalizeModelEvidence(textEvidence);
assert.deepEqual(textEvidenceNormalized.observed_evidence, []);
assert.ok(textEvidenceNormalized.assumptions.some((item) => item.includes("supplied repository summary names src and tests")));
assert.equal(textEvidenceNormalized.open_questions.at(-1).blocks_approval, true);
const textGroundedDraft = await runPlanProvider(root, "Preserve text-shaped evidence", { confirm: true, invoke: async () => ({ code: 0, text: JSON.stringify(textEvidence) }) });
assert.equal(validatePlanGrounding(root, loadPlanDraft(root, textGroundedDraft.id).artifact), true);

// Suggested answers are optional model guidance: only concise string choices
// are preserved, and they never resolve a question until the manager selects
// one through the normal clarification endpoint.
const suggestedQuestionPlan = normalizePlanContract({ ...structured, open_questions: [{ id: "q1", question: "Which scope?", suggested_answers: ["Homepage only", "Shared selector", "", 42, "Tests first", "Too many"] }] });
assert.deepEqual(suggestedQuestionPlan.open_questions[0].suggested_answers, ["Homepage only", "Shared selector", "Tests first", "Too many"]);
assert.equal(suggestedQuestionPlan.open_questions[0].resolved, false);

let recovery;
await assert.rejects(() => runPlanProvider(root, "Keep invalid JSON recoverable", { confirm: true, invoke: async () => ({ code: 0, text: '{"title":', provider: "test-provider" }) }), (error) => {
  recovery = error.recoveryDraft;
  return /valid JSON/.test(error.message);
});
assert.equal(loadPlanDraft(root, recovery.id).recovery.response, '{"title":');
assert.equal(listPlanDrafts(root).find((item) => item.id === recovery.id).stage, "repair");
assert.throws(() => approvePlanDraft(root, recovery.id), /Repair and validate/);
assert.throws(() => reviewPlanArtifact(root, recovery.id, { verdict: "passed", findings: [] }), /Repair and validate/);
assert.throws(() => repairPlanDraft(root, recovery.id, "{}"), /Plan Contract v2/);
assert.equal(loadPlanDraft(root, recovery.id).stage, "repair", "a bad repair leaves the saved response intact");
assert.throws(() => repairPlanDraft(root, recovery.id, JSON.stringify(structured), { expectedRevision: 99 }), /changed/);
const fixedRecovery = repairPlanDraft(root, recovery.id, JSON.stringify(structured), { expectedRevision: recovery.revision });
assert.equal(fixedRecovery.stage, "plan");
assert.equal(fixedRecovery.recovery.response, '{"title":', "successful repair retains the original response for audit");
assert.throws(() => approvePlanDraft(root, recovery.id), /fresh, passing accuracy review/);
assert.throws(() => loadPlanDraft(root, "../outside"), /Invalid plan draft id/);

// Path fabrication is never normalized into a verified observation.
await assert.rejects(() => runPlanProvider(root, "Refuse invented evidence", { confirm: true, invoke: async () => ({ code: 0, text: JSON.stringify({ ...structured, observed_evidence: [{ path: "invented.mjs", description: "not inspected" }] }) }) }), (error) => {
  assert.equal(error.recoveryDraft.stage, "repair");
  assert.equal(loadPlanDraft(root, recovered.id).stage, "plan", "rejection does not overwrite a valid draft");
  return /not found/.test(error.message);
});

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: Plan Studio — staged framing, explicit provider confirmation, schema validation, draft approval");
