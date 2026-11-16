import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizePlanContract, parseModelJsonWithTailRepair, PLAN_CONTRACT_VERSION, repairPlanDraft, savePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { emptyState, saveState } from "../runtime/lib/state.mjs";

// 1) Valid JSON passes through untouched.
assert.equal(parseModelJsonWithTailRepair('{"a":[1,{"b":2}]}').repair, null);

// 2) The live failure class: one dropped closing brace at the final array
//    element while the top-level tail still reads clean (GLM, 14k-char plan).
const brokenPlan = '{"items":[{"id":"p1"},{"id":"p4","resource_estimate":{"complexity":"simple","reason":"bounded"}],"verifier_commands":["node verification/fixture.mjs"]}';
const repaired = parseModelJsonWithTailRepair(brokenPlan);
assert.equal(repaired.repair.insertions, 1);
assert.equal(repaired.repair.tail_closers, 0);
assert.equal(repaired.json.items.length, 2);
assert.deepEqual(repaired.json.verifier_commands, ["node verification/fixture.mjs"]);

// 3) Truncated tail: brackets still open at EOF are appended.
const truncated = parseModelJsonWithTailRepair('{"a":{"b":[1,2');
assert.equal(truncated.repair.tail_closers, 3);
assert.deepEqual(truncated.json.a.b, [1, 2]);

// 4) Real corruption and unterminated strings still fail honestly.
assert.throws(() => parseModelJsonWithTailRepair('{"a":}]'), /JSON|position|Expected|Unexpected/i);
assert.throws(() => parseModelJsonWithTailRepair('{"a": "unterminated'), /JSON|position|Expected|Unexpected/i);

// 5) normalizePlanContract coerces the common quoted contract version.
const coerced = normalizePlanContract({ plan_contract_version: "2", objective: "x" });
assert.equal(coerced.plan_contract_version, PLAN_CONTRACT_VERSION);

// 6) End to end: repairPlanDraft accepts a quarantined response that dropped
//    one brace and quoted the contract version — the exact live pair.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-tail-repair-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());
fs.writeFileSync(path.join(root, "evidence.txt"), "planning evidence\n");
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "plan_json_tail_repair_test.mjs"), "// verifier fixture\n");
const intent = "Plan a messy external request";
const artifact = {
  plan_contract_version: "2", // quoted on purpose: the coercion gate under test
  title: "Tail repair recovery", objective: intent,
  requirements: [{ id: "r1", text: "Require recovery from a dropped brace", source: "original request" }],
  constraints: [], observed_evidence: [{ description: "Project planning evidence", path: "evidence.txt" }], assumptions: [], open_questions: [], risks: [],
  completion_checks: ["A dropped brace no longer quarantines the plan"],
  acceptance_examples: [{ given: "a response missing one closing brace", when: "the repair editor validates it", then: "the plan is accepted with its task cards" }],
  selected_skills: ["atl-implement"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [{ step: "Recover the plan from the dropped brace", files: [], verify: "node verification/plan_json_tail_repair_test.mjs" }],
  verifier_commands: ["node verification/plan_json_tail_repair_test.mjs"],
  task_proposals: [{ id: "p1", title: "Recover the plan", objective: intent, instructions: "Insert the structurally forced closing brace and re-validate every plan gate before the cards unlock.", deliverables: ["recovered plan draft"], completion_checks: ["the recovered draft validates"], proposed_worker: "pip", selected_skills: ["atl-implement"], skill_reasons: { "atl-implement": "Owns bounded recovery work." }, requirement_ids: ["r1"], depends_on: [], files: [], verify: "node verification/plan_json_tail_repair_test.mjs" }],
};
const validText = JSON.stringify(artifact);
// Drop the last proposal's closing brace exactly like the live GLM failure.
const broken = validText.slice(0, validText.length - 3) + validText.slice(validText.length - 2);
assert.throws(() => JSON.parse(broken), /JSON|position|Expected|Unexpected/i);
savePlanDraft(root, { intent, artifact: null, stage: "repair", id: "tail-repair-fixture" });
const recovered = repairPlanDraft(root, "tail-repair-fixture", broken);
assert.equal(recovered.stage, "plan");
assert.equal(recovered.artifact.task_proposals.length, 1);
assert.equal(recovered.artifact.plan_contract_version, PLAN_CONTRACT_VERSION);
console.log("Plan JSON tail repair: dropped-brace, truncated-tail, corruption, version coercion, and repair-draft recovery all passed.");
