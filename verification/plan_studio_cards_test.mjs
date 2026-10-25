import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import {
  addProposal, addProposalFeedback, approvePlanDraft, editProposal, generateLocalPlan,
  loadPlanDraft, normalizeProposals, planDraftLabel, regenerateProposal,
  removeProposal, reorderProposals, runPlanProvider, savePlanDraft, validatePlanArtifact,
} from "../runtime/lib/plan-studio.mjs";
import { providerChoices, requireReadyProvider } from "../runtime/lib/userProviders.mjs";
import { executeLaunchQueue, mergeQueues, multiQueueDryRun, readRunLock } from "../runtime/lib/launch.mjs";
import { loadQueueBook, queueAdd, queueCreate, queuePause, queueResume } from "../runtime/lib/queue.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-cards-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());

const minimalArtifact = (title, steps) => ({
  title,
  objective: title,
  completion_checks: ["the bounded outcome is observable"],
  acceptance_examples: [{ given: "g", when: "w", then: "t" }],
  implementation_steps: steps,
  verifier_commands: [steps[0].verify],
});

// ---------- local generation is labelled deterministic and emits typed cards
const localPlan = generateLocalPlan("Ship the editable Plan Studio with model planning");
assert.equal(validatePlanArtifact(localPlan), true, "local plan with typed proposals validates");
assert.equal(localPlan.generated_via, "local", "local generation is labelled as local");
assert.equal(localPlan.task_proposals.length, 4, "local generation emits one typed card per TDD stage");
const ids = localPlan.task_proposals.map((proposal) => proposal.id);
assert.equal(new Set(ids).size, ids.length, "proposal ids are unique and draft-local");
const localDraft = savePlanDraft(root, { intent: localPlan.objective, artifact: localPlan, stage: "plan" });
const localLabel = planDraftLabel(loadPlanDraft(root, localDraft.id));
assert.equal(localLabel.mode, "local", "a draft without provider metadata labels as local");
assert.match(localLabel.label, /deterministic/i, "the local label says deterministic — never model output");
assert.ok(loadPlanDraft(root, localDraft.id).artifact.task_proposals.every((proposal) => proposal.completion_checks.length >= 1), "every card carries observable completion checks");
const baseline = normalizeProposals(localPlan);
assert.ok(baseline.every((proposal) => proposal.defaults.proposed_worker === proposal.proposed_worker && sameDefaults(proposal)), "first normalization records the generated plan's worker/skills as the default baseline");
function sameDefaults(proposal) {
  return JSON.stringify([...proposal.defaults.selected_skills].sort()) === JSON.stringify([...proposal.selected_skills].sort());
}

// ---------- card ops: edit, reorder, add, remove — validated, revisioned
const edited = editProposal(root, localDraft.id, "p2", {
  title: "Regression checks first",
  checks: "Focused test fails before implementation\nFocused test passes after",
  worker: "rowan",
  skills: "atl-verify, atl-implement",
});
const p2 = edited.artifact.task_proposals.find((proposal) => proposal.id === "p2");
assert.equal(p2.title, "Regression checks first", "card edit persists the title");
assert.deepEqual(p2.completion_checks, ["Focused test fails before implementation", "Focused test passes after"], "checks parse one-per-line");
assert.equal(p2.proposed_worker, "rowan", "worker edit persists");
assert.equal(p2.revision, 2, "an edit bumps the card revision");
assert.equal(p2.source, "manager-edit", "an edit records the manager as the source");
assert.equal(p2.revisions.length, 1, "the prior card version is kept in revision history");
assert.equal(p2.revisions[0].proposal.title, "Write failing regression checks", "the revision history holds the pre-edit card");
const p2Stored = loadPlanDraft(root, localDraft.id).artifact.task_proposals.find((proposal) => proposal.id === "p2");
assert.equal(p2Stored.defaults.proposed_worker, "pip", "a manager worker edit never re-baselines the generated default");
assert.deepEqual(p2Stored.defaults.selected_skills, ["atl-verify"], "a manager skills edit never re-baselines the generated default");
assert.throws(() => editProposal(root, localDraft.id, "p2", { title: "" }), /must not be empty/, "an empty title edit is refused");
assert.throws(() => editProposal(root, localDraft.id, "p2", { depends_on: "p99" }), /unknown proposal/, "dependencies must reference existing cards");
assert.throws(() => editProposal(root, localDraft.id, "pX", { title: "x" }), /not found/, "editing an unknown card is refused");
assert.equal(loadPlanDraft(root, localDraft.id).artifact.task_proposals.find((proposal) => proposal.id === "p2").depends_on.join(","), "p1", "a rejected edit leaves the stored card unchanged");

const reordered = reorderProposals(root, localDraft.id, "p2", 0);
assert.equal(reordered.artifact.task_proposals[0].id, "p2", "reorder moves the card to the requested position");
const added = addProposal(root, localDraft.id, { title: "Rollout note", checks: "Rollout documented" });
assert.equal(added.artifact.task_proposals.at(-1).id, "p5", "a new card gets the next draft-local id");
const removed = removeProposal(root, localDraft.id, "p1");
assert.equal(removed.artifact.task_proposals.some((proposal) => proposal.id === "p1"), false, "remove drops the card");
assert.deepEqual(removed.artifact.task_proposals.find((proposal) => proposal.id === "p2").depends_on, [], "dangling dependencies are cleaned after removal");
assert.throws(() => removeProposal(root, localDraft.id, "pX"), /not found/, "removing an unknown card is refused");
const tiny = savePlanDraft(root, { intent: "tiny", artifact: minimalArtifact("Tiny plan", [{ step: "Only step", files: ["a"], verify: "check-a" }]), stage: "plan" });
assert.throws(() => removeProposal(root, tiny.id, "p1"), /at least one task card/, "the last remaining card cannot be removed");

// ---------- feedback + one-card regeneration
const fedBack = addProposalFeedback(root, localDraft.id, "p3", "Keep the slice inside the runtime module only");
assert.equal(fedBack.artifact.task_proposals.find((proposal) => proposal.id === "p3").feedback.length, 1, "manager feedback is recorded on the card");
await assert.rejects(() => regenerateProposal(root, localDraft.id, "p3", { invoke: async () => ({ code: 0, text: "{}" }) }), /explicit confirmation/, "regeneration needs explicit confirmation");

const beforeRegen = loadPlanDraft(root, localDraft.id);
const regenerating = beforeRegen.artifact.task_proposals.find((proposal) => proposal.id === "p3");
const siblingTitle = beforeRegen.artifact.task_proposals.find((proposal) => proposal.id !== "p3").title;
const regened = await regenerateProposal(root, localDraft.id, "p3", {
  confirm: true,
  invoke: async () => ({
    code: 0,
    text: JSON.stringify({ title: "Focused vertical slice", objective: "Implement only the runtime module slice", completion_checks: ["Slice tests pass"], proposed_worker: "sage", selected_skills: ["atl-implement", "atl-verify"], files: ["runtime/lib/"], verify: "node verification/plan_studio_cards_test.mjs" }),
    provider: "zai", model: "glm-4.6",
  }),
});
const regenedCard = regened.artifact.task_proposals.find((proposal) => proposal.id === "p3");
assert.equal(regenedCard.title, "Focused vertical slice", "regeneration replaces the selected card");
assert.equal(regenedCard.source, "model", "a regenerated card is labelled model");
assert.equal(regenedCard.proposed_worker, "sage", "regeneration applies the model's worker choice");
assert.equal(regenedCard.defaults.proposed_worker, "sage", "regeneration re-baselines the default worker to the new model output");
assert.deepEqual(regenedCard.defaults.selected_skills, ["atl-implement", "atl-verify"], "regeneration re-baselines the default skills");
assert.equal(regenedCard.revision, regenerating.revision + 1, "regeneration bumps the revision");
assert.ok(regenedCard.revisions.some((entry) => entry.proposal.title === regenerating.title), "the pre-regeneration card is kept in history");
assert.deepEqual(regened.artifact.task_proposals.filter((proposal) => proposal.id !== "p3").map((proposal) => proposal.title), beforeRegen.artifact.task_proposals.filter((proposal) => proposal.id !== "p3").map((proposal) => proposal.title), "regeneration touches only the selected card");
await assert.rejects(
  () => regenerateProposal(root, localDraft.id, "p3", { confirm: true, invoke: async () => ({ code: 1, text: "" }) }),
  /Plan provider failed/,
  "a failed provider call is surfaced",
);
assert.equal(loadPlanDraft(root, localDraft.id).artifact.task_proposals.find((proposal) => proposal.id === "p3").title, "Focused vertical slice", "a failed regeneration preserves the last valid card");
await assert.rejects(
  () => regenerateProposal(root, localDraft.id, "p3", { confirm: true, invoke: async () => ({ code: 0, text: "not json at all" }) }),
  /valid JSON/,
  "malformed model output is refused",
);
assert.equal(loadPlanDraft(root, localDraft.id).artifact.task_proposals.find((proposal) => proposal.id === "p3").title, "Focused vertical slice", "malformed output leaves the draft intact");

// ---------- model generation normalizes steps into cards; provider label sticks
const providerDraft = await runPlanProvider(root, "Add multi-queue overnight runs", {
  confirm: true,
  provider: "codex",
  invoke: async () => ({
    code: 0,
    text: JSON.stringify({
      title: "Multi-queue overnight runs",
      objective: "Run several queues under one shared budget",
      completion_checks: ["merged preview is pure"],
      acceptance_examples: [{ given: "two queues", when: "one run", then: "both advance round-robin" }],
      implementation_steps: [{ step: "Merge queues", files: ["runtime/lib/launch.mjs"], verify: "node verification/multi_queue_test.mjs" }],
      verifier_commands: ["node verification/multi_queue_test.mjs"],
    }),
    provider: "codex", model: "glm-5.3",
  }),
});
assert.equal(providerDraft.artifact.task_proposals.length, 1, "step-only model output still gets one typed card per step");
const providerLabel = planDraftLabel(loadPlanDraft(root, providerDraft.id));
assert.equal(providerLabel.mode, "model", "a provider draft labels as model");
assert.match(providerLabel.label, /codex \/ glm-5\.3/, "the model label names provider and model");

// ---------- provider registry contract: configured-only picker, refuse before spend
const fakeRegistry = { providers: {} };
assert.throws(() => requireReadyProvider("zai", { registry: fakeRegistry }), /not configured/, "an unknown provider refuses before any model work");
fakeRegistry.providers.zai = { id: "zai", label: "Z.ai", worker: "claude", base_url: "https://api.z.ai/api/anthropic", api_key: "sk-test", model: "glm-4.6" };
const ready = requireReadyProvider("zai", { registry: fakeRegistry });
assert.equal(ready.withModel("glm-4.5-air").model, "glm-4.5-air", "a model override is applied for the call");
fakeRegistry.providers.broken = { id: "broken", label: "Broken", worker: "claude", base_url: "", api_key: "" };
assert.throws(() => requireReadyProvider("broken", { registry: fakeRegistry }), /not ready/, "an unconfigured provider refuses with its problems");
const choices = providerChoices(fakeRegistry);
assert.ok(choices.every((choice) => !("api_key" in choice)), "the picker never exposes API keys");
assert.equal(choices.find((choice) => choice.id === "broken").ready, false, "an unready provider stays visible but marked");

// ---------- approval: dedicated Plan Queue, ordered canonical tasks, idempotent
const approved = approvePlanDraft(root, localDraft.id, { note: "cards approved by test" });
assert.equal(approved.created, true, "approval creates the work");
assert.ok(approved.queueId && approved.queueId.startsWith("plan-") && approved.queueId.length <= 32, "approval creates a valid dedicated plan queue id");
const orderedCards = loadPlanDraft(root, localDraft.id).artifact.task_proposals;
assert.equal(approved.taskIds.length, orderedCards.length, "one canonical task per card");
const stateAfter = loadState(root);
assert.deepEqual(
  approved.taskIds,
  orderedCards.map((card) => Object.values(stateAfter.tasks).find((task) => task.plan_proposal_id === card.id)?.id),
  "task ids follow card order",
);
for (const [index, taskId] of approved.taskIds.entries()) {
  const task = stateAfter.tasks[taskId];
  assert.equal(task.plan_draft_id, localDraft.id, "every task links to its draft");
  assert.equal(task.plan_proposal_id, orderedCards[index].id, "every task links to its card");
  assert.equal(task.plan_queue_id, approved.queueId, "every task links to the plan queue");
  assert.ok(Array.isArray(task.plan_depends_on), "resolved dependency task ids are stored");
}
const planQueue = loadQueueBook(root).queues[approved.queueId];
assert.deepEqual(planQueue.items.map((item) => item.id), approved.taskIds, "the plan queue holds the ordered tasks");
assert.equal(planQueue.plan_draft_id, localDraft.id, "the queue links back to the draft");
const again = approvePlanDraft(root, localDraft.id);
assert.equal(again.created, false, "re-approval is idempotent");
assert.deepEqual(again.taskIds, approved.taskIds, "re-approval returns the same task ids");
assert.equal(again.queueId, approved.queueId, "re-approval returns the same plan queue");

// legacy drafts (no explicit cards) approve 1:1 from implementation steps
const legacy = savePlanDraft(root, {
  intent: "Legacy step-only draft",
  artifact: minimalArtifact("Legacy step-only draft", [
    { step: "Step one", files: ["a"], verify: "check-a" },
    { step: "Step two", files: ["b"], verify: "check-b" },
  ]),
  stage: "plan",
});
const legacyApproved = approvePlanDraft(root, legacy);
assert.equal(legacyApproved.taskIds.length, 2, "a legacy draft maps one implementation step to one canonical task");
assert.equal(normalizeProposals(loadPlanDraft(root, legacy.id).artifact).length, 2, "legacy artifacts normalize to cards without mutating the stored artifact");

// ---------- multi-queue: round-robin merge, skip paused, shared-budget run shape
queueCreate(root, "alpha", { name: "Alpha" });
queueCreate(root, "beta", { name: "Beta" });
queueAdd(root, approved.taskIds[0], { queueId: "alpha" });
queueAdd(root, approved.taskIds[1], { queueId: "alpha" });
queueAdd(root, approved.taskIds[2], { queueId: "beta" });
queueAdd(root, approved.taskIds[3], { queueId: "beta" });
const merged = mergeQueues(root, ["alpha", "beta"]);
assert.deepEqual(merged.items.map((item) => item.id), [approved.taskIds[0], approved.taskIds[2], approved.taskIds[1], approved.taskIds[3]], "merge interleaves the queues round-robin");
assert.equal(merged.skipped.length, 0, "active queues are not skipped");
queuePause(root, "beta");
const withPaused = mergeQueues(root, ["alpha", "beta"]);
assert.deepEqual(withPaused.items.map((item) => item.id), [approved.taskIds[0], approved.taskIds[1]], "a paused queue is skipped for the run while others continue");
assert.match(withPaused.skipped[0].reason, /paused/, "the skip reason is honest");
const dry = multiQueueDryRun(root, { queueIds: ["alpha", "beta"] });
assert.equal(dry.queueId, withPaused.id, "the multi preview reports the merged queue id");
assert.equal(dry.roundRobin, true, "the multi preview is labelled round-robin");
assert.deepEqual(dry.order, withPaused.items.map((item) => item.id), "the preview keeps the round-robin execution order");
assert.throws(() => mergeQueues(root, ["beta"]), /none of the selected queues can run/, "all-paused selection refuses the run");
assert.throws(() => mergeQueues(root, []), /at least one queue/, "an empty selection refuses the run");

// a shared-budget multi-queue run over settled tasks walks the merged pipeline
// without spawning anything: paused queues are narrated as skipped and the
// gate lease is always released.
for (const taskId of approved.taskIds) {
  const state = loadState(root);
  state.tasks[taskId].status = "done";
  saveState(root, state);
}
const pausedRunProgress = [];
const pausedRun = await executeLaunchQueue(root, { confirm: true, queueIds: ["alpha", "beta"], maxMinutes: 5, maxSessions: 3, onProgress: (line) => pausedRunProgress.push(String(line)) });
assert.match(pausedRun.reason || "", /empty/, "the merged run reports its honest terminal state");
assert.ok(pausedRunProgress.some((line) => /queue beta: paused/.test(line)), "a paused queue is narrated as skipped inside the confirmed run");
assert.equal(readRunLock(root), null, "no gate lease is left behind by the merged run");
queueResume(root, "beta");
const finalRunProgress = [];
await executeLaunchQueue(root, { confirm: true, queueIds: ["alpha", "beta"], maxMinutes: 5, maxSessions: 3, onProgress: (line) => finalRunProgress.push(String(line)) });
assert.equal(readRunLock(root), null, "the gate is released after the multi-queue run");
assert.equal(finalRunProgress.some((line) => /queue beta: paused/.test(line)), false, "a resumed queue is no longer skipped");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: Plan Studio cards — typed proposals, validated card ops, one-card regeneration, Plan Queue approval, round-robin multi-queue runs");
