import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { emptyMyTasksStore, readMyTasksStore, workItemKey } from "../runtime/lib/my-tasks.mjs";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { registerProject } from "../runtime/lib/supervisor.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Spec 022 API contract over HTTP: preparation inventory/CRUD, bounded
// discovery through the planning seam, handoff idempotency, and the
// /api/plan/generate preparation gate — driven by a #6376-shaped fixture
// (dual-repo task, code-review evidence that honestly admits the merge code
// was never found) plus one title-only and one Done task.

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-prepapi-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.ATL_HOME = path.join(fakeHome, ".atl");
fs.mkdirSync(process.env.ATL_HOME, { recursive: true });
fs.writeFileSync(path.join(process.env.ATL_HOME, "providers.json"), JSON.stringify({
  providers: {
    testprov: { id: "testprov", label: "Test Provider", worker: "openai-http", protocol: "openai", base_url: "https://example.test/api", api_key: "sk-secret-value", model: "m-1", models: ["m-1", "m-2"] },
  },
}, null, 2));

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const A = fs.mkdtempSync(path.join(os.tmpdir(), "atl-prepapi-project-"));
fs.mkdirSync(path.join(A, ".trust", "manager"), { recursive: true });
saveState(A, emptyState());

const makeRepo = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `atl-prepapi-${name}-`));
  git(["init", "-q"], dir);
  git(["config", "user.email", "atl-test@example.invalid"], dir);
  git(["config", "user.name", "ATL test"], dir);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "app.js"), `export const ${name} = () => 1;\n`);
  git(["add", "-A"], dir);
  git(["commit", "-qm", "baseline"], dir);
  return dir;
};
const frontend = registerProject(makeRepo("frontend"), { name: "S2HStoreFrontend2" });
const backend = registerProject(makeRepo("backend"), { name: "S2HBacekend" });

// #6376-shaped fixture: guest cart lost after login, revision 5, rich
// description; the AI review claims code coverage but its own findings admit
// no cart-transfer implementation was ever found.
const CONNECTION = "https://devops.example.invalid:32678/collection";
const key6376 = workItemKey(CONNECTION, "example-project", 6376);
const key700 = workItemKey(CONNECTION, "example-project", 700);
const item = (id, over = {}) => ({
  key: workItemKey(CONNECTION, "example-project", id), connection: CONNECTION, project: "example-project", id,
  rev: 5, title: `Item ${id}`, type: "Task", state: "Active", state_category: "inprogress",
  priority: 2, area_path: "example-project\\S2H", iteration_path: "example-project\\Sprint 74",
  url: `${CONNECTION}/example-project/_workitems/edit/${id}`,
  description_text: "", acceptance_criteria: "", tags: [], changed_at: "2026-11-11T12:47:24Z", dependencies: [], ...over,
});
const item6376 = item(6376, { title: "S2H - Cart item lost after login", description_text: "Guest cart items disappear after login.", acceptance_criteria: "guest cart not merged after login" });
const store = emptyMyTasksStore();
for (const entry of [item6376, item(700, { title: "Title only" }), item(500, { state_category: "complete", state: "Done" })]) {
  store.records[entry.key] = { ...entry, first_seen_at: entry.changed_at, last_seen_at: entry.changed_at };
}
fs.mkdirSync(path.join(A, ".trust", "manager", "my-tasks"), { recursive: true });
fs.writeFileSync(path.join(A, ".trust", "manager", "my-tasks", "store.json"), JSON.stringify(store, null, 2));
// Review book: #6376 has the only code-coverage review (honest gap), #700 a
// task-only one; project binding maps Main to both registered repositories.
fs.writeFileSync(path.join(A, ".trust", "manager", "my-tasks", "reviews.json"), JSON.stringify({
  version: 1, locale: "en-US",
  entries: {
    cart: { key: key6376, locale: "en-US", status: "ready", coverage: "code", generated_at: "2026-11-14T10:34:25Z", source_revision: 5, provider: "gapgpt", model: "gpt-6-luna", result: { brief: "Guest cart items disappear after login.", findings: [{ text: "no cart-transfer or merge implementation is supplied" }] }, evidence: [{ id: "e1", repository_id: frontend.id, path: "src/app.js", line: 1, end_line: 2, excerpt: "export const frontend = () => 1;" }], repositories: [{ id: frontend.id, name: "S2HStoreFrontend2" }, { id: backend.id, name: "S2HBacekend" }] },
    title: { key: key700, locale: "en-US", status: "ready", coverage: "task-only", generated_at: "2026-11-13T09:00:00Z", result: { brief: "no context" }, evidence: [], repositories: [] },
  },
  jobs: [], paused: null,
}, null, 2));
fs.writeFileSync(path.join(A, ".trust", "manager", "my-tasks", "repository-bindings.json"), JSON.stringify({ version: 1, rules: [{ connection: CONNECTION, project: "example-project", area: "", repository_ids: [frontend.id, backend.id] }], items: {} }, null, 2));

const discoveryOutput = {
  code_locations: [
    { repository_id: frontend.id, path: "src/app.js", line: 1, note: "login page entry" },
    { repository_id: backend.id, path: "src/app.js", line: 1, note: "no cart merge endpoint found" },
  ],
  findings: ["frontend login handler posts without cart context", "backend exposes no cart-transfer endpoint"],
  questions: [
    { kind: "owner_decision", question: "Merge guest cart into the account cart, or keep them separate?", why: "behavior contract", options: ["Merge", "Keep separate"] },
    { kind: "investigation", question: "Which service owns cart persistence?", why: "locates the fix", options: [] },
  ],
};
const planFixture = (intent) => ({
  plan_contract_version: 2,
  title: "Restore the guest cart after login",
  objective: intent,
  requirements: [{ id: "r1", text: "guest cart survives login", source: "original request" }],
  constraints: [], observed_evidence: [{ description: "frontend entry", path: "src/app.js" }],
  assumptions: [], open_questions: [], risks: [],
  completion_checks: ["guest cart survives login"],
  acceptance_examples: [{ given: "a guest cart exists", when: "the user logs in", then: "the cart is intact" }],
  selected_skills: ["atl-verify"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [{ step: "Merge carts", files: ["src/app.js"], verify: "node -e 1" }],
  verifier_commands: ["node -e 1"],
  task_proposals: [{ id: "p1", title: "Restore the guest cart", objective: intent, instructions: "Merge the guest cart on login.", deliverables: ["cart survives login"], requirement_ids: ["r1"], completion_checks: ["guest cart survives login"], selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Plans verifiable acceptance evidence." }, depends_on: [], files: ["src/app.js"], verify: "node -e 1" }],
});
let discoveryCalls = 0, planCalls = 0;
const running = await startControlPlaneServer(A, {
  planningInvoke: async ({ request }) => {
    if (request.task_preparation_discovery) {
      discoveryCalls += 1;
      return { code: 0, text: JSON.stringify(discoveryOutput), provider: "testprov", model: "m-1" };
    }
    if (request.review) return { code: 0, text: JSON.stringify({ verdict: "passed", findings: [] }), provider: "testprov", model: "m-1" };
    planCalls += 1;
    return { code: 0, text: JSON.stringify(planFixture(request.intent)), provider: "testprov", model: "m-1" };
  },
  publishFetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
});
const get = async (pathname) => {
  const response = await fetch(`${running.url}${pathname.replace(/^\//, "")}`, { cache: "no-store" });
  return { status: response.status, body: await response.json() };
};
const post = (pathname, body) => fetch(`${running.url}${pathname.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, body: await response.json() }));

try {
  // 1. Inventory seeds active records only; review linkage and repositories
  //    arrive from the review book and binding rules.
  const inventory = await get("api/my-tasks/preparations");
  assert.equal(inventory.status, 200);
  const rows = Object.fromEntries(inventory.body.items.map((row) => [row.id, row]));
  assert.equal(inventory.body.counts.historical, 1, "Done task inventoried as historical");
  assert.equal(rows[500].prep_status, "historical");
  assert.equal(rows[6376].prep_status, "needs_investigation", "code review alone does not fake a complete brief");
  assert.deepEqual(rows[6376].repositories, [frontend.id, backend.id], "binding rule seeds dual repositories");
  assert.equal(rows[700].prep_status, "needs_investigation");
  const detail700 = (await get(`api/my-tasks/preparation?key=${encodeURIComponent(key700)}`)).body;
  assert.equal(detail700.record.brief.evidence_limitation, "The short review ran without code evidence (task-only coverage).", "task-only coverage is kept as a limitation");
  const detail6376 = (await get(`api/my-tasks/preparation?key=${encodeURIComponent(key6376)}`)).body;
  assert.equal(detail6376.record.brief.evidence_limitation, null, "code-coverage review carries no limitation");
  assert.equal(detail6376.record.brief.evidence.length, 1, "review evidence is reused as intake context");
  assert.equal(detail6376.record.brief.evidence[0].repository_id, frontend.id);

  // 2. Brief CRUD: CAS conflict then a real save flips the derived status.
  const wrongRevision = await post("api/my-tasks/preparation/save", { key: key6376, revision: 99, patch: { outcome: "x" } });
  assert.equal(wrongRevision.status, 409);
  assert.match(wrongRevision.body.error, /reload and re-apply/);
  const saved = await post("api/my-tasks/preparation/save", { key: key6376, revision: detail6376.record.revision, patch: { outcome: "Guest cart must survive login", requested_behavior: "Merge the guest cart into the account cart" } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.status, "ready", "brief complete with no questions is ready");
  assert.equal(saved.body.record.source_revision, "5", "source revision captured at preparation");

  // 3. Owner decision vs investigation questions stay separate through the
  //    lifecycle: adding either blocks, answering one investigation question
  //    does not satisfy an owner decision.
  const withQuestions = await post("api/my-tasks/preparation/question", { key: key6376, revision: saved.body.record.revision, question: { kind: "owner_decision", question: "Merge or keep carts separate?", options: ["Merge", "Keep separate"] } });
  assert.equal(withQuestions.status, 200);
  assert.equal(withQuestions.body.status, "needs_answer");
  const investigationAdded = await post("api/my-tasks/preparation/question", { key: key6376, revision: withQuestions.body.record.revision, question: { kind: "investigation", question: "Where does cart persistence live?" } });
  assert.equal(investigationAdded.body.status, "needs_answer", "an owner decision outranks open investigation");
  const ownerAnswered = await post("api/my-tasks/preparation/answer", { key: key6376, revision: investigationAdded.body.record.revision, questionId: "q1", answer: "Merge" });
  assert.equal(ownerAnswered.body.status, "needs_investigation", "owner decision satisfied, investigation still open");
  const ownerQuestion = ownerAnswered.body.record.questions[0];
  assert.equal(ownerQuestion.answer, "Merge");
  assert.ok(ownerQuestion.answered_at, "answer timestamped");

  // 4. Bounded discovery: readiness refused before spend; a real run records
  //    locations/findings and appends its questions.
  const refused = await post("api/my-tasks/preparation/investigate", { key: key6376, mode: "discovery", provider: "nope" });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /no request was sent/);
  assert.equal(discoveryCalls, 0, "refusal happened before any provider call");
  const manual = await post("api/my-tasks/preparation/investigate", { key: key6376, mode: "manual", notes: "checked frontend login flow" });
  assert.equal(manual.status, 200);
  assert.equal(manual.body.record.investigation_runs.at(-1).kind, "manual");
  const discovered = await post("api/my-tasks/preparation/investigate", { key: key6376, mode: "discovery", provider: "testprov" });
  if (discovered.status !== 200) console.log("DEBUG discovered:", JSON.stringify(discovered.body).slice(0, 500));
  assert.equal(discovered.status, 200);
  assert.equal(discoveryCalls, 1, "exactly one bounded provider call");
  const discoveryRun = discovered.body.record.investigation_runs.at(-1);
  assert.equal(discoveryRun.kind, "discovery");
  assert.equal(discoveryRun.code_locations.length, 2, "both repositories carry code locations");
  assert.equal(discovered.body.record.questions.filter((question) => question.from_run).length, 2, "discovery raised its questions onto the record");
  assert.equal(discovered.body.status, "needs_answer", "discovery's owner decision blocks again");

  // 5. Handoff: idempotent, dual-repo, stamped; repeat returns the same task.
  const handoff = await post("api/my-tasks/preparation/handoff", { key: key6376 });
  assert.equal(handoff.status, 200);
  assert.equal(handoff.body.handoff.created, true);
  assert.deepEqual(handoff.body.handoff.repository_ids, [frontend.id, backend.id]);
  const handoffAgain = await post("api/my-tasks/preparation/handoff", { key: key6376 });
  assert.equal(handoffAgain.body.handoff.task_id, handoff.body.handoff.task_id, "repeated handoff never duplicates");
  assert.equal(handoffAgain.body.handoff.created, false);
  const state = JSON.parse(fs.readFileSync(path.join(A, ".trust", "manager", "state.json"), "utf8"));
  const request = state.tasks[handoff.body.handoff.task_id];
  assert.equal(request.prep_key, key6376);
  assert.equal(request.plan_review_required, true);

  // 6. #6376 regression: generation stays locked until BOTH the owner decision
  //    and the investigation question are settled, with per-question reasons.
  const blocked = await post("api/plan/generate", { intent: "Restore the guest cart after login", sourceTaskId: request.id, repositoryId: frontend.id, provider: "testprov", confirm: true });
  assert.equal(blocked.status, 409, "unresolved preparation blocks model planning");
  assert.equal(blocked.body.preparation.status, "needs_answer");
  assert.ok(blocked.body.preparation.reasons.some((reason) => /owner decision/.test(reason)), "owner decisions named as recovery actions");
  assert.ok(blocked.body.preparation.reasons.some((reason) => /investigation/.test(reason)), "investigation questions named separately");
  assert.equal(planCalls, 0, "no provider spend happened while preparation blocked");
  const record6376 = discovered.body.record;
  const open = record6376.questions.filter((question) => !question.answer);
  let revision = record6376.revision;
  for (const question of open) {
    const answered = await post("api/my-tasks/preparation/answer", { key: key6376, revision, questionId: question.id, answer: question.kind === "owner_decision" ? "Merge" : "cart store service" });
    revision = answered.body.record.revision;
  }
  const generated = await post("api/plan/generate", { intent: "Restore the guest cart after login", sourceTaskId: request.id, repositoryId: frontend.id, provider: "testprov", confirm: true });
  assert.equal(generated.status, 200, "ready preparation unlocks model planning");
  assert.ok(generated.body.draft?.id, "a plan draft came back");

  // 7. Source freshness: a drifted Azure revision re-locks generation. The
  //    drift is written through the same record file the server reads.
  const { createHash } = await import("node:crypto");
  const prepFile = path.join(A, ".trust", "manager", "my-tasks", "preparations", `${createHash("sha256").update(key6376).digest("hex")}.json`);
  const driftRecord = JSON.parse(fs.readFileSync(prepFile, "utf8"));
  driftRecord.source_revision = "4";
  fs.writeFileSync(prepFile, JSON.stringify(driftRecord, null, 2));
  const relocked = await post("api/plan/generate", { intent: "Restore the guest cart after login", sourceTaskId: request.id, repositoryId: frontend.id, provider: "testprov", confirm: true });
  assert.equal(relocked.status, 409, "a changed Azure task re-locks generation");
  assert.match(relocked.body.error, /changed since preparation/);
  assert.match(relocked.body.error, /4 → 5/, "both revisions named in the recovery action");
  // Recover: refresh the source revision through a brief save (the honest
  // repair path is reopen-preparation; here the record itself is corrected).
  driftRecord.source_revision = "5";
  fs.writeFileSync(prepFile, JSON.stringify(driftRecord, null, 2));
  const recovered = await post("api/plan/generate", { intent: "Restore the guest cart after login", sourceTaskId: request.id, repositoryId: frontend.id, provider: "testprov", confirm: true });
  assert.equal(recovered.status, 200);

  // 8. Inventory reflects the request linkage and the created plan draft.
  const after = (await get("api/my-tasks/preparations")).body;
  const linked = after.items.find((row) => row.id === 6376).linked_request;
  assert.equal(linked.task_id, request.id);
  assert.ok(linked.plans.length >= 1, "created draft shows in the request's plans");
  assert.equal(linked.repositories.length, 2, "request keeps its dual-repo binding");

  // 9. Backward compatibility: items endpoint shape unchanged.
  const items = await get("api/my-tasks/items");
  assert.equal(items.status, 200);
  assert.ok(Array.isArray(items.body.items));
} finally {
  await new Promise((resolve) => running.server.close(resolve));
}

console.log("PASS: Task preparation API — inventory seeding with review/binding context, CAS saves, question-kind separation, honest discovery refusal before spend, bounded discovery run, idempotent dual-repo handoff, generation gate with per-question reasons and revision-drift re-lock, items endpoint untouched");
