import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { savePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { readRunLock } from "../runtime/lib/launch.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// The overnight-run gate refuses planning provider calls while a queue run is
// active. planning.concurrentWithQueueRun=true in manager settings is the
// owner's escape hatch: reviews then share the provider with the active run
// (quota contention accepted) instead of waiting for the run to finish.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-run-gate-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-run-gate-home-"));
process.env.ATL_HOME = home;
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());
fs.writeFileSync(path.join(root, "evidence.txt"), "planning evidence\n");
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "plan_review_run_gate_test.mjs"), "// verifier fixture\n");
fs.writeFileSync(path.join(home, "providers.json"), JSON.stringify({ version: 1, providers: { test: { id: "test", base_url: "https://test.local/v1", api_key: "sk-test", worker: "codex", protocol: "custom" } } }) + "\n");

const intent = "Plan while a queue run is active";
const artifact = {
  plan_contract_version: 2, title: "Run gate review", objective: intent,
  requirements: [{ id: "r1", text: "Require reviews to be reachable during runs when the owner allows it", source: "original request" }],
  constraints: [], observed_evidence: [{ description: "Project planning evidence", path: "evidence.txt" }], assumptions: [], open_questions: [], risks: [],
  completion_checks: ["The owner-configured concurrency knob unlocks reviews during runs"],
  acceptance_examples: [{ given: "an active queue run", when: "a review is requested with the knob enabled", then: "the review runs instead of refusing with the run-gate error" }],
  selected_skills: ["atl-implement"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [{ step: "Review the run gate knob behavior", files: [], verify: "node verification/plan_review_run_gate_test.mjs" }],
  verifier_commands: ["node verification/plan_review_run_gate_test.mjs"],
  task_proposals: [{ id: "p1", title: "Verify the run gate knob", objective: intent, instructions: "Request a plan review against an active run lock with the knob disabled, then enabled, and assert the gate honors the owner setting.", deliverables: ["run gate regression coverage"], completion_checks: ["gate refuses with knob disabled and runs with it enabled"], proposed_worker: "pip", selected_skills: ["atl-implement"], skill_reasons: { "atl-implement": "Owns bounded verification work." }, requirement_ids: ["r1"], depends_on: [], files: [], verify: "node verification/plan_review_run_gate_test.mjs" }],
};
const draft = savePlanDraft(root, { intent, artifact, stage: "plan", id: "run-gate-fixture" });

// An active queue run: a live pid in the run lock (this process).
fs.writeFileSync(path.join(root, ".trust", "manager", "run-lock.json"), JSON.stringify({ runId: "R-test", queueId: "q", pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
assert.ok(readRunLock(root)?.pid, "run lock fixture is active");

const planningInvoke = async () => ({ code: 0, text: JSON.stringify({ verdict: "passed", findings: [] }), provider: "test", model: "test-model" });
const server = await startControlPlaneServer(root, { planningInvoke });
const origin = server.url.endsWith("/") ? server.url.slice(0, -1) : server.url;
const review = () => fetch(origin + "/api/plan/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draft.id, provider: "test" }) });

const configPath = path.join(root, "config", "manager.json");
fs.mkdirSync(path.dirname(configPath), { recursive: true });

// 1) Knob absent (default): the run gate refuses the review.
fs.writeFileSync(configPath, JSON.stringify({}) + "\n");
let refused = await review();
assert.equal(refused.status, 409);
assert.match((await refused.json()).error, /overnight queue run is active/);

// 2) Knob enabled: the review runs and passes while the run lock stays active.
fs.writeFileSync(configPath, JSON.stringify({ planning: { concurrentWithQueueRun: true } }) + "\n");
const allowed = await review();
const body = await allowed.json();
assert.equal(allowed.status, 200, `review should run: ${JSON.stringify(body)}`);
assert.equal(body.review.verdict, "passed");
assert.ok(readRunLock(root)?.pid, "run lock still active after the concurrent review");

server.server.close();
console.log("Plan review run gate: default refusal and planning.concurrentWithQueueRun override both verified.");
