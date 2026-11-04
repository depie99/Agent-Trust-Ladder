import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { savePlanDraft, loadPlanDraft, approvePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// glm-goldfish: the EGM protocol natively through ATL's planning seam — six
// fresh single-shot provider calls (GLM or any configured provider), no Codex.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-egm-glm-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-egm-glm-home-"));
const priorHome = process.env.USERPROFILE;
const priorHomePosix = process.env.HOME;
process.env.USERPROFILE = home;
process.env.HOME = home;
const fixtureArtifact = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "plan_contract_fixture.json"), "utf8"));

const SHAPE_A_REPORT = `# Consolidated EGM Review Report

## Verdict

not ready for implementation. The plan leaves verification undefined and scope unbounded.

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
`;

const STAGE_REPORT = (persona) => `## Findings

#### S1 — ${persona} sample finding
Severity: Blocker
Affected scope: whole document
The sample rationale for ${persona}.
`;

// config: glm-goldfish needs only the protocol pin
const CANARY = "velvet-sparrow-orchard42"; // owner-only marker: must never reach a reviewer request or report
const config = { egmReview: { enabled: true, backend: "glm-goldfish", versionSha: "5ba5afa03f62627639fa4f71b7ac3bd4d8d07e24", maxReviewsPerDay: 100, ownerNote: `secret ${CANARY} context` }, approvalNote: `approve-with ${CANARY}` };
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify(config, null, 2));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence v1\n");
saveState(root, emptyState());
fs.mkdirSync(path.join(home, ".atl"), { recursive: true });
fs.writeFileSync(path.join(home, ".atl", "providers.json"), JSON.stringify({ providers: { gapgpt: { id: "gapgpt", label: "GLM fixture", worker: "claude", base_url: "https://example.test", api_key: "fixture", model: "glm-fake" } } }));

// Fake planning seam: resolves each stage by looking at the request.
const calls = [];
const server = await startControlPlaneServer(root, {
  planningInvoke: async ({ request }) => {
    calls.push(request);
    if (/synthesizer/i.test(request.task)) {
      return { code: 0, provider: "gapgpt", model: "glm-fake", text: SHAPE_A_REPORT };
    }
    const persona = /— ([^<]+)\./.exec(request.task)?.[1] || "stage";
    return { code: 0, provider: "gapgpt", model: "glm-fake", text: STAGE_REPORT(persona) };
  },
});
const post = async (route, body) => {
  const response = await fetch(`${server.url}${route.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

try {
  const draft = savePlanDraft(root, { intent: fixtureArtifact.objective, artifact: fixtureArtifact });

  // Fresh-context property: stage requests carry only target + declared prior reports.
  const reviewResult = await post("/api/plan/review", { draftId: draft.id, provider: "gapgpt", reviewType: "egm" });
  assert.equal(reviewResult.status, 200, JSON.stringify(reviewResult.body).slice(0, 400));
  const review = reviewResult.body.review;
  assert.equal(review.kind, "egm");
  assert.equal(review.egm.backend, "glm-goldfish");
  assert.equal(review.verdict, "blocked");
  assert.deepEqual(review.findings.map((item) => item.severity), ["blocker", "blocker", "major", "minor"]);
  assert.equal(review.egm.version_sha, config.egmReview.versionSha);
  assert.match(review.provider, /gapgpt/);

  assert.equal(calls.length, 6, `expected six single-shot calls, got ${calls.length}`);
  const taskOf = (index) => calls[index].task || "";
  assert.match(taskOf(0), /Zoom Out Reviewer/);
  assert.match(taskOf(1), /Comprehension Reviewer/);
  assert.match(taskOf(2), /Design Critic/);
  assert.match(taskOf(3), /Intermediate Zoom Out/);
  assert.match(taskOf(4), /Implementation Readiness/);
  assert.match(taskOf(5), /synthesizer/i);
  // no call sees another call's conversation: every request is a bare object,
  // and only declared prior reports are attached
  assert.equal(Object.keys(calls[0].prior_stage_reports || {}).length, 0);
  assert.equal(Object.keys(calls[1].prior_stage_reports || {}).length, 0);
  assert.deepEqual(Object.keys(calls[2].prior_stage_reports || {}).sort(), ["comprehension_report.md", "zoom_out_report.md"]);
  assert.deepEqual(Object.keys(calls[3].prior_stage_reports || {}).sort(), ["critic_report.md", "zoom_out_report.md"]);
  assert.equal(Object.keys(calls[4].prior_stage_reports || {}).length, 0);
  assert.equal(Object.keys(calls[5].stage_reports).length, 5);
  // workdir preserved beside the draft
  const loaded = loadPlanDraft(root, draft.id);
  const egmDir = path.join(loaded.dir, "egm");
  const run = fs.readdirSync(egmDir)[0];
  const runDir = path.join(egmDir, run);
  for (const name of ["zoom_out_report.md", "comprehension_report.md", "critic_report.md", "intermediate_zoom_out_report.md", "implementation_readiness_report.md", "consolidated_review_report.md", "plan-review-input.md"]) {
    assert.ok(fs.existsSync(path.join(runDir, name)), `missing ${name}`);
  }

  // Progress ledger: one entry per stage, six stages total.
  {
    const egmDir = path.join(loadPlanDraft(root, draft.id).dir, "egm");
    const run = fs.readdirSync(egmDir)[0];
    const progress = JSON.parse(fs.readFileSync(path.join(egmDir, run, "progress.json"), "utf8"));
    assert.equal(progress.length, 6);
    assert.equal(progress[0].index, 1);
    assert.equal(progress.at(-1).stage, "consolidated_review_report.md");
    assert.equal(progress.at(-1).total, 6);
  }

  // Blocked EGM review keeps approval shut.
  assert.throws(() => approvePlanDraft(root, draft.id), /fresh, passing accuracy review/);

  // A failing stage fails honestly; nothing is recorded.
  const failDraft = savePlanDraft(root, { intent: fixtureArtifact.objective + " glm fail", artifact: fixtureArtifact });
  let first = true;
  const failServer = await startControlPlaneServer(root, {
    planningInvoke: async ({ request }) => {
      if (first && !request.task.includes("Synthesizer")) { first = false; return { code: 1, text: "" }; }
      return { code: 0, provider: "gapgpt", model: "glm-fake", text: STAGE_REPORT("x") };
    },
  });
  const failed = await fetch(`${failServer.url}api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: failDraft.id, provider: "gapgpt", reviewType: "egm" }) });
  const failedBody = await failed.json();
  assert.equal(failed.status, 502, JSON.stringify(failedBody));
  assert.match(failedBody.error, /stage .* failed/);
  assert.equal(loadPlanDraft(root, failDraft.id).review, undefined);
  await new Promise((resolve) => failServer.server.close(resolve));

  // A draft edited mid-review goes stale and keeps the edit.
  const barrierDraft = savePlanDraft(root, { intent: fixtureArtifact.objective + " glm barrier", artifact: fixtureArtifact });
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const barrierServer = await startControlPlaneServer(root, {
    planningInvoke: async ({ request }) => {
      if (/synthesizer/i.test(request.task)) return { code: 0, provider: "gapgpt", model: "glm-fake", text: SHAPE_A_REPORT };
      if (request.task.includes("Zoom Out Reviewer")) { await barrier; }
      return { code: 0, provider: "gapgpt", model: "glm-fake", text: STAGE_REPORT("x") };
    },
  });
  const pending = fetch(`${barrierServer.url}api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: barrierDraft.id, provider: "gapgpt", reviewType: "egm" }) });
  for (let i = 0; i < 400 && calls.pending !== true; i++) {
    const egmDirB = path.join(loadPlanDraft(root, barrierDraft.id).dir, "egm");
    if (fs.existsSync(egmDirB) && fs.readdirSync(egmDirB).length) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const edited = await post("/api/plan/card", { draftId: barrierDraft.id, action: "edit", proposalId: "p1", patch: { title: "Edited during GLM review" } });
  assert.equal(edited.status, 200);
  release();
  const stale = await pending;
  const staleBody = await stale.json();
  assert.equal(stale.status, 409, JSON.stringify(staleBody));
  assert.match(staleBody.error, /stale/);
  assert.equal(loadPlanDraft(root, barrierDraft.id).review, undefined);
  assert.equal(loadPlanDraft(root, barrierDraft.id).artifact.task_proposals[0].title, "Edited during GLM review");
  await new Promise((resolve) => barrierServer.server.close(resolve));

  // Isolation probe (product path): owner-only strings from config/state must
  // never appear in any reviewer request, any report, or outside the workdir.
  for (const [index, request] of calls.entries()) {
    assert.ok(!JSON.stringify(request).includes(CANARY), `stage call ${index} carries the owner-only canary`);
  }
  const egmRoot = path.join(loadPlanDraft(root, draft.id).dir, "egm");
  for (const run of fs.readdirSync(egmRoot)) for (const name of fs.readdirSync(path.join(egmRoot, run))) {
    const text = fs.readFileSync(path.join(egmRoot, run, name), "utf8");
    assert.ok(!text.includes(CANARY), `${name} carries the owner-only canary`);
  }
  // Cancellation between stages fails closed: 502, no review recorded.
  const cancelDraft = savePlanDraft(root, { intent: fixtureArtifact.objective + " glm cancel", artifact: fixtureArtifact });
  let stageCalls = 0;
  const cancelServer = await startControlPlaneServer(root, {
    planningInvoke: async ({ request }) => {
      stageCalls += 1;
      if (stageCalls === 2) {
        const egmDir = path.join(loadPlanDraft(root, cancelDraft.id).dir, "egm");
        const run = fs.readdirSync(egmDir).at(-1);
        fs.writeFileSync(path.join(egmDir, run, "cancel.flag"), new Date().toISOString());
      }
      return { code: 0, provider: "gapgpt", model: "glm-fake", text: STAGE_REPORT("x") };
    },
  });
  const cancelled = await fetch(`${cancelServer.url}api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: cancelDraft.id, provider: "gapgpt", reviewType: "egm" }) });
  const cancelledBody = await cancelled.json();
  assert.equal(cancelled.status, 502, JSON.stringify(cancelledBody));
  assert.match(cancelledBody.error, /cancelled by the owner/);
  assert.equal(loadPlanDraft(root, cancelDraft.id).review, undefined);
  assert.ok(stageCalls < 6, `cancellation stopped the pipeline early (${stageCalls} calls)`);
  await new Promise((resolve) => cancelServer.server.close(resolve));

  console.log("PASS: glm-goldfish EGM review — six fresh single-shot calls, findings conversion, blocked gate, honest failure, stale invalidation, progress ledger, mid-review cancellation");
} finally {
  await new Promise((resolve) => server.server.close(resolve));
  if (priorHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = priorHome;
  if (priorHomePosix === undefined) delete process.env.HOME;
  else process.env.HOME = priorHomePosix;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
