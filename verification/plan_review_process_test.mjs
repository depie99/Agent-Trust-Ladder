import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { loadPlanDraft, savePlanDraft, reviewPlanArtifact } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const runtimeDir = path.join(repoRoot, "runtime", "lib");

// Child processes import the runtime through a file URL so the scripts can
// live in the per-test temp root and be deleted with it.
const REVIEW_WAIT_CHILD = `
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [runtimeDir, root, home, draftId] = process.argv.slice(2);
process.env.USERPROFILE = home;
const { startControlPlaneServer } = await import(pathToFileURL(path.join(runtimeDir, "control-plane-server.mjs")).href);
const pending = [];
const planningInvoke = ({ request }) => new Promise((resolve) => pending.push({ request, resolve }));
const server = await startControlPlaneServer(root, { planningInvoke });
const origin = server.url.endsWith("/") ? server.url.slice(0, -1) : server.url;
// The HTTP response only resolves when the provider answers, so the review
// request is fired without awaiting it; the barrier is the provider call
// itself being in flight.
fetch(origin + "/api/plan/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId, provider: "test" }) }).catch(() => {});
while (pending.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
console.log("BARRIER");
setInterval(() => {}, 1 << 30);
`;

const APPROVE_CHILD = `
import { pathToFileURL } from "node:url";
import path from "node:path";
const [runtimeDir, root, home, draftId] = process.argv.slice(2);
process.env.USERPROFILE = home;
const { approvePlanDraft } = await import(pathToFileURL(path.join(runtimeDir, "plan-studio.mjs")).href);
try {
  const result = approvePlanDraft(root, draftId);
  console.log("RESULT " + JSON.stringify({ created: result.created, queueId: result.queueId, taskIds: result.taskIds }));
} catch (error) {
  console.log("RESULT " + JSON.stringify({ created: null, error: String(error.message) }));
}
`;

const fixtureArtifact = {
  plan_contract_version: 2,
  title: "Process level review fixture",
  objective: "Survive process death and cross-process approval",
  requirements: [{ id: "r1", text: "Approval survives process boundaries", source: "original request" }],
  constraints: [],
  observed_evidence: [{ description: "Fixture verifier", path: "verification/fixture.mjs" }],
  assumptions: [], open_questions: [], risks: [],
  completion_checks: ["Process death leaves no review", "Cross-process approval never duplicates tasks"],
  acceptance_examples: [{ given: "a killed runtime", when: "the draft is reloaded", then: "no passing review is attached" }],
  selected_skills: ["atl-verify"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [{ step: "Verify process boundaries", files: ["verification/fixture.mjs"], verify: "node verification/fixture.mjs" }],
  verifier_commands: ["node verification/fixture.mjs"],
  task_proposals: [{ id: "p1", title: "Verify process boundaries", objective: "Survive process death and cross-process approval", instructions: "Verify process-level restart and cross-process approval serialization for plan drafts.", deliverables: ["process boundary regression coverage"], requirement_ids: ["r1"], completion_checks: ["Process death leaves no review"], proposed_worker: "pip", selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Verifies the review invariants." }, depends_on: [], files: ["verification/fixture.mjs"], verify: "node verification/fixture.mjs" }],
};

const node = process.execPath;
const launch = (script, args) => {
  const child = spawn(node, [script, ...args], { stdio: ["ignore", "pipe", "pipe"], cwd: repoRoot });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve) => child.on("close", (code) => resolve({ code, stdout, stderr })));
  return { pid: child.pid, stdout: () => stdout, stderr: () => stderr, closed };
};
const waitFor = async (predicate, describe, extra) => {
  for (let i = 0; i < 400 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 25));
  if (!predicate()) throw new Error(`${describe}: ${extra()}`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-process-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-process-home-"));
const priorHome = process.env.USERPROFILE;
process.env.USERPROFILE = home;

try {
  fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
  fs.mkdirSync(path.join(root, "verification"), { recursive: true });
  fs.mkdirSync(path.join(home, ".atl"), { recursive: true });
  fs.writeFileSync(path.join(home, ".atl", "providers.json"), JSON.stringify({ providers: { test: { id: "test", label: "Test", worker: "claude", base_url: "https://example.test", api_key: "fixture", model: "fixture" } } }));
  fs.writeFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence v1\n");
  saveState(root, emptyState());
  fs.writeFileSync(path.join(root, "review-wait-child.mjs"), REVIEW_WAIT_CHILD);
  fs.writeFileSync(path.join(root, "approve-child.mjs"), APPROVE_CHILD);
  const draft = savePlanDraft(root, { intent: fixtureArtifact.objective, artifact: fixtureArtifact });

  // R06 (real): kill the runtime while a review request is in flight and the
  // provider never answers. The draft must carry no review and hold no lock,
  // and a fresh review must commit and approve normally afterwards.
  const child = launch(path.join(root, "review-wait-child.mjs"), [runtimeDir, root, home, draft.id]);
  waitFor(() => child.stdout().includes("BARRIER"), "review child never reached the provider barrier", () => child.stdout() + child.stderr());
  const kill = spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)]);
  await new Promise((resolve) => kill.on("close", resolve));
  const killed = await child.closed;
  assert.notEqual(killed.code, 0, "the runtime process was force-terminated");

  const after = loadPlanDraft(root, draft.id);
  assert.equal(after.review, undefined, "a killed runtime leaves no review attached");
  assert.equal(fs.existsSync(path.join(after.dir, "artifact.lock")), false, "no commit lock survives process death");
  // Fresh runtime: review commits and approval proceeds on the same draft.
  const pending = [];
  const planningInvoke = ({ request }) => new Promise((resolve) => pending.push({ request, resolve }));
  const server = await startControlPlaneServer(root, { planningInvoke });
  const reviewResponse = fetch(`${server.url.endsWith("/") ? server.url.slice(0, -1) : server.url}/api/plan/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draft.id, provider: "test" }) });
  for (let i = 0; i < 400 && pending.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  if (!pending.length) throw new Error("fresh review never reached the provider");
  pending.shift().resolve({ code: 0, provider: "test", model: "fixture", text: JSON.stringify({ verdict: "passed", findings: [] }) });
  const reviewBody = await (await reviewResponse).json();
  const approvedDraft = reviewBody.draft;
  assert.equal(reviewBody.ok, true, `fresh review failed: ${JSON.stringify(reviewBody)}`);
  assert.equal(approvedDraft.review.verdict, "passed");
  await new Promise((resolve) => server.server.close(resolve));

  // R04 (real): two independent processes approve the same draft concurrently.
  const results = await Promise.all([
    launch(path.join(root, "approve-child.mjs"), [runtimeDir, root, home, draft.id]).closed,
    launch(path.join(root, "approve-child.mjs"), [runtimeDir, root, home, draft.id]).closed,
  ]);
  const parsed = results.map((result) => {
    const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith("RESULT "));
    assert.ok(line, `approve child produced no result: ${result.stdout} ${result.stderr}`);
    return JSON.parse(line.slice("RESULT ".length));
  });
  const createdOnes = parsed.filter((entry) => entry.created === true);
  const benignOnes = parsed.filter((entry) => entry.created === false || (entry.created === null && /changed or is being updated|conflict|stale/i.test(entry.error || "")));
  assert.equal(createdOnes.length, 1, `exactly one process may create the queue: ${JSON.stringify(parsed)}`);
  assert.equal(createdOnes.length + benignOnes.length, 2, `the losing process must not silently succeed: ${JSON.stringify(parsed)}`);
  const state = loadState(root);
  const tasks = Object.values(state.tasks).filter((task) => task.plan_draft_id === draft.id);
  assert.equal(tasks.length, 1, `cross-process approval duplicated tasks: ${tasks.map((task) => task.id).join(", ")}`);
  assert.equal(new Set(parsed.filter((entry) => entry.queueId).map((entry) => entry.queueId)).size, 1, "both processes agree on the queue id");

  console.log("PASS: real process kill during review leaves no state, cross-process approval never duplicates");
} finally {
  if (priorHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = priorHome;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
