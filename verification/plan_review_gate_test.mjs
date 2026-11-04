import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { savePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Issue #4: the review gate is file-based and cross-process. A live lock
// (even from another process) refuses a second review; a stale lock from a
// dead runtime is recovered; the deep-review daily budget is counted at
// start and refuses before any provider spend.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-gate-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-gate-home-"));
const priorHome = process.env.USERPROFILE;
const priorHomePosix = process.env.HOME;
process.env.USERPROFILE = home;
process.env.HOME = home;
const fixtureArtifact = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "plan_contract_fixture.json"), "utf8"));

const config = { egmReview: { enabled: true, backend: "glm-goldfish", versionSha: "5ba5afa03f62627639fa4f71b7ac3bd4d8d07e24", maxReviewsPerDay: 1 } };
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify(config, null, 2));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence v1\n");
saveState(root, emptyState());
fs.mkdirSync(path.join(home, ".atl"), { recursive: true });
fs.writeFileSync(path.join(home, ".atl", "providers.json"), JSON.stringify({ providers: { test: { id: "test", label: "Test", worker: "claude", base_url: "https://example.test", api_key: "fixture", model: "fixture" } } }));

const CONSOLIDATED = "# Consolidated EGM Review Report\n\n## Verdict\n\nnot ready for implementation.\n\n## Action items by priority\n\n### 🔴 Blockers\n\n#### A1 — Bound the scope\n\nState the out-of-scope surface.\n";

const fakeRunner = async (rootArg, { draft }) => {
  const workdir = path.join(draft.dir, "egm", `fake-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(workdir, { recursive: true });
  for (const name of ["zoom_out_report.md", "comprehension_report.md", "critic_report.md", "intermediate_zoom_out_report.md", "implementation_readiness_report.md", "consolidated_review_report.md"]) {
    fs.writeFileSync(path.join(workdir, name), name === "consolidated_review_report.md" ? CONSOLIDATED : `# ${name}\n`);
  }
  return { workdir, exitCode: 0, durationMs: 1, lastMessage: "ok" };
};

const server = await startControlPlaneServer(root, { egmRunner: fakeRunner });
const post = async (route, body) => {
  const response = await fetch(`${server.url}${route.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

try {
  const draft = savePlanDraft(root, { intent: fixtureArtifact.objective, artifact: fixtureArtifact });
  const draftDir = path.dirname(draft.artifactPath);
  const lockFile = path.join(draftDir, "review.lock");

  // A lock held by a live process refuses the review before any spend.
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
  const locked = await post("/api/plan/review", { draftId: draft.id, provider: "test", reviewType: "egm" });
  assert.equal(locked.status, 409, JSON.stringify(locked.body));
  assert.match(locked.body.error, /already running for this plan draft/);
  const readLedger = () => { try { return JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "plan-review-usage.json"), "utf8")).started ?? 0; } catch { return 0; } };
  const ledgerAfterLock = readLedger();
  assert.equal(ledgerAfterLock, 0, "a lock-conflict review must not consume the daily budget");

  // A stale lock from a dead runtime is recovered; the review runs and the
  // daily ledger counts exactly one start.
  const exited = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await new Promise((resolve) => exited.on("close", resolve));
  fs.writeFileSync(lockFile, JSON.stringify({ pid: exited.pid, created_at: new Date().toISOString() }));
  const first = await post("/api/plan/review", { draftId: draft.id, provider: "test", reviewType: "egm" });
  assert.equal(first.status, 200, JSON.stringify(first.body).slice(0, 300));
  assert.equal(first.body.review.kind, "egm");
  assert.equal(fs.existsSync(lockFile), false, "the lock is released after the review");
  const ledger = JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "plan-review-usage.json"), "utf8"));
  assert.equal(ledger.started, 1, "one deep review started");

  // The daily budget refuses the second deep review before any spend.
  const second = await post("/api/plan/review", { draftId: draft.id, provider: "test", reviewType: "egm" });
  assert.equal(second.status, 429, JSON.stringify(second.body));
  assert.match(second.body.error, /daily budget is exhausted/);
  assert.match(second.body.error, /15–25 minutes/);
  assert.equal(readLedger(), 1, "a refused review consumes nothing");

  // The cheap ATL accuracy review is not budget-gated.
  const pending = [];
  const atlServer = await startControlPlaneServer(root, { planningInvoke: async () => ({ code: 0, provider: "test", model: "m", text: JSON.stringify({ verdict: "blocked", findings: [{ severity: "minor", message: "note" }] }) }) });
  const atlReview = await fetch(`${atlServer.url}api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draft.id, provider: "test" }) });
  assert.equal(atlReview.status, 200, `ATL review unaffected by the deep-review budget: ${JSON.stringify(await atlReview.json()).slice(0, 200)}`);
  await new Promise((resolve) => atlServer.server.close(resolve));

  console.log("PASS: review gate — live-lock refusal costs nothing, stale-lock recovery, daily budget counts started reviews only, ATL review ungated");
} finally {
  await new Promise((resolve) => server.server.close(resolve));
  if (priorHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = priorHome;
  if (priorHomePosix === undefined) delete process.env.HOME;
  else process.env.HOME = priorHomePosix;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
