import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PrepConflictError, addManualInvestigation, addPreparationQuestion, answerPreparationQuestion,
  assertPreparationReady, beginDiscoveryRun, buildDiscoveryPrompt, candidateFromPreparation,
  defaultNextAction, derivePreparationStatus, finishDiscoveryRun, handoffPreparation,
  parseDiscoveryJson, preparationInventory, preparationSeedContext, preparationView,
  readPreparation, savePreparationBrief, seedPreparation, validateDiscoveryOutput, writePreparation,
} from "../runtime/lib/task-preparation.mjs";
import { emptyMyTasksStore, readMyTasksStore, writeMyTasksStore, workItemKey } from "../runtime/lib/my-tasks.mjs";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { registerProject } from "../runtime/lib/supervisor.mjs";

// Spec 022: preparation record contract — derived statuses, CAS, question
// kinds, discovery runs, handoff idempotency, and the generation gate. No
// network, no provider, no Azure write. The supervisor registry is pinned to
// a fake home so registration never touches the real ~/.atl.

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-prep-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.ATL_HOME = path.join(fakeHome, ".atl");
fs.mkdirSync(process.env.ATL_HOME, { recursive: true });

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-prep-store-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());

const connection = "https://devops.example.invalid:32678/collection";
const item = (id, over = {}) => ({
  key: workItemKey(connection, "Main", id), connection, project: "Main", id,
  rev: 5, title: `Item ${id}`, type: "Task", state: "Active", state_category: "inprogress",
  priority: 2, area_path: "Main\\Area", iteration_path: null, url: `${connection}/Main/_workitems/edit/${id}`,
  description_text: "", acceptance_criteria: "", tags: [], changed_at: "2026-11-11T10:00:00Z", dependencies: [], ...over,
});
const storeWith = (...items) => {
  const store = emptyMyTasksStore();
  for (const entry of items) store.records[entry.key] = { ...entry, first_seen_at: entry.changed_at, last_seen_at: entry.changed_at };
  writeMyTasksStore(root, store);
  return store;
};
const freshItem = item(6376, { title: "S2H - Cart item lost after login", description_text: "Guest cart is lost.", acceptance_criteria: "cart survives login" });

// 1. Derived statuses: not prepared, incomplete brief, open owner decision,
//    open investigation, ready, historical (never reopened).
storeWith(freshItem, item(500, { state_category: "complete", state: "Done" }));
const view = (key) => preparationView(root, key);
assert.equal(view(freshItem.key).status, "not_prepared");
assert.equal(view(freshItem.key).next_action, defaultNextAction("not_prepared"), "default next action before a record exists");
seedPreparation(root, freshItem.key, freshItem, {});
assert.equal(view(freshItem.key).status, "needs_investigation", "seeded record without outcome/requested stays needs_investigation");
assert.equal(view(item(500).key).status, "historical", "complete tasks are inventoried without a record");

let record = readPreparation(root, freshItem.key);
record.brief.outcome = "Cart survives login";
record.brief.requested_behavior = "Merge guest cart after login";
writePreparation(root, record, { expectedRevision: record.revision });
assert.equal(view(freshItem.key).status, "ready", "outcome + requested behavior complete all questions closed");

addPreparationQuestion(root, freshItem.key, { kind: "owner_decision", question: "Merge or keep separate?", why: "behavior contract", options: ["Merge", "Keep separate"] });
assert.equal(view(freshItem.key).status, "needs_answer", "one open owner decision blocks ready");
record = readPreparation(root, freshItem.key);
const ownerQuestion = record.questions[0];
assert.deepEqual(ownerQuestion.options, ["Merge", "Keep separate"]);
addPreparationQuestion(root, freshItem.key, { kind: "investigation", question: "Where is the login merge code?" });
assert.equal(view(freshItem.key).status, "needs_answer", "owner decisions outrank investigation questions");
assert.ok(view(freshItem.key).record.questions.length === 2);
answerPreparationQuestion(root, freshItem.key, ownerQuestion.id, "Merge the carts");
assert.equal(view(freshItem.key).status, "needs_investigation", "open investigation still blocks ready");
record = readPreparation(root, freshItem.key);
answerPreparationQuestion(root, freshItem.key, record.questions[1].id, "Login handler in src/auth");
assert.equal(view(freshItem.key).status, "ready", "all questions answered + brief complete");
assert.throws(() => answerPreparationQuestion(root, freshItem.key, "q99", "x"), /unknown question/);
assert.throws(() => answerPreparationQuestion(root, freshItem.key, ownerQuestion.id, "   "), /answer cannot be empty/);
assert.throws(() => addPreparationQuestion(root, freshItem.key, { question: "  " }), /question needs text/);

// 2. CAS: a stale expected revision is a 409 conflict, content untouched.
record = readPreparation(root, freshItem.key);
const staleRevision = record.revision;
savePreparationBrief(root, freshItem.key, { scope: "login flow only" }, { expectedRevision: record.revision });
assert.throws(() => savePreparationBrief(root, freshItem.key, { scope: "overwritten" }, { expectedRevision: staleRevision }), (error) => error instanceof PrepConflictError && error.statusCode === 409);
assert.equal(readPreparation(root, freshItem.key).brief.scope, "login flow only", "stale write did not land");

// 3. Brief normalization: acceptance examples accept a string; fields clamp.
savePreparationBrief(root, freshItem.key, { acceptance_examples: "given guest cart\nwhen login\nthen merged", next_action: "Hand off" });
record = readPreparation(root, freshItem.key);
assert.deepEqual(record.brief.acceptance_examples, ["given guest cart", "when login", "then merged"]);
assert.equal(record.next_action, "Hand off", "explicit next action survives");

// 4. Discovery runs: single in-flight guard, error runs are kept, parsed
//    output appends runs + investigation questions stamped with brief revision.
const runId = beginDiscoveryRun(root, freshItem.key);
assert.throws(() => beginDiscoveryRun(root, freshItem.key), /already in flight/);
assert.throws(() => validateDiscoveryOutput({ code_locations: [], findings: [] }), /neither code locations nor findings/);
assert.deepEqual(validateDiscoveryOutput({ code_locations: [{ repository_id: "r", path: "src/a.js", line: "7", note: "merge" }], findings: ["login merge exists"], questions: [{ kind: "weird", question: "which behavior?" }] }).questions[0].kind, "investigation", "unknown kinds degrade to investigation");
finishDiscoveryRun(root, freshItem.key, runId, { error: "provider quota exhausted" });
record = readPreparation(root, freshItem.key);
assert.equal(record.in_flight, null, "in-flight cleared after failure");
assert.equal(record.investigation_runs[0].error, "provider quota exhausted");
assert.equal(record.questions.length, 2, "a failed run adds no questions");
addManualInvestigation(root, freshItem.key, "checked src/auth; merge lives in session.ts");
const manualRunId = beginDiscoveryRun(root, freshItem.key);
finishDiscoveryRun(root, freshItem.key, manualRunId, { provider: "testprov", model: "m-1", output: parseDiscoveryJson("```json\n{\"code_locations\":[{\"repository_id\":\"r1\",\"path\":\"src/cart.ts\",\"line\":42,\"note\":\"guest cart load\"}],\"findings\":[\"no merge call\"],\"questions\":[{\"kind\":\"owner_decision\",\"question\":\"Discard or merge stale carts?\",\"why\":\"behavior contract\",\"options\":[\"Merge\",\"Discard\"]}]}\n```") });
record = readPreparation(root, freshItem.key);
assert.equal(record.investigation_runs.length, 3);
assert.equal(record.investigation_runs[2].code_locations[0].path, "src/cart.ts", "fenced JSON parses");
assert.ok(Number.isInteger(record.investigation_runs[2].brief_revision) && record.investigation_runs[2].brief_revision >= 1, "run stamped with the brief revision it saw");
const discoveryQuestion = record.questions.at(-1);
assert.equal(discoveryQuestion.kind, "owner_decision");
assert.equal(discoveryQuestion.from_run, manualRunId);
assert.equal(view(freshItem.key).status, "needs_answer", "discovery-raised owner decision blocks ready");
assert.equal(view(freshItem.key).runs_current.at(-1).current, true, "run matches the current brief revision");
savePreparationBrief(root, freshItem.key, { requested_behavior: "Merge, never discard" });
assert.equal(view(freshItem.key).runs_current.at(-1).current, false, "brief edit marks older runs as against an earlier brief");
const guard = view(freshItem.key);
assert.ok(guard.next_action.length > 0);

// 5. Handoff: idempotent import, prep stamping, repository merge, planning lock.
const azureCfg = { org_url: "https://devops.example.invalid:32678/Collection" };
const candidate = candidateFromPreparation(view(freshItem.key).item, readPreparation(root, freshItem.key), azureCfg);
assert.equal(candidate.intake_key, `azure:https://devops.example.invalid:32678/Collection:Main:6376:5`);
assert.equal(candidate.source.remote_id, 6376);
assert.ok(candidate.objective_hint.includes("Cart survives login"));
assert.deepEqual(candidate.completion_checks, ["given guest cart", "when login", "then merged"]);
const repoA = fs.mkdtempSync(path.join(os.tmpdir(), "atl-prep-repoa-"));
const repoB = fs.mkdtempSync(path.join(os.tmpdir(), "atl-prep-repob-"));
const registeredA = registerProject(repoA, { name: "Frontend" });
const registeredB = registerProject(repoB, { name: "Backend" });
record = readPreparation(root, freshItem.key);
record.repositories = [registeredA.id, registeredB.id];
writePreparation(root, record);
const firstHandoff = handoffPreparation(root, freshItem.key, { azureCfg });
assert.equal(firstHandoff.created, true);
const state1 = loadState(root);
const request1 = state1.tasks[firstHandoff.task_id];
assert.equal(request1.prep_key, freshItem.key);
assert.equal(request1.plan_review_required, true);
assert.deepEqual(request1.repository_ids, [registeredA.id, registeredB.id]);
const secondHandoff = handoffPreparation(root, freshItem.key, { azureCfg });
assert.equal(secondHandoff.task_id, firstHandoff.task_id, "repeated handoff reuses the same request");
assert.equal(secondHandoff.created, false);
assert.equal(Object.values(loadState(root).tasks).filter((task) => task.source?.type === "azure").length, 1, "no duplicate request");
const state2 = loadState(root);
state2.tasks[secondHandoff.task_id].repository_ids = [registeredA.id];
state2.tasks[secondHandoff.task_id].plan_draft_id = "draft-1"; // planning started: binding locks
saveState(root, state2);
const thirdHandoff = handoffPreparation(root, freshItem.key, { azureCfg });
assert.deepEqual(loadState(root).tasks[thirdHandoff.task_id].repository_ids, [registeredA.id], "repository binding is locked after planning");
assert.equal(loadState(root).tasks[thirdHandoff.task_id].prep_revision, readPreparation(root, freshItem.key).revision, "handoff stamps the current preparation revision");

// 6. Generation gate: unprepared requests pass through; prepared ones need
//    ready + fresh; each open question is its own recovery reason.
assert.equal(assertPreparationReady(root, "T-000"), null, "requests without prep linkage keep the old flow");
let gateError = null;
try { assertPreparationReady(root, firstHandoff.task_id); } catch (error) { gateError = error; }
assert.ok(gateError && gateError.statusCode === 409, "not-ready preparation blocks generation with 409");
assert.equal(gateError.preparation.status, "needs_answer");
assert.ok(gateError.preparation.reasons.some((reason) => /owner decision/.test(reason)), "open owner decisions are named individually");
record = readPreparation(root, freshItem.key);
for (const question of record.questions.filter((entry) => !entry.answer)) answerPreparationQuestion(root, freshItem.key, question.id, "settled: merge");
assert.equal(assertPreparationReady(root, firstHandoff.task_id).key, freshItem.key, "ready + fresh passes the gate");
record = readPreparation(root, freshItem.key);
record.source_revision = "4";
writePreparation(root, record);
assert.throws(() => assertPreparationReady(root, firstHandoff.task_id), (error) => error.statusCode === 409 && /changed since preparation/.test(error.message), "stale revision blocks generation");

// 7. Inventory: statuses, counts, seeding (active only), request linkage.
storeWith(freshItem, item(500, { state_category: "complete", state: "Done" }), item(700, {}));
const inventory = preparationInventory(root, { items: [freshItem, item(500, { state_category: "complete", state: "Done" }), item(700, {})], seed: true, seedContext: preparationSeedContext(root) });
const byId = Object.fromEntries(inventory.items.map((row) => [row.id, row]));
assert.equal(byId[6376].prep_status, "ready", "brief complete with every question answered");
assert.ok(byId[6376].next_action.length > 0);
assert.equal(view(freshItem.key).freshness.fresh, false, "stale source revision stays visible");
assert.equal(byId[6376].linked_request.task_id, firstHandoff.task_id, "inventory links the imported request");
assert.equal(byId[700].prep_status, "needs_investigation", "seeding happens inside the inventory pass");
assert.equal(preparationInventory(root, { items: [item(800, {})] }).items[0].prep_status, "not_prepared", "without seeding, record-less active work is not_prepared");
assert.equal(inventory.items.find((row) => row.id === 500).prep_status, "historical", "complete work is inventoried without a record");
assert.ok(!readPreparation(root, item(500).key), "historical tasks stay record-free");
assert.equal(inventory.counts.historical, 1);
const seeded700 = readPreparation(root, item(700).key);
assert.ok(seeded700, "active task auto-seeded");
assert.equal(seeded700.brief.outcome, "", "title-only task seeds an empty outcome honestly");
assert.equal(seeded700.brief.requested_behavior, "", "seeded brief honestly reflects missing source content");

// 8. Seed context: review evidence reuse with the coverage limitation kept.
const myTasksHome = path.join(root, ".trust", "manager", "my-tasks");
fs.writeFileSync(path.join(myTasksHome, "reviews.json"), JSON.stringify({ version: 1, locale: "en-US", entries: { slot: { key: item(700).key, locale: "en-US", status: "ready", coverage: "task-only", generated_at: "2026-11-13T10:00:00Z", result: { brief: "task-only summary" }, evidence: [], repositories: [] } }, jobs: [], paused: null }), "utf8");
// The section-7 seed predated the review book; drop the file so the
// context-aware seed (the path a fresh inventory takes) applies here.
const seededFile700 = path.join(myTasksHome, "preparations", `${crypto.createHash("sha256").update(item(700).key).digest("hex")}.json`);
fs.rmSync(seededFile700, { force: true });
seedPreparation(root, item(700).key, item(700, { title: "Title only" }), preparationSeedContext(root)(item(700, { title: "Title only" })));
const seededReview = readPreparation(root, item(700).key);
assert.equal(seededReview.brief.evidence_limitation, "The short review ran without code evidence (task-only coverage).", "task-only review is surfaced as a limitation");
assert.equal(seededReview.brief.evidence_from.coverage, "task-only");
// Discovery prompt carries the brief, repositories, and open questions.
const titleOnly = item(700, { title: "Title only" });
const prompt = buildDiscoveryPrompt(titleOnly, seededReview, [{ id: "repo-a", name: "Frontend" }]);
assert.ok(prompt.includes("Title only") && prompt.includes("Frontend (repo-a)") && prompt.includes("owner_decision"), "discovery prompt is bounded and explicit");

// 9. Views never crash on missing pieces: unavailable item, orphaned record.
assert.equal(view("nope|none|1").status, "unavailable");
assert.equal(preparationView(root, workItemKey(connection, "Gone", 999)).status, "unavailable");

console.log("PASS: Task preparation store — derived statuses (needs_investigation/needs_answer/ready/historical), CAS 409, question kinds separated, discovery runs fail-open-honest with in-flight guard, brief-revision stamping, idempotent handoff with planning-locked repository binding, generation gate with per-question reasons, active-only seeding, review-evidence limitation reuse");
