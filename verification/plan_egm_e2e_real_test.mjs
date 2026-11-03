import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { savePlanDraft, loadPlanDraft, approvePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// REAL end-to-end: this test invokes the actual codex CLI with the EGM plugin
// in the isolated home. It needs ChatGPT auth (auth.json in that home) and
// spends a real uninterrupted review (~1M input tokens, mostly cached, ~4 min).
// It is skipped unless ATL_EGM_E2E=1 is set.
const skip = process.env.ATL_EGM_E2E !== "1";
if (skip) { console.log("SKIP: set ATL_EGM_E2E=1 to run the real EGM end-to-end test"); process.exit(0); }

const root = process.env.ATL_EGM_E2E_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "atl-egm-e2e-"));
const egmHome = process.env.ATL_EGM_E2E_CODEX_HOME;
if (!egmHome) { console.log("SKIP: set ATL_EGM_E2E_CODEX_HOME to the isolated codex home with the egm plugin"); process.exit(0); }

fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ egmReview: { enabled: true, codexHome: egmHome, model: process.env.ATL_EGM_E2E_MODEL || "gpt-5.6-sol", versionSha: process.env.ATL_EGM_E2E_SHA || "5ba5afa03f62627639fa4f71b7ac3bd4d8d07e24", maxMinutes: 25 } }, null, 2));
fs.writeFileSync(path.join(root, "verification", "delivery.test.mjs"), "import assert from 'node:assert/strict';\nconsole.log('delivery verifier placeholder');\n");
saveState(root, emptyState());

const artifact = {
  plan_contract_version: 2,
  title: "Add a durable delivery queue",
  objective: "Persist incoming delivery requests and send them to a configured remote endpoint with retries, logging failures for operators.",
  requirements: [
    { id: "r1", text: "POST /deliveries persists each request before responding", source: "original request" },
    { id: "r2", text: "A background worker delivers persisted requests and retries failures with bounded attempts", source: "original request" },
    { id: "r3", text: "Operators can see failed deliveries and the observable state of each request", source: "original request" },
  ],
  constraints: ["No new infrastructure services; use the existing Node process and a file-backed or embedded store", "Keep execution behind explicit owner confirmation"],
  observed_evidence: [{ description: "Existing verifier", path: "verification/delivery.test.mjs" }],
  assumptions: ["Delivery targets are fixed at configuration time"],
  open_questions: [
    { id: "q1", question: "Is delivery at-most-once or at-least-once?", resolved: false },
    { id: "q2", question: "Which persistence store is used for deliveries?", resolved: false },
  ],
  risks: ["Duplicate delivery on ambiguous caller timeouts", "Worker concurrency is undefined"],
  completion_checks: ["The requested behavior is observable from the real user-facing surface", "Failure and recovery behavior remain explicit and auditable"],
  acceptance_examples: [
    { given: "a delivery request is submitted", when: "the endpoint answers", then: "the request is durable and visible" },
    { given: "the remote endpoint fails twice then succeeds", when: "the worker retries", then: "the delivery finally records a terminal success state" },
  ],
  selected_skills: ["atl-verify"], proposed_worker: "pip", skill_route: [],
  implementation_steps: [
    { step: "Specify the delivery state machine and contracts", files: ["docs/delivery.md"], verify: "Review the documented state transitions against acceptance examples" },
    { step: "Implement the endpoint, worker, and store", files: ["src/delivery.js"], verify: "node verification/delivery.test.mjs" },
  ],
  verifier_commands: ["node verification/delivery.test.mjs"],
  task_proposals: [
    { id: "p1", title: "Specify delivery contracts", objective: "Specify the delivery state machine and contracts.\n\nOverall request:\nPersist incoming delivery requests and send them to a configured remote endpoint with retries.", instructions: "Write docs/delivery.md defining request identity, durable states and transitions, retry classification, and operator-visible status fields.", deliverables: ["docs/delivery.md"], requirement_ids: ["r1"], completion_checks: ["docs/delivery.md defines the state machine and contracts"], proposed_worker: "rowan", selected_skills: ["atl-specify"], skill_reasons: { "atl-specify": "Bounds observable behavior before implementation." }, depends_on: [], files: ["docs/delivery.md"], verify: "Review documented state transitions against acceptance examples" },
    { id: "p2", title: "Implement delivery queue", objective: "Implement the endpoint, worker, and store.\n\nOverall request:\nPersist incoming delivery requests and send them to a configured remote endpoint with retries.", instructions: "Implement src/delivery.js per docs/delivery.md with tests in verification/delivery.test.mjs covering success, retry, and terminal failure.", deliverables: ["src/delivery.js", "verification/delivery.test.mjs"], requirement_ids: ["r2", "r3"], completion_checks: ["node verification/delivery.test.mjs passes", "failed deliveries are visible to operators"], proposed_worker: "pip", selected_skills: ["atl-implement"], skill_reasons: { "atl-implement": "Bounded implementation against the specified contracts." }, depends_on: ["p1"], files: ["src/delivery.js", "verification/delivery.test.mjs"], verify: "node verification/delivery.test.mjs" },
  ],
};

const draft = savePlanDraft(root, { intent: artifact.objective, artifact });
const server = await startControlPlaneServer(root, {});
console.log("E2E root:", root, "draft:", draft.id);
const started = Date.now();
// An uninterrupted EGM review runs for minutes; undici's default headers
// timeout kills a fetch before it finishes, so use http.request directly.
import http from "node:http";
const requestPath = "/api/plan/review";
const response = await new Promise((resolve, reject) => {
  const request = http.request({ host: "127.0.0.1", port: server.port, path: requestPath, method: "POST", headers: { "content-type": "application/json" } }, resolve);
  request.on("error", reject);
  request.end(JSON.stringify({ draftId: draft.id, reviewType: "egm" }));
});
const body = await new Promise((resolve, reject) => {
  let text = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => { text += chunk; });
  response.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
  response.on("error", reject);
});
const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log(`EGM review HTTP ${response.status} after ${minutes} min`);
if (!body.ok) { console.log("error:", body.error, body.workdir || ""); process.exit(1); }
const review = body.review;
console.log("kind:", review.kind, "verdict:", review.verdict, "findings:", review.findings.length, "egm sha:", review.egm?.version_sha?.slice(0, 12), "duration_ms:", review.egm?.duration_ms);
console.log("first finding:", review.findings.length ? JSON.stringify(review.findings[0]).slice(0, 400) : "(no findings)");
const loaded = loadPlanDraft(root, draft.id);
assert.equal(loaded.review.kind, "egm");
assert.ok(fs.existsSync(review.egm.workdir + path.sep + "consolidated_review_report.md"), "consolidated report preserved beside the draft");
assert.throws(() => approvePlanDraft(root, draft.id), /accuracy review/, "approval gate consults the EGM review");
console.log("PASS: real EGM end-to-end review committed and gated");
await new Promise((resolve) => server.server.close(resolve));
