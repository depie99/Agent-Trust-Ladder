import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { savePlanDraft, loadPlanDraft, approvePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// REAL glm-goldfish E2E: six fresh single-shot calls through ATL's planning
// seam with the configured GLM provider. Opt-in:
//   set ATL_EGM_GLM_E2E=1  (root defaults into .atl-evidence for audit)
const skip = process.env.ATL_EGM_GLM_E2E !== "1";
if (skip) { console.log("SKIP: set ATL_EGM_GLM_E2E=1 to run the real GLM end-to-end test"); process.exit(0); }

const root = process.env.ATL_EGM_GLM_E2E_ROOT || "D:/Projects/Agentic/.atl-evidence/egm-compatibility-20261103/glm-e2e-root".replaceAll("/", path.sep);
const provider = process.env.ATL_EGM_GLM_PROVIDER || "solico-glm";

fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
const CANARY = `parent-only-${Date.now()}-isolation-probe`;
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ egmReview: { enabled: true, backend: "glm-goldfish", versionSha: "5ba5afa03f62627639fa4f71b7ac3bd4d8d07e24", ownerNote: `owner-only ${CANARY}` } }, null, 2));
fs.writeFileSync(path.join(root, "verification", "delivery.test.mjs"), "console.log('delivery verifier placeholder');\n");
fs.writeFileSync(path.join(root, "verification", "fixture.mjs"), "// evidence v1\n");
saveState(root, emptyState());

const artifact = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "plan_contract_fixture.json"), "utf8"));
artifact.title = "Add a durable delivery queue";
artifact.objective = "Persist incoming delivery requests and send them to a configured remote endpoint with retries, logging failures for operators.";
if (artifact.task_proposals[1]) artifact.task_proposals[1].objective = "Implement the endpoint, worker, and store.\n\nOverall request:\nPersist incoming delivery requests and send them to a configured remote endpoint with retries.";

const draft = savePlanDraft(root, { intent: artifact.objective, artifact });
const server = await startControlPlaneServer(root, {});
console.log("GLM E2E root:", root, "draft:", draft.id, "provider:", provider);
const started = Date.now();
const response = await new Promise((resolve, reject) => {
  const request = http.request({ host: "127.0.0.1", port: server.port, path: "/api/plan/review", method: "POST", headers: { "content-type": "application/json" } }, resolve);
  request.on("error", reject);
  request.end(JSON.stringify({ draftId: draft.id, provider, reviewType: "egm" }));
});
const body = await new Promise((resolve, reject) => {
  let text = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => { text += chunk; });
  response.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
  response.on("error", reject);
});
const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log(`EGM glm-goldfish review HTTP ${response.statusCode} after ${minutes} min`);
if (!body.ok) { console.log("error:", body.error, body.workdir || ""); process.exit(1); }
const review = body.review;
console.log("kind:", review.kind, "backend:", review.egm.backend, "verdict:", review.verdict, "findings:", review.findings.length, "provider:", review.provider, "model:", review.model);
console.log("first finding:", review.findings.length ? JSON.stringify(review.findings[0]).slice(0, 300) : "(none)");
const loaded = loadPlanDraft(root, draft.id);
assert.equal(loaded.review.kind, "egm");
assert.equal(loaded.review.egm.backend, "glm-goldfish");
assert.ok(fs.existsSync(path.join(loaded.review.egm.workdir, "consolidated_review_report.md")), "consolidated report preserved beside the draft");
assert.throws(() => approvePlanDraft(root, draft.id), /accuracy review/, "approval gate consults the GLM goldfish review");
  // Isolation probe: the owner-only canary must not appear in any report, any
  // per-stage call log, or the committed artifact.
  const workdir = review.egm.workdir;
  const leaks = [];
  for (const name of fs.readdirSync(workdir)) {
    const text = fs.readFileSync(path.join(workdir, name), "utf8");
    if (text.includes(CANARY)) leaks.push(name);
  }
  const envelope = fs.readFileSync(draft.artifactPath, "utf8");
  if (envelope.includes(CANARY)) leaks.push("artifact.json");
  assert.deepEqual(leaks, [], `owner-only canary leaked into: ${leaks.join(", ")}`);
  console.log("PASS: real GLM goldfish end-to-end review committed and gated; isolation probe clean");
await new Promise((resolve) => server.server.close(resolve));
