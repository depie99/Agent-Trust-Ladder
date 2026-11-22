import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { emptyState, loadState, saveState, createTask } from "../runtime/lib/state.mjs";
import { importCandidates } from "../runtime/lib/composer.mjs";
import { generateLocalPlan, loadPlanDraft, planningEvidence, resolvePlanRepository, reviewPlanArtifact, approvePlanDraft, runPlanProvider, savePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { registerProject } from "../runtime/lib/supervisor.mjs";
import { ensureWorkspace } from "../runtime/lib/workspace.mjs";
import { loadQueueBook } from "../runtime/lib/queue.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// The supervisor registry lives in the machine home; pin it so registration
// and resolution never touch (or depend on) the real ~/.atl/supervisor.json.
const realHome = process.env.USERPROFILE;
const realHomePosix = process.env.HOME;
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-home-scope-"));
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
const head = (repo) => git(["rev-parse", "HEAD"], repo).trim();

// ATL project that hosts the server (not a git repo on purpose: an unassigned
// request must not accidentally ground against it).
const A = fs.mkdtempSync(path.join(os.tmpdir(), "atl-scope-project-"));
fs.mkdirSync(path.join(A, ".trust", "manager"), { recursive: true });
saveState(A, emptyState());

// The bound repository, standing in for S2H.
const R = fs.mkdtempSync(path.join(os.tmpdir(), "atl-scope-repo-"));
git(["init", "-q"], R);
git(["config", "user.email", "atl-test@example.invalid"], R);
git(["config", "user.name", "ATL test"], R);
fs.mkdirSync(path.join(R, "src"), { recursive: true });
fs.writeFileSync(path.join(R, "package.json"), JSON.stringify({ name: "bound-repo", scripts: {} }, null, 2));
fs.writeFileSync(path.join(R, "src", "app.js"), "export const render = () => 'top sales';\n");
fs.writeFileSync(path.join(R, "check.mjs"), "console.log('verifier');\n");
fs.writeFileSync(path.join(R, "AGENTS.md"), "# Bound repo\n");
git(["add", "-A"], R);
git(["commit", "-qm", "baseline"], R);
const project = registerProject(R, { name: "S2H" });

// A second repository: one imported request can affect frontend and backend.
const B = fs.mkdtempSync(path.join(os.tmpdir(), "atl-scope-backend-"));
git(["init", "-q"], B);
git(["config", "user.email", "atl-test@example.invalid"], B);
git(["config", "user.name", "ATL test"], B);
fs.mkdirSync(path.join(B, "src"), { recursive: true });
fs.writeFileSync(path.join(B, "package.json"), JSON.stringify({ name: "backend-repo", scripts: {} }, null, 2));
fs.writeFileSync(path.join(B, "src", "app.js"), "export const cart = () => [];\n");
fs.writeFileSync(path.join(B, "check.mjs"), "console.log('verifier');\n");
git(["add", "-A"], B);
git(["commit", "-qm", "baseline"], B);
const backend = registerProject(B, { name: "S2HBackend" });

const planFixture = (intent) => ({
  plan_contract_version: 2,
  title: "Fix the top sales section",
  objective: intent,
  requirements: [{ id: "r1", text: "the top sales list renders correct products", source: "original request" }],
  constraints: [], observed_evidence: [{ description: "Product list source", path: "src/app.js" }],
  assumptions: [], open_questions: [], risks: [],
  completion_checks: ["the top sales list renders correct products"],
  acceptance_examples: [{ given: "the homepage loads", when: "the top sales section renders", then: "only current products are listed" }],
  selected_skills: ["atl-verify"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [{ step: "Fix rendering", files: ["src/app.js"], verify: "node check.mjs" }],
  verifier_commands: ["node check.mjs"],
  task_proposals: [{ id: "p1", title: "Fix the top sales section", objective: intent, instructions: "Fix the product list rendering.", deliverables: ["correct top sales list"], requirement_ids: ["r1"], completion_checks: ["the top sales list renders correct products"], selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Plans verifiable acceptance evidence." }, depends_on: [], files: ["src/app.js"], verify: "node check.mjs" }],
});

const sourceTaskInto = (root, { repositoryId = project.id, remoteId = "6341" } = {}) => {
  const state = loadState(root);
  const task = createTask(state, {
    title: `Task ${remoteId}: S2H - Top sales issue`,
    source: { type: "azure", remote_id: remoteId, revision: "5", iteration: "example-project\\Sprint 74", url: `https://devops.example.com/Collection/example-project/_workitems/edit/${remoteId}` },
    plan_review_required: true, resources: [],
  });
  task.intake_only = true;
  task.intake_snapshot = { title: task.title, objective: "homepage product sections look wrong", completion_checks: [], source: task.source, resources: [] };
  task.imported_at = new Date().toISOString();
  if (repositoryId) { task.repository_id = repositoryId; task.repository_name = "S2H"; }
  saveState(root, state);
  return task.id;
};

const importedTaskId = sourceTaskInto(A, {});

try {
  // 1) Import stamping: importCandidates honors repositoryId, refresh never clobbers.
  const state1 = loadState(A);
  const candidate = { title: "Task 6350: S2H - cart badge", intake_key: "azure-6350-5", source: { type: "azure", remote_id: "6350", revision: "5", url: "" }, objective_hint: "cart badge stuck", completion_checks: [], resources: [] };
  const imported = importCandidates(A, state1, [candidate], { repositoryId: project.id });
  saveState(A, state1);
  assert.equal(imported.added, 1, "import creates the request");
  const stamped = Object.values(loadState(A).tasks).find((task) => task.intake_key === candidate.intake_key);
  assert.equal(stamped.repository_id, project.id, "imported request is bound to the registered repository");
  assert.equal(stamped.repository_name, "S2H");
  const reimportState = loadState(A);
  const reimport = importCandidates(A, reimportState, [{ ...candidate, objective_hint: "changed hint" }], { repositoryId: null });
  saveState(A, reimportState);
  assert.equal(reimport.skipped, 1, "duplicate import is skipped");
  assert.equal(Object.values(loadState(A).tasks).find((task) => task.intake_key === candidate.intake_key).repository_id, project.id, "re-import never clobbers the binding");

  // 2) resolvePlanRepository: unassigned, assigned, unregistered, missing, not-git.
  const legacyDraft = savePlanDraft(A, { intent: "legacy shape", artifact: generateLocalPlan("legacy shape"), stage: "frame" });
  assert.equal(resolvePlanRepository(A, loadPlanDraft(A, legacyDraft.id)).repoRoot, null, "unassigned drafts inspect the ATL project (legacy behavior)");
  const resolved = resolvePlanRepository(A, { source_task_id: importedTaskId });
  assert.equal(resolved.repoRoot, fs.realpathSync(R), "binding resolves through the supervisor registry");
  const unregisteredId = "00000000-0000-0000-0000-000000000000";
  assert.throws(() => resolvePlanRepository(A, { repository_id: unregisteredId }), (error) => error.statusCode === 409 && /no longer registered/.test(error.message), "unregistered binding blocks with an honest 409");
  const vanishing = fs.mkdtempSync(path.join(os.tmpdir(), "atl-scope-vanish-"));
  git(["init", "-q"], vanishing);
  git(["config", "user.email", "atl-test@example.invalid"], vanishing);
  git(["config", "user.name", "ATL test"], vanishing);
  fs.writeFileSync(path.join(vanishing, "f.txt"), "x\n");
  git(["add", "-A"], vanishing);
  git(["commit", "-qm", "x"], vanishing);
  const vanishingId = registerProject(vanishing, { name: "Vanish" }).id;
  const vanishTaskId = sourceTaskInto(A, { repositoryId: vanishingId, remoteId: "6351" });
  fs.rmSync(vanishing, { recursive: true, force: true });
  assert.throws(() => resolvePlanRepository(A, { source_task_id: vanishTaskId }), (error) => error.statusCode === 409 && /missing on disk/.test(error.message), "missing repository blocks without deleting the request");
  const notGit = fs.mkdtempSync(path.join(os.tmpdir(), "atl-scope-notgit-"));
  const notGitId = registerProject(notGit, { name: "NotGit" }).id;
  assert.throws(() => resolvePlanRepository(A, { repository_id: notGitId }), (error) => error.statusCode === 409 && /not a git checkout/.test(error.message), "non-git target blocks planning");

  // 2b) One request linked to several repositories: ordered, first is primary,
  // and planning must name its repository explicitly.
  const multiState = loadState(A);
  const multiCandidate = { title: "Task 6376: S2H - cart item lost after login", intake_key: "azure-6376-1", source: { type: "azure", remote_id: "6376", revision: "1", url: "" }, objective_hint: "cart empties after login", completion_checks: [], resources: [] };
  importCandidates(A, multiState, [multiCandidate], { repositoryIds: [backend.id, project.id] });
  saveState(A, multiState);
  const multiTask = Object.values(loadState(A).tasks).find((task) => task.intake_key === multiCandidate.intake_key);
  assert.deepEqual(multiTask.repository_ids, [backend.id, project.id], "a request links several repositories in order");
  assert.equal(multiTask.repository_id, backend.id, "the first linked repository is the primary binding");
  assert.equal(multiTask.repository_name, "S2HBackend");
  assert.throws(() => resolvePlanRepository(A, { source_task_id: multiTask.id }), (error) => error.statusCode === 409 && /Choose which repository/.test(error.message), "a multi-repository request never silently plans in its first repository");
  assert.equal(resolvePlanRepository(A, { source_task_id: multiTask.id, repository_id: project.id }).repoRoot, fs.realpathSync(R), "an explicitly chosen linked repository resolves");
  assert.throws(() => resolvePlanRepository(A, { source_task_id: importedTaskId, repository_id: backend.id }), (error) => error.statusCode === 409 && /not linked/.test(error.message), "a repository the request is not linked to is refused");

  // 3) planningEvidence re-rooting reads the bound repo, not the server project.
  assert.equal(planningEvidence(A, null, { repoRoot: R }).package?.name, "bound-repo", "bound evidence reads the repository manifest");
  assert.equal(planningEvidence(A).package?.name, undefined, "unassigned evidence reads the ATL project");

  // 4) runPlanProvider grounds against the bound repo and refuses a broken binding before spend.
  const boundDraft = await runPlanProvider(A, "Fix the top sales section", {
    confirm: true, provider: "testprov", sourceTaskId: importedTaskId,
    invoke: async ({ request }) => ({ code: 0, text: JSON.stringify(planFixture(request.intent)), provider: "testprov", model: "m-1" }),
  });
  const boundEnvelope = loadPlanDraft(A, boundDraft.id);
  assert.equal(boundEnvelope.repository?.id, project.id, "the draft freezes its repository binding");
  assert.equal(boundEnvelope.repository?.revision, head(R), "the draft captures the planning revision");
  await assert.rejects(
    () => runPlanProvider(A, "same intent without a binding", {
      confirm: true, provider: "testprov",
      invoke: async () => ({ code: 0, text: JSON.stringify(planFixture("same intent without a binding")) }),
    }),
    /was not found in the project/,
    "the same plan is refused when grounded against the ATL project that lacks the files",
  );
  let spent = false;
  await assert.rejects(
    () => runPlanProvider(A, "vanish spend", { confirm: true, provider: "testprov", sourceTaskId: vanishTaskId, invoke: async () => { spent = true; return { code: 0, text: "{}" }; } }),
    /missing on disk/,
    "a broken binding refuses the provider spend up front",
  );
  assert.equal(spent, false, "no provider call happened for the broken binding");

  // 5) Review + approval: inheritance onto queue and tasks, revision capture, blocked approval.
  const reviewed = reviewPlanArtifact(A, boundDraft.id, { verdict: "passed", findings: [], source_revision: { current: true, type: "azure", remote_id: "6341", revision: "5" } }, { repoRoot: R });
  assert.equal(reviewed.review?.verdict, "passed");
  const approved = approvePlanDraft(A, reviewed.id, { note: "approved test plan", sourceRevisionCurrent: true });
  assert.equal(approved.created, true, "approval creates the plan tasks");
  const approvedTask = loadState(A).tasks[approved.taskIds[0]];
  assert.equal(approvedTask.repository_id, project.id, "plan tasks inherit the repository binding");
  assert.equal(approvedTask.repository_name, "S2H");
  assert.equal(loadQueueBook(A).queues[approved.queueId].repository_id, project.id, "the plan queue carries the repository binding");
  assert.equal(loadPlanDraft(A, boundDraft.id).repository?.revision, head(R), "approval freezes the planning revision");

  const blockedTaskId = sourceTaskInto(A, { remoteId: "6352" });
  const blockedDraft = await runPlanProvider(A, "Fix the cart badge", {
    confirm: true, provider: "testprov", sourceTaskId: blockedTaskId,
    invoke: async ({ request }) => ({ code: 0, text: JSON.stringify(planFixture(request.intent)), provider: "testprov", model: "m-1" }),
  });
  const blockedReviewed = reviewPlanArtifact(A, blockedDraft.id, { verdict: "passed", findings: [], source_revision: { current: true, type: "azure", remote_id: "6352", revision: "5" } }, { repoRoot: R });
  const realR = fs.realpathSync(R);
  const hidden = R + "-hidden";
  fs.renameSync(realR, hidden);
  try {
    await assert.rejects(async () => approvePlanDraft(A, blockedReviewed.id, { sourceRevisionCurrent: true }), (error) => error.statusCode === 409 && /missing on disk/.test(error.message), "approval is blocked while the bound repository is missing");
  } finally {
    fs.renameSync(hidden, realR);
  }
  const stillThere = loadState(A).tasks[blockedTaskId];
  assert.ok(stillThere && stillThere.intake_only, "the blocked request itself is kept");

  // 6) Execution: ensureWorkspace sources the worktree from the bound repo.
  const ws = ensureWorkspace(A, {}, { id: "T-SCOPE-1", title: "Fix top sales", source: { type: "azure", remote_id: "6341" }, repository_id: project.id });
  assert.equal(ws.mode, "worktree", "bound tasks get a worktree");
  assert.equal(path.resolve(ws.from), path.resolve(R), "the worktree is sourced from the bound repository");
  const marker = JSON.parse(fs.readFileSync(path.join(ws.dir, ".atl-workspace.json"), "utf8"));
  assert.equal(marker.source_commit, head(R), "the marker records the bound repository's HEAD");
  assert.ok(fs.existsSync(path.join(ws.dir, "src", "app.js")), "the worker sees the repository's files");
  fs.renameSync(fs.realpathSync(R), hidden);
  try {
    assert.throws(() => ensureWorkspace(A, {}, { id: "T-SCOPE-2", title: "x", source: { type: "file" }, repository_id: project.id }), /missing on disk/, "a missing bound repository blocks dispatch");
  } finally {
    fs.renameSync(hidden, fs.realpathSync(hidden).replace(/-hidden$/, ""));
  }
  const legacyWorkspace = ensureWorkspace(A, {}, { id: "T-SCOPE-3", title: "x", source: { type: "file" } });
  assert.equal(legacyWorkspace.mode, "scratch", "unassigned tasks keep the legacy workspace behavior");

  console.log("PASS: library layer — binding resolution, grounded planning, blocked refusal, approval inheritance, bound worktrees");
} catch (error) {
  console.error("FAIL (library layer):", error.message);
  throw error;
}

// ---------- server routes: the Task 6341 journey end to end ----------

const A2 = fs.mkdtempSync(path.join(os.tmpdir(), "atl-scope-server-"));
fs.mkdirSync(path.join(A2, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(A2, "config"), { recursive: true });
fs.writeFileSync(path.join(A2, "config", "manager.json"), JSON.stringify({ intake: { azure: { org_url: "https://devops.example.com/Collection", project: "example-project", token_env: "AZDO_PAT" } } }, null, 2));
saveState(A2, emptyState());
const serverTaskId = sourceTaskInto(A2, { repositoryId: null });

const azureCalls = [];
const fakeAzureFetch = async (url) => {
  azureCalls.push(String(url));
  const body = JSON.stringify({ rev: "5", id: Number(/workitems\/(\d+)/i.exec(String(url))?.[1] || 6341) });
  return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
};
let reviewSawEvidence = null;
let planningCalls = 0;
const running = await startControlPlaneServer(A2, {
  planningInvoke: async ({ request }) => {
    planningCalls++;
    if (request.review) {
      reviewSawEvidence = request.project_evidence || null;
      return { code: 0, text: JSON.stringify({ verdict: "passed", findings: [] }), provider: "testprov", model: "m-1" };
    }
    return { code: 0, text: JSON.stringify(planFixture(request.intent)), provider: "testprov", model: "m-1" };
  },
  publishFetch: fakeAzureFetch,
});
process.env.AZDO_PAT = "fake-pat-for-scope-test";
const post = (pathname, body) => fetch(`${running.url}${pathname.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, body: await response.json() }));

try {
  // Assign the imported request to the registered repository.
  const assigned = await post("/api/intake/repository", { taskId: serverTaskId, repositoryId: project.id });
  assert.equal(assigned.status, 200, "assignment succeeds for an unplanned request");
  assert.equal(assigned.body.repositoryName, "S2H");
  const history = await fetch(`${running.url}api/intake/history`).then((response) => response.json());
  assert.equal(history.requests.find((request) => request.id === serverTaskId)?.repository?.id, project.id, "the request list exposes the binding");

  // Local skeleton inherits the binding so later steps ground against S2H.
  const skeleton = await post("/api/plan/local", { intent: "Fix the top sales section", sourceTaskId: serverTaskId });
  assert.equal(skeleton.status, 200);
  assert.equal(skeleton.body.draft.repository?.id, project.id, "the skeleton draft carries the binding");

  // Model completion grounds against the bound repo (the ATL project lacks src/app.js).
  const generated = await post("/api/plan/generate", { intent: "Fix the top sales section", sourceTaskId: serverTaskId, provider: "testprov", confirm: true });
  assert.equal(generated.status, 200, `model planning grounds against the bound repository: ${JSON.stringify(generated.body)}`);
  assert.equal(generated.body.draft.repository?.id, project.id);
  const draftId = generated.body.draft.id;

  // The accuracy review sees the bound repository's evidence.
  const reviewed = await post("/api/plan/review", { draftId, provider: "testprov" });
  assert.equal(reviewed.status, 200, `review passes with bound evidence: ${JSON.stringify(reviewed.body)}`);
  assert.equal(reviewSawEvidence?.package?.name, "bound-repo", "the reviewer inspected the bound repository");

  // Moving a request with planning work is refused — explicit handling, never silent.
  const moved = await post("/api/intake/repository", { taskId: serverTaskId, repositoryId: null });
  assert.equal(moved.status, 409, "reassignment with an existing draft is refused");
  assert.match(moved.body.error, /plan draft/);

  // Approval inherits the binding onto queue + tasks; the live source check ran.
  const approvedRoute = await post("/api/plan/approve", { draftId });
  assert.equal(approvedRoute.status, 200, `approval succeeds: ${JSON.stringify(approvedRoute.body)}`);
  const stateAfter = loadState(A2);
  const planTasks = Object.values(stateAfter.tasks).filter((task) => task.plan_draft_id === draftId);
  assert.ok(planTasks.length >= 1, "approval created plan tasks");
  assert.equal(planTasks[0].repository_id, project.id, "queue tasks inherit the repository binding");
  assert.equal(loadQueueBook(A2).queues[approvedRoute.body.approved.queueId].repository_id, project.id);
  assert.ok(azureCalls.some((url) => url.includes("workitems/6341")), "the imported source was verified live before approval");

  console.log("PASS: server routes — assign, bound skeleton/model/review/approve, move refusal, task inheritance");

  // ---------- one request, two repositories: per-repository plans and queues ----------
  const multiTaskId = sourceTaskInto(A2, { repositoryId: null, remoteId: "6376" });
  const linked = await post("/api/intake/repository", { taskId: multiTaskId, repositoryIds: [project.id, backend.id] });
  assert.equal(linked.status, 200, `linking two repositories succeeds: ${JSON.stringify(linked.body)}`);
  assert.deepEqual(linked.body.repositoryIds, [project.id, backend.id]);
  assert.equal(linked.body.repositoryName, "S2H", "the first linked repository stays the primary binding");
  const linkedHistory = await fetch(`${running.url}api/intake/history`).then((response) => response.json());
  const linkedRow = linkedHistory.requests.find((request) => request.id === multiTaskId);
  assert.deepEqual(linkedRow.repositories.map((entry) => entry.name), ["S2H", "S2HBackend"], "the request list exposes every linked repository");

  const ambiguous = await post("/api/plan/local", { intent: "Fix cart loss after login", sourceTaskId: multiTaskId });
  assert.equal(ambiguous.status, 409, "planning a multi-repository request without naming the repository is refused");
  assert.match(ambiguous.body.error, /Choose which repository/);
  const strayId = registerProject(fs.mkdtempSync(path.join(os.tmpdir(), "atl-scope-stray-")), { name: "Stray" }).id;
  const notLinked = await post("/api/plan/local", { intent: "Fix cart loss after login", sourceTaskId: multiTaskId, repositoryId: strayId });
  assert.equal(notLinked.status, 409, "planning in a repository the request is not linked to is refused");

  const backendPlan = await post("/api/plan/generate", { intent: "Fix cart loss after login", sourceTaskId: multiTaskId, repositoryId: backend.id, provider: "testprov", confirm: true });
  assert.equal(backendPlan.status, 200, `backend plan grounds in the backend repository: ${JSON.stringify(backendPlan.body)}`);
  assert.equal(backendPlan.body.draft.repository?.id, backend.id, "the backend draft freezes the backend binding");
  const frontendPlan = await post("/api/plan/generate", { intent: "Fix cart loss after login", sourceTaskId: multiTaskId, repositoryId: project.id, provider: "testprov", confirm: true });
  assert.equal(frontendPlan.status, 200, `frontend plan grounds in the frontend repository: ${JSON.stringify(frontendPlan.body)}`);
  assert.equal(frontendPlan.body.draft.repository?.id, project.id);
  for (const draft of [backendPlan.body.draft, frontendPlan.body.draft]) {
    const review = await post("/api/plan/review", { draftId: draft.id, provider: "testprov" });
    assert.equal(review.status, 200, `each repository plan passes its own review: ${JSON.stringify(review.body)}`);
  }

  const backendApproved = await post("/api/plan/approve", { draftId: backendPlan.body.draft.id });
  assert.equal(backendApproved.status, 200, `backend plan approval succeeds: ${JSON.stringify(backendApproved.body)}`);
  assert.equal(loadState(A2).tasks[multiTaskId].plan_review_required, true, "the request stays open while the frontend still needs its plan");

  const callsBefore = planningCalls;
  const replan = await post("/api/plan/generate", { intent: "Fix cart loss after login", sourceTaskId: multiTaskId, repositoryId: backend.id, provider: "testprov", confirm: true });
  assert.equal(replan.status, 409, "re-planning a repository that already has an approved plan is refused");
  assert.match(replan.body.error, /already has an approved plan/);
  assert.equal(planningCalls, callsBefore, "the refusal happens before any provider spend");
  const unlink = await post("/api/intake/repository", { taskId: multiTaskId, repositoryIds: [project.id] });
  assert.equal(unlink.status, 409, "unlinking a repository with an approved plan is refused");
  assert.match(unlink.body.error, /Cannot unlink S2HBackend/);

  const frontendApproved = await post("/api/plan/approve", { draftId: frontendPlan.body.draft.id });
  assert.equal(frontendApproved.status, 200, `frontend plan approval succeeds: ${JSON.stringify(frontendApproved.body)}`);
  assert.equal(loadState(A2).tasks[multiTaskId].plan_review_required, false, "the request closes once every linked repository has an approved plan");
  const book = loadQueueBook(A2);
  assert.notEqual(backendApproved.body.approved.queueId, frontendApproved.body.approved.queueId, "each repository gets its own plan queue");
  assert.equal(book.queues[backendApproved.body.approved.queueId].repository_id, backend.id);
  assert.equal(book.queues[frontendApproved.body.approved.queueId].repository_id, project.id);

  // A plan that is not tied to an imported request can still target a repository.
  const freeform = await post("/api/plan/local", { intent: "Refactor the cart service", repositoryId: backend.id });
  assert.equal(freeform.status, 200);
  assert.equal(freeform.body.draft.repository?.id, backend.id, "a repository can be planned directly from its project card");

  // A workspace draft (no frozen binding) pins the link list.
  const floatTaskId = sourceTaskInto(A2, { repositoryId: null, remoteId: "6377" });
  const floatDraft = await post("/api/plan/local", { intent: "Workspace plan", sourceTaskId: floatTaskId });
  assert.equal(floatDraft.status, 200);
  const floatLink = await post("/api/intake/repository", { taskId: floatTaskId, repositoryIds: [backend.id] });
  assert.equal(floatLink.status, 409, "a draft without a frozen binding is never silently re-pointed by a new link");
  assert.match(floatLink.body.error, /without a frozen repository binding/);

  // The Projects work map shows the relations per repository.
  const map = await fetch(`${running.url}api/projects/map`).then((response) => response.json());
  assert.equal(map.ok, true);
  const frontendCard = map.repositories.find((entry) => entry.id === project.id);
  const backendCard = map.repositories.find((entry) => entry.id === backend.id);
  const frontendRequest = frontendCard.requests.find((request) => request.id === multiTaskId);
  assert.equal(frontendRequest?.status, "planned", "the frontend card shows the request as planned there");
  assert.deepEqual(frontendRequest.also.map((entry) => entry.name), ["S2HBackend"], "the card shows which other repositories the request affects");
  assert.ok(frontendCard.queues.some((queue) => queue.id === frontendApproved.body.approved.queueId && queue.source_task_id === multiTaskId && queue.total >= 1), "the frontend card lists its plan queue linked back to the request");
  assert.ok(frontendCard.tasks.some((task) => task.plan_draft_id === frontendPlan.body.draft.id), "the frontend card lists the executable plan tasks");
  assert.ok(backendCard.requests.some((request) => request.id === multiTaskId && request.status === "planned"));
  assert.ok(backendCard.queues.some((queue) => queue.id === backendApproved.body.approved.queueId));
  assert.ok(backendCard.plans.some((plan) => plan.id === freeform.body.draft.id && !plan.source_task_id), "free-form repository plans appear on the card");
  assert.equal(backendCard.health.git, true, "the card reports the repository health");
  assert.ok(map.unassigned.some((request) => request.id === floatTaskId), "unlinked requests are listed for assignment");
  assert.ok(!map.unassigned.some((request) => request.id === multiTaskId));

  console.log("PASS: multi-repository requests — link several repositories, explicit per-repository plans and queues, pinned links, work map");
} catch (error) {
  console.error("FAIL (server routes):", error.message);
  throw error;
} finally {
  await new Promise((resolve) => { running.server.close(resolve); });
  if (realHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realHome;
  if (realHomePosix === undefined) delete process.env.HOME;
  else process.env.HOME = realHomePosix;
  delete process.env.ATL_HOME;
  delete process.env.AZDO_PAT;
  for (const dir of [A, A2, R, B, fakeHome]) fs.rmSync(dir, { recursive: true, force: true });
}

console.log("PASS: repository-scoped imports and planning — assignment, grounding, enforcement, inheritance, isolation");
