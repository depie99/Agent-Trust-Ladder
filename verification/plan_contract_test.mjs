import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask, emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { buildLaunchPlan } from "../runtime/lib/launch.mjs";
import { approvePlanDraft, editProposal, reviewPlanArtifact, savePlanDraft, validatePlanArtifact } from "../runtime/lib/plan-studio.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-contract-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());
fs.writeFileSync(path.join(root, "evidence.txt"), "original planning evidence\n");
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "plan_contract_test.mjs"), "// verifier fixture\n");
const intent = "Add a reviewed task plan";
const artifact = {
  plan_contract_version: 2, title: "Reviewed planning", objective: intent,
  requirements: [{ id: "r1", text: "Require a separate accuracy review", source: "original request" }],
  constraints: [], observed_evidence: [{ description: "Project planning evidence", path: "evidence.txt" }], assumptions: [], open_questions: [], risks: [],
  completion_checks: ["Review gate is enforced"], acceptance_examples: [{ given: "a generated plan", when: "approval is attempted", then: "review must have passed" }],
  selected_skills: ["atl-verify"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [{ step: "Add a plan review gate", files: ["evidence.txt"], verify: "node verification/plan_contract_test.mjs" }], verifier_commands: ["node verification/plan_contract_test.mjs"],
  task_proposals: [{ id: "p1", title: "Add the review gate", objective: intent, instructions: "Require a fresh review before creating tasks.", deliverables: ["backend approval gate"], completion_checks: ["approval refuses missing review"], proposed_worker: "pip", selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Owns evidence-based verification gates." }, requirement_ids: ["r1"], depends_on: [], files: ["evidence.txt"], verify: "node verification/plan_contract_test.mjs" }],
};
assert.equal(validatePlanArtifact(artifact), true);
const draft = savePlanDraft(root, { intent, artifact, stage: "plan" });
assert.throws(() => approvePlanDraft(root, draft.id), /fresh, passing accuracy review/);
assert.equal(reviewPlanArtifact(root, draft.id, { verdict: "passed", findings: [] }).review.verdict, "passed");
assert.equal(approvePlanDraft(root, draft.id).created, true);
const editable = savePlanDraft(root, { intent, artifact, stage: "plan" });
reviewPlanArtifact(root, editable.id, { verdict: "passed", findings: [] });
editProposal(root, editable.id, "p1", { title: "Changed after review" });
assert.throws(() => approvePlanDraft(root, editable.id), /fresh, passing accuracy review/);
const uncertain = savePlanDraft(root, { intent, artifact: { ...artifact, open_questions: [{ id: "q1", question: "Which scope?" }] }, stage: "plan" });
assert.equal(reviewPlanArtifact(root, uncertain.id, { verdict: "passed", findings: [] }).review.verdict, "blocked");
const state = loadState(root);
const imported = createTask(state, { title: "Imported issue", source: { type: "github", url: "https://github.com/acme/repo/issues/8", remote_id: 8, revision: "rev-1" }, intake_key: "github:8", plan_review_required: true });
saveState(root, state, { expectedRevision: state.revision || 0 });
assert.ok(buildLaunchPlan(root, { taskIds: [imported.id] }).items[0].blockers.some((item) => /Plan Studio accuracy review/.test(item)), "an imported task is blocked from execution before Plan Studio review");
const sourceDraft = savePlanDraft(root, { intent, artifact, stage: "plan", sourceTaskId: imported.id });
reviewPlanArtifact(root, sourceDraft.id, { verdict: "passed", findings: [], source_revision: { current: true, type: "github", remote_id: "8", revision: "rev-1" } });
approvePlanDraft(root, sourceDraft.id, { sourceRevisionCurrent: true });
assert.equal(loadState(root).tasks[imported.id].plan_review_required, false, "reviewed plan approval clears the imported-task execution gate");
const evidenceDraft = savePlanDraft(root, { intent, artifact, stage: "plan" });
reviewPlanArtifact(root, evidenceDraft.id, { verdict: "passed", findings: [] });
fs.appendFileSync(path.join(root, "evidence.txt"), "changed after review\n");
assert.throws(() => approvePlanDraft(root, evidenceDraft.id), /fresh, passing accuracy review/, "evidence changes invalidate the review");
console.log("Plan Contract v2 review and approval gates passed.");
