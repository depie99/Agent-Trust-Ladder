import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { savePlanDraft, reviewPlanArtifact, reviewPolicyCheck } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Issue #10: the deep-review policy gate. When egmReview.policy
// (requireDeepReview + minComplexity / maxTaskProposals / touchGlobs) says a
// plan qualifies, approval needs a passing EGM deep review — a passing ATL
// accuracy review is no longer sufficient. Non-qualifying plans keep the
// normal path.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-policy-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-policy-home-"));
const priorHome = process.env.USERPROFILE;
const priorHomePosix = process.env.HOME;
process.env.USERPROFILE = home;
process.env.HOME = home;

const baseArtifact = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "plan_contract_fixture.json"), "utf8"));
const withComplexity = (complexity, files) => {
  const artifact = JSON.parse(JSON.stringify(baseArtifact));
  artifact.task_proposals[0].resource_estimate = { complexity, reason: "policy fixture" };
  if (files) artifact.task_proposals[0].files = files;
  return artifact;
};

const READY_REPORT = "# Consolidated EGM Review Report\n\n## Verdict\n\nready for implementation. The plan is bounded.\n\n## Action items by priority\n\n### 🟢 Nits\n\n#### A1 — Wording\n\nTighten one sentence.\n";
const fakeRunner = async (rootArg, { draft }) => {
  const workdir = path.join(draft.dir, "egm", `fake-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(workdir, { recursive: true });
  for (const name of ["zoom_out_report.md", "comprehension_report.md", "critic_report.md", "intermediate_zoom_out_report.md", "implementation_readiness_report.md", "consolidated_review_report.md"]) {
    fs.writeFileSync(path.join(workdir, name), name === "consolidated_review_report.md" ? READY_REPORT : `# ${name}\n`);
  }
  return { workdir, exitCode: 0, durationMs: 1, lastMessage: "ok" };
};

const config = { egmReview: { enabled: true, backend: "glm-goldfish", versionSha: "5ba5afa03f62627639fa4f71b7ac3bd4d8d07e24", maxReviewsPerDay: 100, policy: { requireDeepReview: true, minComplexity: "complex", touchGlobs: ["runtime/secrets/**"] } } };
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify(config, null, 2));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence v1\n");
saveState(root, emptyState());
fs.mkdirSync(path.join(home, ".atl"), { recursive: true });
fs.writeFileSync(path.join(home, ".atl", "providers.json"), JSON.stringify({ providers: { test: { id: "test", label: "Test", worker: "claude", base_url: "https://example.test", api_key: "fixture", model: "fixture" } } }));

// Unit: glob matching and the complexity ranking.
const touchesProtected = reviewPolicyCheck(root, withComplexity("standard", ["runtime/secrets/keys.mjs"]), null);
assert.deepEqual(touchesProtected, { required: true, reasons: ["touches protected paths (runtime/secrets/**)"], satisfied: false });
const notQualifying = reviewPolicyCheck(root, withComplexity("standard", ["verification/fixture.mjs"]), null);
assert.equal(notQualifying.required, false);

const server = await startControlPlaneServer(root, { egmRunner: fakeRunner, planningInvoke: async () => ({ code: 0, provider: "test", model: "m", text: JSON.stringify({ verdict: "passed", findings: [] }) }) });
const post = async (route, body) => {
  const response = await fetch(`${server.url}${route.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const { approvePlanDraft, approvePlanDraft: approve } = await import("../runtime/lib/plan-studio.mjs");

try {
  // A standard-complexity plan does not qualify: the normal ATL path approves.
  const standardDraft = savePlanDraft(root, { intent: baseArtifact.objective, artifact: withComplexity("standard") });
  reviewPlanArtifact(root, standardDraft.id, { verdict: "passed", findings: [], provider: "test", model: "m" });
  const approvedStandard = approvePlanDraft(root, standardDraft.id, { note: "policy: standard not qualifying" });
  assert.equal(approvedStandard.created, true, "non-qualifying plan approves through the normal path");

  // A critical-complexity plan qualifies: ATL-passing review is not enough.
  const criticalDraft = savePlanDraft(root, { intent: baseArtifact.objective + " critical", artifact: withComplexity("critical") });
  reviewPlanArtifact(root, criticalDraft.id, { verdict: "passed", findings: [], provider: "test", model: "m" });
  assert.throws(() => approvePlanDraft(root, criticalDraft.id), /deep-review policy requires an EGM review/, "qualifying plan must not approve on an ATL-only review");

  // The qualifying plan approves after a passing EGM deep review.
  await post("/api/plan/review", { draftId: criticalDraft.id, provider: "test", reviewType: "egm" }).then(async (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.equal(r.body.review.kind, "egm");
    assert.equal(r.body.review.verdict, "passed");
  });
  const approvedCritical = approvePlanDraft(root, criticalDraft.id, { note: "policy: satisfied by passing EGM deep review" });
  assert.equal(approvedCritical.created, true, "qualifying plan approves after a passing EGM deep review");

  console.log("PASS: deep-review policy — non-qualifying approves normally, qualifying needs a passing EGM review, satisfied by the deep review");
} finally {
  await new Promise((resolve) => server.server.close(resolve));
  if (priorHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = priorHome;
  if (priorHomePosix === undefined) delete process.env.HOME;
  else process.env.HOME = priorHomePosix;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
