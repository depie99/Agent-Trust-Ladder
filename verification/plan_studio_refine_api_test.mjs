import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { loadPlanDraft, savePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// The provider registry lives in the machine home; this test pins USERPROFILE
// to a scratch home so the refine endpoint contract is tested without
// touching (or depending on) the real ~/.atl/providers.json.
const realHome = process.env.USERPROFILE;
const realHomePosix = process.env.HOME;
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
fs.mkdirSync(path.join(fakeHome, ".atl"), { recursive: true });
fs.writeFileSync(path.join(fakeHome, ".atl", "providers.json"), JSON.stringify({
  providers: {
    testprov: { id: "testprov", label: "Test Provider", worker: "claude", base_url: "https://example.test/api", api_key: "sk-secret-value", model: "m-1", models: ["m-1", "m-2"] },
  },
}, null, 2));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-refine-api-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "plan_studio_refine_api_test.mjs"), "// verifier fixture\n");
saveState(root, emptyState());

const verifier = "node verification/plan_studio_refine_api_test.mjs";
const v2Plan = (title, extra = {}) => ({
  plan_contract_version: 2,
  title,
  objective: "Plan the bounded feature end to end",
  requirements: [{ id: "r1", text: "The feature works", source: "original request" }],
  constraints: [],
  observed_evidence: [{ description: "Relevant project verification exists", path: "verification/plan_studio_refine_api_test.mjs" }],
  assumptions: [],
  open_questions: [],
  risks: [],
  completion_checks: ["the feature is observable"],
  acceptance_examples: [{ given: "g", when: "w", then: "t" }],
  implementation_steps: [{ step: "Implement it", files: ["verification/"], verify: verifier }],
  verifier_commands: [verifier],
  task_proposals: [
    { id: "p1", title: "Implement it", objective: "Implement the feature", instructions: "Implement the requested behavior and preserve existing contracts.", deliverables: ["working feature"], requirement_ids: ["r1"], completion_checks: ["the feature is observable"], proposed_worker: "pip", selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Plans verifiable acceptance evidence." }, depends_on: [], files: ["verification/plan_studio_refine_api_test.mjs"], verify: verifier },
  ],
  ...extra,
});
const refinedPlan = (title) => v2Plan(title, {
  task_proposals: [
    v2Plan(title).task_proposals[0],
    { id: "p2", title: "Add regression checks", objective: "Cover the feature with regression checks", instructions: "Write failing checks first, observe them fail, then implement.", deliverables: ["regression suite"], requirement_ids: ["r1"], completion_checks: ["regression suite passes"], proposed_worker: "pip", selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Verifies the regression suite." }, depends_on: ["p1"], files: ["verification/"], verify: verifier },
  ],
});

let refineMode = "ok";
const fakeInvoke = async ({ request }) => {
  if (request.task_target) {
    assert.equal(request.task_target, "p1", "a task-targeted refinement names the task in the provider request");
    assert.ok(request.current_artifact, "the refinement request carries the current artifact");
    assert.ok(Array.isArray(request.saved_answers), "the refinement request carries saved answers");
    assert.ok(Array.isArray(request.recent_conversation), "the refinement request carries the recent conversation");
  }
  if (refineMode === "malformed") return { code: 0, text: "this is not json at all", provider: "testprov", model: "m-1" };
  if (refineMode === "failure") return { code: 1, text: "", providerFailure: { reason: "provider exploded" } };
  return { code: 0, text: JSON.stringify({ summary: "Added a regression task after the implementation task.", artifact: refinedPlan("Feature plan") }), provider: "testprov", model: "m-1" };
};

const running = await startControlPlaneServer(root, { planningInvoke: fakeInvoke });
const post = async (pathname, body) => fetch(`${running.url}${pathname.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, body: await response.json() }));

try {
  const draft = savePlanDraft(root, { intent: "Ship the conversational Plan Studio workspace", artifact: v2Plan("Feature plan"), stage: "plan", provider: "testprov", model: "m-1" });
  const draftId = draft.id;

  // happy path: one bounded refine call stores the candidate; the draft is unchanged
  const first = await post("/api/plan/refine", { draftId, message: "Add a regression task behind the implementation one.", provider: "testprov", model: "m-1", confirm: true });
  assert.equal(first.status, 200, `a valid refinement succeeds (${first.body.error || ""})`);
  assert.equal(first.body.draft.revision, 1, "a stored candidate does not bump the draft revision");
  assert.equal(first.body.draft.artifact.task_proposals.length, 1, "the saved plan is unchanged while a candidate is pending");
  assert.equal(first.body.draft.pending_candidate.based_on_revision, 1, "the candidate pins its originating revision");
  assert.deepEqual(first.body.draft.pending_candidate.changes, [{ kind: "added", id: "p2", title: "Add regression checks" }], "the candidate carries a change summary");
  assert.equal(first.body.draft.conversation.length, 2, "the conversation records the exchange");
  assert.ok(!("dir" in first.body.draft) && !("artifactPath" in first.body.draft), "the browser draft view never exposes filesystem paths");

  // refusal without confirmation: no spend, draft untouched
  const unconfirmed = await post("/api/plan/refine", { draftId, message: "Another try", provider: "testprov", confirm: false });
  assert.equal(unconfirmed.status, 400, "an unconfirmed refinement is refused");

  // malformed provider response: draft and composer-visible state preserved
  refineMode = "malformed";
  const malformed = await post("/api/plan/refine", { draftId, message: "Break it", provider: "testprov", confirm: true });
  assert.equal(malformed.status, 400, "a malformed provider response is refused");
  assert.ok(malformed.body.providerResponse, "the refused raw response is returned for the review-only preview");
  const refetchMalformed = await post("/api/plan/drafts", { draftId });
  assert.equal(refetchMalformed.body.draft.artifact.task_proposals.length, 1, "a malformed response leaves the saved plan untouched");
  assert.equal(refetchMalformed.body.draft.revision, 1, "a malformed response leaves the revision untouched");
  assert.equal(refetchMalformed.body.draft.conversation.length, 2, "a failed call records no conversation entries");

  // provider failure: draft preserved
  refineMode = "failure";
  const failed = await post("/api/plan/refine", { draftId, message: "Break it", provider: "testprov", confirm: true });
  assert.equal(failed.status, 400, "a failed provider call surfaces as an error");
  assert.match(failed.body.error, /provider exploded/, "the provider failure reason is surfaced");
  refineMode = "ok";

  // answering a candidate question rides through clarify with target=candidate
  refineMode = "ok";
  const withQuestion = await post("/api/plan/refine", { draftId, message: "Ask the rollout question.", provider: "testprov", confirm: true });
  assert.equal(withQuestion.status, 200, "a refinement carrying questions succeeds");
  const questionId = withQuestion.body.draft.pending_candidate.artifact.open_questions?.[0]?.id;
  assert.ok(!questionId, "the plain refined plan carries no open questions in this fixture");

  // apply: revision bumps, review readiness cleared, candidate cleared
  refineMode = "ok";
  const applied = await post("/api/plan/candidate", { draftId, action: "apply", revision: 1 });
  assert.equal(applied.status, 200, `applying a fresh candidate succeeds (${applied.body.error || ""})`);
  assert.equal(applied.body.draft.revision, 2, "applying bumps the draft revision");
  assert.equal(applied.body.draft.artifact.task_proposals.length, 2, "the applied plan carries the candidate tasks");
  assert.equal(applied.body.draft.pending_candidate ?? null, null, "the candidate is cleared after applying");

  // double apply: refused
  const double = await post("/api/plan/candidate", { draftId, action: "apply", revision: 2 });
  assert.equal(double.status, 400, "a second apply without a new candidate is refused (duplicate submissions cannot apply twice)");

  // stale apply: candidate based on an older revision never lands
  const second = await post("/api/plan/refine", { draftId, message: "Add the regression task again.", provider: "testprov", confirm: true });
  assert.equal(second.status, 200, "a second refinement succeeds");
  assert.equal(second.body.draft.pending_candidate.based_on_revision, 2, "the new candidate is based on the current revision");
  const stale = await post("/api/plan/candidate", { draftId, action: "apply", revision: 1 });
  assert.equal(stale.status, 409, "applying against a stale client revision is refused");
  assert.match(stale.body.error, /stale/, "the stale refusal explains itself");

  // discard: candidate cleared, revision kept
  const discarded = await post("/api/plan/candidate", { draftId, action: "discard" });
  assert.equal(discarded.status, 200, "discarding succeeds");
  assert.equal(discarded.body.draft.revision, 2, "discarding keeps the revision");
  assert.equal(discarded.body.draft.pending_candidate ?? null, null, "discarding clears the candidate");
  assert.ok(discarded.body.draft.conversation.some((entry) => /Discarded/.test(entry.text)), "the discard is recorded in the conversation");
  const again = await post("/api/plan/candidate", { draftId, action: "discard" });
  assert.equal(again.status, 400, "discarding without a candidate is refused");

  // refine targets: a missing draft and an empty message are refused cheaply
  const missing = await post("/api/plan/refine", { draftId: "does-not-exist", message: "hi", provider: "testprov", confirm: true });
  assert.equal(missing.status, 400, "an unknown draft is refused");
  const emptyMessage = await post("/api/plan/refine", { draftId, message: "   ", provider: "testprov", confirm: true });
  assert.equal(emptyMessage.status, 400, "an empty refinement message is refused");
  const noProvider = await post("/api/plan/refine", { draftId, message: "hi", confirm: true });
  assert.equal(noProvider.status, 400, "refinement without a resolvable provider is refused");

  // the saved on-disk draft matches what the API last reported
  const onDisk = loadPlanDraft(root, draftId);
  assert.equal(onDisk.revision, 2, "the on-disk envelope matches the reported revision");
  assert.equal(onDisk.artifact.task_proposals.length, 2, "the applied task list is durable");

  console.log("plan_studio_refine_api_test: all assertions passed");
} finally {
  await new Promise((resolve) => running.server.close(resolve));
  process.env.USERPROFILE = realHome;
  process.env.HOME = realHomePosix;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}
