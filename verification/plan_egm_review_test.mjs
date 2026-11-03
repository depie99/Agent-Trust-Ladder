import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { savePlanDraft, loadPlanDraft } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-egm-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-egm-home-"));
const priorHome = process.env.USERPROFILE;
process.env.USERPROFILE = home;
const fixtureArtifact = JSON.parse(fs.readFileSync(path.join(repoRoot(), "verification", "plan_contract_fixture.json"), "utf8"));
function repoRoot() { return path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), ".."); }

const CONSOLIDATED = `# Consolidated EGM Review Report

## Verdict

The design is not ready for implementation. The plan leaves verification undefined. The target file was not edited.

## Action items by priority

### 🔴 Blockers

#### A1 — Ground the verification commands

Replace the placeholder verifier with an executable project command and name the file that proves it.

#### A2 — Bound the scope

State the out-of-scope surface explicitly so implementation cannot drift.

### 🟡 Major

#### A3 — Split the delivery slice

The single vertical slice mixes specify and implement steps.

### 🟢 Nits

#### A4 — Wording

Replace vague terms with observable behavior.

## Traceability matrix

| Action | Raw findings |
|---|---|
| A1 | Zoom Out 1 |
| A2 | Comprehension 1 |
| A3 | Critic C1 |
| A4 | Style 1 |

## Stage reports

- zoom_out_report.md
`;

const ALL_REPORTS = ["zoom_out_report.md", "comprehension_report.md", "critic_report.md", "intermediate_zoom_out_report.md", "implementation_readiness_report.md", "consolidated_review_report.md"];

function fakeEgmRunner({ reports = ALL_REPORTS, consolidated = CONSOLIDATED, exitCode = 0 } = {}) {
  let invocations = 0;
  return async (rootArg, { draft }) => {
    invocations += 1;
    const workdir = path.join(draft.dir, "egm", `fake-${invocations}`);
    fs.mkdirSync(workdir, { recursive: true });
    for (const name of reports) fs.writeFileSync(path.join(workdir, name), name === "consolidated_review_report.md" ? consolidated : `# ${name}\n`);
    return { workdir, exitCode, durationMs: 5, lastMessage: "review complete", command: "fake" };
  };
}

const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-egm-codexhome-"));
fs.writeFileSync(path.join(codexHome, "config.toml"), '[windows]\nsandbox = "elevated"\n');
fs.writeFileSync(path.join(codexHome, "auth.json"), "{}");
fs.mkdirSync(path.join(codexHome, "plugins", "cache", "egm", "egm", "0.1.0"), { recursive: true });

const config = { egmReview: { enabled: true, codexHome, model: "gpt-fake", versionSha: "5ba5afa03f62627639fa4f71b7ac3bd4d8d07e24", maxMinutes: 5 } };
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify(config, null, 2));

fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence v1\n");
saveState(root, emptyState());

const server = await startControlPlaneServer(root, { egmRunner: fakeEgmRunner() });
const post = async (route, body) => {
  const response = await fetch(`${server.url}${route.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

try {
  // 1. Without a usable EGM config the endpoint refuses explicitly and records nothing.
  const noCfgRoot = path.join(os.tmpdir(), "atl-plan-egm-nocfg-" + Date.now());
  fs.mkdirSync(path.join(noCfgRoot, ".trust", "manager"), { recursive: true });
  fs.mkdirSync(path.join(noCfgRoot, "verification"), { recursive: true });
  fs.writeFileSync(path.join(noCfgRoot, "verification", "fixture.mjs"), "// evidence v1\n");
  saveState(noCfgRoot, emptyState());
  fs.mkdirSync(path.join(noCfgRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(noCfgRoot, "config", "manager.json"), "{}");
  const draftA = savePlanDraft(noCfgRoot, { intent: fixtureArtifact.objective, artifact: fixtureArtifact });
  const serverNoCfg = await startControlPlaneServer(noCfgRoot, { egmRunner: fakeEgmRunner() });
  const refused = await fetch(`${serverNoCfg.url}api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draftA.id, reviewType: "egm" }) });
  const refusedBody = await refused.json();
  assert.equal(refused.status, 409);
  assert.match(refusedBody.error, /EGM deep review is not usable/);
  assert.equal(loadPlanDraft(noCfgRoot, draftA.id).review, undefined);
  await new Promise((resolve) => serverNoCfg.server.close(resolve));

  // 2. A successful EGM run converts reports into findings and commits an egm-kind review.
  const draft = savePlanDraft(root, { intent: fixtureArtifact.objective, artifact: fixtureArtifact });
  const reviewResult = await post("/api/plan/review", { draftId: draft.id, reviewType: "egm" });
  assert.equal(reviewResult.status, 200, JSON.stringify(reviewResult.body));
  const review = reviewResult.body.review;
  assert.equal(review.kind, "egm");
  assert.equal(review.verdict, "blocked");
  assert.equal(review.egm.version_sha, config.egmReview.versionSha);
  assert.equal(review.provider, "codex-egm");
  const severities = review.findings.map((item) => item.severity);
  assert.deepEqual(severities, ["blocker", "blocker", "major", "minor"]);
  assert.match(review.findings[0].message, /A1/);
  assert.ok(review.findings[0].correction.length > 10);
  assert.equal(loadPlanDraft(root, draft.id).review.kind, "egm");

  // 3. A blocked EGM review keeps the approval gate shut.
  const { approvePlanDraft } = await import("../runtime/lib/plan-studio.mjs");
  assert.throws(() => approvePlanDraft(root, draft.id), /fresh, passing accuracy review/, "an EGM blocked review must not authorize approval");

  // 4. A runner failure is surfaced honestly; nothing is recorded as a review.
  const failServer = await startControlPlaneServer(root, { egmRunner: fakeEgmRunner({ exitCode: 1 }) });
  const draftFail = savePlanDraft(root, { intent: fixtureArtifact.objective + " fail case", artifact: fixtureArtifact });
  const failed = await fetch(`${failServer.url}api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draftFail.id, reviewType: "egm" }) });
  const failedBody = await failed.json();
  assert.equal(failed.status, 502);
  assert.match(failedBody.error, /EGM review failed/);
  assert.ok(failedBody.workdir);
  assert.equal(loadPlanDraft(root, draftFail.id).review, undefined);
  await new Promise((resolve) => failServer.server.close(resolve));

  // 5. Missing stage reports are an explicit incomplete failure, never a pass.
  const incompleteServer = await startControlPlaneServer(root, { egmRunner: fakeEgmRunner({ reports: ALL_REPORTS.filter((name) => name !== "implementation_readiness_report.md") }) });
  const draftInc = savePlanDraft(root, { intent: fixtureArtifact.objective + " incomplete case", artifact: fixtureArtifact });
  const incomplete = await fetch(`${incompleteServer.url}api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draftInc.id, reviewType: "egm" }) });
  const incompleteBody = await incomplete.json();
  assert.equal(incomplete.status, 502);
  assert.match(incompleteBody.error, /implementation_readiness_report\.md/);
  assert.equal(loadPlanDraft(root, draftInc.id).review, undefined);
  await new Promise((resolve) => incompleteServer.server.close(resolve));

  // 6. A draft edited while EGM reviews goes stale and keeps the edit.
  const barrierDraft = savePlanDraft(root, { intent: fixtureArtifact.objective + " barrier case", artifact: fixtureArtifact });
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const barrierServer = await startControlPlaneServer(root, { egmRunner: async (rootArg, { draft: d }) => { const workdir = path.join(d.dir, "egm", "barrier"); fs.mkdirSync(workdir, { recursive: true }); await barrier; for (const name of ALL_REPORTS) fs.writeFileSync(path.join(workdir, name), name === "consolidated_review_report.md" ? CONSOLIDATED : `# ${name}\n`); return { workdir, exitCode: 0, durationMs: 5, lastMessage: "late" }; } });
  const pendingReview = fetch(`${barrierServer.url}api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: barrierDraft.id, reviewType: "egm" }) });
  const barrierDir = path.join(barrierDraft.dir, "egm", "barrier");
  for (let i = 0; i < 400 && !fs.existsSync(barrierDir); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  const edited = await post("/api/plan/card", { draftId: barrierDraft.id, action: "edit", proposalId: "p1", patch: { title: "Edited during EGM review" } });
  assert.equal(edited.status, 200);
  releaseBarrier();
  const stale = await pendingReview;
  const staleBody = await stale.json();
  assert.equal(stale.status, 409, JSON.stringify(staleBody));
  assert.match(staleBody.error, /stale/);
  assert.equal(loadPlanDraft(root, barrierDraft.id).artifact.task_proposals[0].title, "Edited during EGM review");
  assert.equal(loadPlanDraft(root, barrierDraft.id).review, undefined);
  await new Promise((resolve) => barrierServer.server.close(resolve));

  // 7. Regression for the normal ATL path is covered by the standing suites; end.
  console.log("PASS: EGM review path — config refusal, findings conversion, blocked gate, honest failures, stale invalidation");
} finally {
  await new Promise((resolve) => server.server.close(resolve));
  if (priorHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = priorHome;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
