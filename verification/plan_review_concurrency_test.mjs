import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { loadPlanDraft, savePlanDraft, approvePlanDraft, editProposal, reviewPlanArtifact } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { buildLaunchPlan } from "../runtime/lib/launch.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-review-races-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-review-home-"));
const priorHome = process.env.USERPROFILE;
process.env.USERPROFILE = home;
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.mkdirSync(path.join(home, ".atl"), { recursive: true });
fs.writeFileSync(path.join(home, ".atl", "providers.json"), JSON.stringify({ providers: { test: { id: "test", label: "Test", worker: "claude", base_url: "https://example.test", api_key: "fixture", model: "fixture" } } }));
fs.writeFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence v1\n");
saveState(root, emptyState());

const artifact = {
  plan_contract_version: 2,
  title: "Review race fixture",
  objective: "Preserve plan edits while reviewing",
  requirements: [{ id: "r1", text: "Reviews bind to exact inputs", source: "original request" }],
  constraints: [],
  observed_evidence: [{ description: "Fixture verifier", path: "verification/fixture.mjs" }],
  assumptions: [], open_questions: [], risks: [], completion_checks: ["Review uses exact inputs"],
  acceptance_examples: [{ given: "a pending review", when: "inputs change", then: "the old result is stale" }],
  selected_skills: ["atl-verify"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [{ step: "Verify race handling", files: ["verification/fixture.mjs"], verify: "node verification/fixture.mjs" }],
  verifier_commands: ["node verification/fixture.mjs"],
  task_proposals: [{ id: "p1", title: "Verify race handling", objective: "Preserve plan edits while reviewing", instructions: "Check plan snapshot consistency through deterministic delayed provider responses and preserve existing behavior.", deliverables: ["race regression coverage"], requirement_ids: ["r1"], completion_checks: ["Review uses exact inputs"], proposed_worker: "pip", selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Verifies the review invariants." }, depends_on: [], files: ["verification/fixture.mjs"], verify: "node verification/fixture.mjs" }],
};

const pending = [];
const planningInvoke = ({ request }) => new Promise((resolve) => pending.push({ request, resolve }));
const server = await startControlPlaneServer(root, { planningInvoke });
const post = async (route, body) => {
  const response = await fetch(`${server.url}${route.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const waitFor = async (count, request) => {
  for (let i = 0; i < 200 && pending.length < count; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  if (pending.length !== count) throw new Error(`review provider did not reach barrier: ${JSON.stringify(await request)}`);
};
const finish = (call, verdict = "passed") => call.resolve({ code: 0, provider: "test", model: "fixture", text: JSON.stringify({ verdict, findings: [] }) });

try {
  // R01: an edit wins; the response based on an earlier revision is stale.
  const editedDraft = savePlanDraft(root, { intent: artifact.objective, artifact });
  const reviewWait = post("/api/plan/review", { draftId: editedDraft.id, provider: "test" });
  await waitFor(1, reviewWait);
  const edited = await post("/api/plan/card", { draftId: editedDraft.id, action: "edit", proposalId: "p1", patch: { title: "Edited during review" } });
  assert.equal(edited.status, 200);
  finish(pending.shift());
  const staleReview = await reviewWait;
  assert.equal(staleReview.status, 409, "stale review cannot commit");
  assert.equal(loadPlanDraft(root, editedDraft.id).artifact.task_proposals[0].title, "Edited during review", "concurrent edit is preserved");
  assert.equal(loadPlanDraft(root, editedDraft.id).review, undefined, "stale review is not attached");

  // R05: a failed atomic rename preserves the last complete envelope.
  const atomicDraft = savePlanDraft(root, { intent: artifact.objective, artifact });
  const artifactFile = path.join(atomicDraft.dir, "artifact.json");
  const beforeFailedCommit = fs.readFileSync(artifactFile, "utf8");
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error("injected rename interruption"); };
    assert.throws(() => reviewPlanArtifact(root, atomicDraft.id, { verdict: "passed", findings: [] }), /injected rename interruption/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(artifactFile, "utf8"), beforeFailedCommit, "interrupted commit leaves prior artifact intact");
  assert.equal(fs.existsSync(path.join(atomicDraft.dir, "artifact.lock")), false, "the commit lock is released after write failure");
  assert.equal(fs.readdirSync(atomicDraft.dir).some((name) => name.endsWith(".tmp")), false, "partial temporary artifact is removed");

  // An abandoned lock from a dead runtime is recoverable on the next edit.
  fs.writeFileSync(path.join(atomicDraft.dir, "artifact.lock"), JSON.stringify({ pid: 2147483647, created_at: "2026-11-03T00:00:00.000Z" }));
  assert.equal(editProposal(root, atomicDraft.id, "p1", { title: "After restart" }).artifact.task_proposals[0].title, "After restart");

  // R06: if a runtime disappears before review commit, the persisted draft has no passing review.
  const interruptedDraft = savePlanDraft(root, { intent: artifact.objective, artifact });
  const interruptedReview = post("/api/plan/review", { draftId: interruptedDraft.id, provider: "test" });
  await waitFor(1, interruptedReview);
  assert.throws(() => approvePlanDraft(root, interruptedDraft.id), /fresh, passing accuracy review/, "an uncommitted review cannot authorize approval after restart");
  pending.shift().resolve({ code: 124, timedOut: true, text: "" });
  assert.equal((await interruptedReview).status, 400);
  assert.equal(loadPlanDraft(root, interruptedDraft.id).review, undefined);

  // R02: evidence sent to the provider is snapshotted and checked again at commit.
  const evidenceDraft = savePlanDraft(root, { intent: artifact.objective, artifact });
  const evidenceWait = post("/api/plan/review", { draftId: evidenceDraft.id, provider: "test" });
  await waitFor(1, evidenceWait);
  const providerEvidence = pending[0].request.project_evidence.referenced_file_fingerprints.find((item) => item.path === "verification/fixture.mjs");
  assert.ok(providerEvidence.sha256);
  fs.writeFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence v2\n");
  finish(pending.shift());
  const staleEvidence = await evidenceWait;
  assert.equal(staleEvidence.status, 409, "changed evidence invalidates the review");
  assert.equal(loadPlanDraft(root, evidenceDraft.id).review, undefined);
  assert.throws(() => approvePlanDraft(root, evidenceDraft.id), /fresh, passing accuracy review/);

  // R03: only one provider review may be active per draft.
  const oneDraft = savePlanDraft(root, { intent: artifact.objective, artifact });
  const first = post("/api/plan/review", { draftId: oneDraft.id, provider: "test" });
  await waitFor(1, first);
  const duplicate = await post("/api/plan/review", { draftId: oneDraft.id, provider: "test" });
  assert.equal(duplicate.status, 409, "a duplicate concurrent review is refused before another provider call");
  assert.equal(pending.length, 1);
  finish(pending.shift());
  assert.equal((await first).status, 200);

  // R04: concurrent approval requests produce one queue/task set.
  const approvalDraft = savePlanDraft(root, { intent: artifact.objective, artifact });
  const approvalReview = post("/api/plan/review", { draftId: approvalDraft.id, provider: "test" });
  await waitFor(1, approvalReview);
  finish(pending.shift());
  assert.equal((await approvalReview).status, 200);
  const approvals = await Promise.all([
    post("/api/plan/approve", { draftId: approvalDraft.id }),
    post("/api/plan/approve", { draftId: approvalDraft.id }),
  ]);
  assert.deepEqual(approvals.map((result) => result.status), [200, 200]);
  assert.deepEqual(approvals.map((result) => result.body.approved.created).sort(), [false, true]);
  assert.equal(approvals[0].body.approved.queueId, approvals[1].body.approved.queueId);
  assert.equal(Object.values(loadState(root).tasks).filter((task) => task.plan_draft_id === approvalDraft.id).length, 1);
  fs.appendFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence changed after approval\n");
  const launch = buildLaunchPlan(root, { taskIds: approvals[0].body.approved.taskIds });
  assert.ok(launch.items[0].blockers.some((item) => /approved Plan Studio plan or its referenced evidence changed/.test(item)), "launch preview blocks inputs changed since approval");
  console.log("PASS: review races, atomic recovery, interrupted-review fail-closed, concurrent approval, and launch snapshot binding");
} finally {
  await new Promise((resolve) => server.server.close(resolve));
  if (priorHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = priorHome;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
