import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import {
  answerCandidateQuestion, applyPlanCandidate, candidateChanges, discardPlanCandidate,
  loadPlanDraft, refinePlanDraft, reviewPlanArtifact, savePlanDraft,
} from "../runtime/lib/plan-studio.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-refine-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "plan_studio_refine_test.mjs"), "// verifier fixture\n");
saveState(root, emptyState());

const verifier = "node verification/plan_studio_refine_test.mjs";
const v2Plan = (title, extra = {}) => ({
  plan_contract_version: 2,
  title,
  objective: "Plan the bounded feature end to end",
  requirements: [{ id: "r1", text: "The feature works", source: "original request" }],
  constraints: [],
  observed_evidence: [{ description: "Relevant project verification exists", path: "verification/plan_studio_refine_test.mjs" }],
  assumptions: [],
  open_questions: [],
  risks: [],
  completion_checks: ["the feature is observable"],
  acceptance_examples: [{ given: "g", when: "w", then: "t" }],
  implementation_steps: [{ step: "Implement it", files: ["verification/"], verify: verifier }],
  verifier_commands: [verifier],
  task_proposals: [
    { id: "p1", title: "Implement it", objective: "Implement the feature", instructions: "Implement the requested behavior and preserve existing contracts.", deliverables: ["working feature"], requirement_ids: ["r1"], completion_checks: ["the feature is observable"], proposed_worker: "pip", selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Plans verifiable acceptance evidence." }, depends_on: [], files: ["verification/plan_studio_refine_test.mjs"], verify: verifier },
  ],
  ...extra,
});
const refinedPlan = (title, extra = {}) => v2Plan(title, {
  task_proposals: [
    v2Plan(title).task_proposals[0],
    { id: "p2", title: "Add regression checks", objective: "Cover the feature with regression checks", instructions: "Write failing checks first, observe them fail, then implement.", deliverables: ["regression suite"], requirement_ids: ["r1"], completion_checks: ["regression suite passes"], proposed_worker: "pip", selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Verifies the regression suite." }, depends_on: ["p1"], files: ["verification/"], verify: verifier },
  ],
  ...extra,
});
let refineResponses = [];
const fakeInvoke = async () => refineResponses.shift()();

const base = savePlanDraft(root, { intent: "Ship the conversational Plan Studio workspace", artifact: v2Plan("Feature plan"), stage: "plan" });
assert.equal(base.revision, 1, "a fresh draft starts at revision 1");

// ---------- conversation + candidate are recorded; the saved plan is untouched
refineResponses = [() => ({ code: 0, text: JSON.stringify({ summary: "Added a regression task after the implementation task.", artifact: refinedPlan("Feature plan") }), provider: "testprov", model: "m-1" })];
const refined = await refinePlanDraft(root, base.id, "Add a regression task behind the implementation one.", { invoke: fakeInvoke, confirm: true, provider: "testprov", model: "m-1" });
assert.equal(refined.revision, 1, "recording a candidate does not bump the draft revision");
assert.equal(refined.artifact.task_proposals.length, 1, "the saved plan is unchanged until the candidate is applied");
assert.equal(refined.conversation.length, 2, "the manager message and the assistant answer are both recorded");
assert.equal(refined.conversation[0].role, "manager", "the manager entry comes first");
assert.equal(refined.conversation[0].text, "Add a regression task behind the implementation one.");
assert.equal(refined.conversation[1].role, "assistant", "the assistant summary follows");
assert.match(refined.conversation[1].text, /regression task/, "the assistant entry carries the change summary");
assert.ok(Number(refined.conversation[1].elapsed_ms) >= 0, "assistant entries record elapsed time");
assert.equal(refined.pending_candidate.based_on_revision, 1, "the candidate pins the revision it was proposed against");
assert.equal(refined.pending_candidate.artifact.task_proposals.length, 2, "the candidate holds the proposed task list");
assert.deepEqual(refined.pending_candidate.changes, [{ kind: "added", id: "p2", title: "Add regression checks" }], "the candidate records added/changed/removed cards");
const reread = loadPlanDraft(root, base.id);
assert.equal(reread.artifact.task_proposals.length, 1, "the on-disk plan is untouched by a pending candidate");

// ---------- candidate questions answer without invalidating the candidate
refineResponses = [() => ({ code: 0, text: JSON.stringify({ summary: "Asked the blocking rollout question.", artifact: refinedPlan("Feature plan", { open_questions: [{ id: "q1", question: "Roll the feature out behind a flag?", suggested_answers: ["Behind a flag", "Direct rollout"], blocks_approval: true }] }) }), provider: "testprov", model: "m-1" })];
const withQuestion = await refinePlanDraft(root, base.id, "How should this roll out?", { invoke: fakeInvoke, confirm: true, provider: "testprov", model: "m-1" });
assert.equal(withQuestion.pending_candidate.artifact.open_questions[0].resolved, false, "a fresh candidate question starts unresolved");
const answered = await answerCandidateQuestion(root, base.id, "q1", "Behind a flag");
assert.equal(answered.revision, 1, "answering a candidate question does not bump the draft revision");
assert.equal(answered.pending_candidate.artifact.open_questions[0].resolved, true, "the candidate question is resolved");
assert.equal(answered.pending_candidate.artifact.open_questions[0].answer, "Behind a flag", "the answer is kept on the candidate question");
assert.ok(answered.pending_candidate.artifact.clarifications.some((entry) => entry.question_id === "q1" && entry.answer === "Behind a flag"), "the answer lands in the candidate clarifications");
assert.throws(() => answerCandidateQuestion(root, base.id, "qX", "x"), /not found/, "an unknown candidate question is refused");
assert.throws(() => answerCandidateQuestion(root, base.id, "q1", "  "), /answer is required/, "an empty candidate answer is refused");

// ---------- applying a stale candidate is refused with a reload-and-retry message
assert.throws(() => applyPlanCandidate(root, { ...loadPlanDraft(root, base.id), revision: 99 }, {}), /reload and retry/, "a drifted caller revision is refused by the optimistic draft lock");

// ---------- applying the candidate: revision bumps, review clears, answers survive
// A stale recorded review must die with the apply — the applied plan was never reviewed.
const envelopeWithReview = JSON.parse(fs.readFileSync(path.join(base.dir, "artifact.json"), "utf8"));
envelopeWithReview.review = { verdict: "passed", findings: [], fingerprint: "stale", reviewed_at: new Date().toISOString() };
fs.writeFileSync(path.join(base.dir, "artifact.json"), JSON.stringify(envelopeWithReview, null, 2) + "\n");
const applied = applyPlanCandidate(root, loadPlanDraft(root, base.id), {});
assert.equal(applied.revision, 2, "applying bumps the draft revision");
assert.equal(applied.artifact.task_proposals.length, 2, "the applied plan carries the candidate task list");
assert.equal(applied.artifact.task_proposals[1].source, "model", "applied candidate cards keep their model source label");
assert.equal(applied.pending_candidate ?? null, null, "the candidate is cleared after applying");
assert.equal(applied.review ?? null, null, "applying clears review readiness — the applied plan was never reviewed");
assert.ok(applied.artifact.clarifications.some((entry) => entry.question_id === "q1" && entry.answer === "Behind a flag"), "candidate answers ride into the applied artifact");
assert.ok(applied.artifact.open_questions.every((question) => question.resolved), "answered questions stay resolved after normalization");
assert.ok(!fs.existsSync(path.join(base.dir, "artifact.lock")), "the draft lock is released after applying");

// ---------- double apply is refused
assert.throws(() => applyPlanCandidate(root, base.id, {}), /no pending refinement candidate/, "a second apply without a new candidate is refused");

// ---------- manual edit then stale apply against the live envelope
refineResponses = [() => ({ code: 0, text: JSON.stringify({ summary: "Renamed the plan.", artifact: refinedPlan("Renamed plan") }), provider: "testprov", model: "m-1" })];
await refinePlanDraft(root, base.id, "Rename the plan.", { invoke: fakeInvoke, confirm: true, provider: "testprov", model: "m-1" });
const drifted = JSON.parse(fs.readFileSync(path.join(base.dir, "artifact.json"), "utf8"));
drifted.revision = (Number(drifted.revision) || 1) + 1; // a concurrent manual edit landed before the apply
fs.writeFileSync(path.join(base.dir, "artifact.json"), JSON.stringify(drifted, null, 2) + "\n");
assert.throws(() => applyPlanCandidate(root, loadPlanDraft(root, base.id), {}), /based on rev/, "a candidate based on an older revision refuses to apply after a manual edit");

// ---------- discard keeps the revision and records the decision
const beforeDiscard = loadPlanDraft(root, base.id);
const discarded = discardPlanCandidate(root, base.id);
assert.equal(discarded.revision, beforeDiscard.revision, "discarding does not bump the revision");
assert.equal(discarded.pending_candidate ?? null, null, "discarding clears the candidate");
assert.ok(discarded.conversation.some((entry) => /Discarded the proposed changes/.test(entry.text)), "the discard decision is recorded in the conversation");
assert.throws(() => discardPlanCandidate(root, base.id), /no pending/, "discarding without a candidate is refused");

// ---------- failed and malformed provider calls leave the draft exactly as it was
const beforeFailure = loadPlanDraft(root, base.id);
await assert.rejects(async () => refinePlanDraft(root, base.id, "no confirm", { invoke: fakeInvoke, confirm: false }), /explicit confirmation/, "refinement needs explicit confirmation");
await assert.rejects(async () => refinePlanDraft(root, base.id, "   ", { invoke: fakeInvoke, confirm: true }), /message is required/, "refinement needs a message");
await assert.rejects(async () => refinePlanDraft(root, base.id, "Break the plan", { invoke: async () => ({ code: 1, text: "" }), confirm: true }), /failed \(code 1\)/, "a failed provider call is surfaced");
await assert.rejects(async () => refinePlanDraft(root, base.id, "Break the plan", { invoke: async () => ({ code: 0, text: "not json" }), confirm: true }), /valid JSON/, "a malformed response is refused");
const malformed = await refinePlanDraft(root, base.id, "Break the plan", { invoke: async () => ({ code: 0, text: "not json" }), confirm: true }).catch((error) => error);
assert.ok(malformed.providerResponse === "not json", "the refused response is attached for the review-only preview");
const unmarked = v2Plan("Missing contract markers"); delete unmarked.plan_contract_version;
await assert.rejects(async () => refinePlanDraft(root, base.id, "Break the plan", { invoke: async () => ({ code: 0, text: JSON.stringify(unmarked) }), confirm: true }), /Plan Contract v2/, "a non-v2 refinement is refused");
const afterFailure = loadPlanDraft(root, base.id);
assert.equal(afterFailure.revision, beforeFailure.revision, "a failed refinement leaves the revision alone");
assert.deepEqual(afterFailure.conversation, beforeFailure.conversation, "a failed refinement records no conversation entries");
assert.equal(afterFailure.pending_candidate ?? null, null, "a failed refinement stores no candidate");
assert.equal(afterFailure.artifact.task_proposals.length, beforeFailure.artifact.task_proposals.length, "a failed refinement leaves the saved plan unchanged");

// ---------- a legacy draft (pre-contract artifact) refines into a v2 candidate
const legacyDraft = savePlanDraft(root, { intent: "Legacy draft refinement", artifact: { title: "Legacy plan", objective: "Legacy objective", completion_checks: ["legacy check"], acceptance_examples: [{ given: "g", when: "w", then: "t" }], implementation_steps: [{ step: "Do it", files: [], verify: verifier }], verifier_commands: [verifier] }, stage: "plan" });
refineResponses = [() => ({ code: 0, text: JSON.stringify({ summary: "Rebuilt as a v2 plan.", artifact: refinedPlan("Legacy plan v2") }), provider: "testprov", model: "m-1" })];
const legacyRefined = await refinePlanDraft(root, legacyDraft.id, "Bring this up to the current plan contract.", { invoke: fakeInvoke, confirm: true, provider: "testprov", model: "m-1" });
assert.equal(legacyRefined.conversation.length, 2, "a legacy draft starts with an empty conversation and gains refine entries");
assert.equal(legacyRefined.pending_candidate.artifact.plan_contract_version, 2, "the legacy draft's candidate is a v2 plan");

// ---------- an approved draft is closed to refinement
const approvedEnvelopePath = path.join(legacyRefined.dir, "artifact.json");
const approvedEnvelope = JSON.parse(fs.readFileSync(approvedEnvelopePath, "utf8"));
approvedEnvelope.stage = "approved";
fs.writeFileSync(approvedEnvelopePath, JSON.stringify(approvedEnvelope, null, 2) + "\n");
await assert.rejects(async () => refinePlanDraft(root, legacyRefined.id, "More changes", { invoke: fakeInvoke, confirm: true }), /closed to card edits/, "an approved draft refuses refinement");
assert.throws(() => applyPlanCandidate(root, legacyRefined.id, {}), /closed to card edits/, "an approved draft refuses candidate applies");

// ---------- change detection: changed and removed cards
const currentPlan = v2Plan("Diff base", {
  task_proposals: [
    v2Plan("Diff base").task_proposals[0],
    { ...refinedPlan("Diff base").task_proposals[1], title: "Renamed checks task" },
  ],
});
const diffCandidate = refinedPlan("Diff base");
const changes = candidateChanges(currentPlan, diffCandidate);
assert.deepEqual(changes, [
  { kind: "changed", id: "p2", title: "Add regression checks" },
], "a retitled card is reported as changed, unchanged cards stay silent");
const removals = candidateChanges(currentPlan, v2Plan("Diff base"));
assert.deepEqual(removals, [{ kind: "removed", id: "p2", title: "Renamed checks task" }], "a dropped card is reported as removed");
const noChanges = candidateChanges(currentPlan, JSON.parse(JSON.stringify(currentPlan)));
assert.deepEqual(noChanges, [], "an identical candidate reports no changes");

// ---------- review round-trips through refine without breaking the review gate
const reviewDraft = savePlanDraft(root, { intent: "Review gate draft", artifact: v2Plan("Review gate plan"), stage: "plan" });
const reviewed = reviewPlanArtifact(root, reviewDraft, { verdict: "passed", findings: [], provider: "testprov", model: "m-1" }, {});
assert.equal(reviewed.review.verdict, "passed", "the review gate accepts a clean v2 draft");
refineResponses = [() => ({ code: 0, text: JSON.stringify({ summary: "Proposed a follow-up task.", artifact: refinedPlan("Review gate plan") }), provider: "testprov", model: "m-1" })];
const afterReview = await refinePlanDraft(root, reviewDraft.id, "Add a follow-up task.", { invoke: fakeInvoke, confirm: true, provider: "testprov", model: "m-1" });
assert.equal(afterReview.review?.verdict, "passed", "recording a candidate does not clear the current review");
assert.equal(afterReview.revision, reviewed.revision, "the reviewed revision is untouched by a pending candidate");

console.log("plan_studio_refine_test: all assertions passed");
