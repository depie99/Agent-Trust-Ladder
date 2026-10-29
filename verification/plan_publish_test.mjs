import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask, emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { reviewPlanArtifact, savePlanDraft } from "../runtime/lib/plan-studio.mjs";
import { previewPlanPublish, publishPlan, verifyImportedSource } from "../runtime/lib/plan-publish.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-publish-"));
const oldGithub = process.env.GITHUB_TOKEN, oldAzure = process.env.AZDO_PAT;
process.env.GITHUB_TOKEN = "test-github-token"; process.env.AZDO_PAT = "test-azure-token";
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "plan_publish_test.mjs"), "// verifier fixture\n");
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { org_url: "https://dev.azure.test/org", project: "Demo", token_env: "AZDO_PAT" } } }));
saveState(root, emptyState());
const artifact = { plan_contract_version: 2, title: "Publish test", objective: "Reviewed work", requirements: [{ id: "r1", text: "A task is published", source: "test" }], constraints: [], observed_evidence: [], assumptions: [], open_questions: [], risks: [], completion_checks: ["published"], acceptance_examples: [{ given: "a reviewed task", when: "published", then: "a remote record exists" }], selected_skills: ["atl-verify"], skill_route: [], proposed_worker: "pip", implementation_steps: [{ step: "Prepare a task", files: [], verify: "node verification/plan_publish_test.mjs" }], verifier_commands: ["node verification/plan_publish_test.mjs"], task_proposals: [{ id: "p1", title: "Publish task", objective: "Publish the reviewed task", instructions: "Publish the reviewed task with its objective and acceptance checks to the selected destination.", deliverables: ["remote task"], requirement_ids: ["r1"], completion_checks: ["remote task is visible"], selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Confirms the publish adapter's observable result." }, depends_on: [], files: [], verify: "node verification/plan_publish_test.mjs" }] };
const draft = savePlanDraft(root, { intent: "Publish work", artifact, stage: "plan" });
reviewPlanArtifact(root, draft.id, { verdict: "passed", findings: [] });
let calls = 0, remoteGithub = null;
const githubFetch = async (url, options = {}) => {
  calls++;
  const method = options.method || "GET";
  if (method === "POST") { remoteGithub = { number: 11, html_url: "https://github.com/acme/demo/issues/11", updated_at: "t1" }; return response(remoteGithub); }
  if (method === "GET") return response(remoteGithub);
  if (method === "PATCH") { remoteGithub = { ...remoteGithub, ...JSON.parse(options.body), updated_at: "t2" }; return response(remoteGithub); }
  throw new Error(`unexpected method ${method} ${url}`);
};
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: "ok", text: async () => JSON.stringify(body) });
const importedState = loadState(root);
const importedTask = createTask(importedState, { title: "Imported issue", source: { type: "github", repo: "acme/demo", remote_id: 7, revision: "source-r1" }, intake_key: "github:7", plan_review_required: true });
saveState(root, importedState, { expectedRevision: importedState.revision || 0 });
assert.equal((await verifyImportedSource(root, importedTask.id, { fetchImpl: async () => response({ updated_at: "source-r1" }) })).current, true, "GitHub import review verifies the captured remote revision");
await assert.rejects(() => verifyImportedSource(root, importedTask.id, { fetchImpl: async () => response({ updated_at: "source-r2" }) }), /changed since intake/);
const destination = { type: "github", repo: "acme/demo" };
const ghPreview = await previewPlanPublish(root, draft.id, destination);
assert.equal(calls, 0, "preview does not write remotely when creating items");
await assert.rejects(() => publishPlan(root, draft.id, destination, ghPreview.token, { fetchImpl: githubFetch }), /explicit confirmation/);
assert.equal(calls, 0, "an unconfirmed publish makes no remote calls");
const first = await publishPlan(root, draft.id, destination, ghPreview.token, { confirm: true, fetchImpl: githubFetch });
assert.equal(first.results[0].id, 11);
assert.equal(calls, 1);
const retryPreview = await previewPlanPublish(root, draft.id, destination, { fetchImpl: githubFetch });
const retry = await publishPlan(root, draft.id, destination, retryPreview.token, { confirm: true, fetchImpl: githubFetch });
assert.equal(retry.results[0].id, 11, "a retry updates the mapped issue rather than creating a duplicate");
const conflictFetch = async () => response({ ...remoteGithub, updated_at: "external-change" });
await assert.rejects(() => publishPlan(root, draft.id, destination, retryPreview.token, { confirm: true, fetchImpl: conflictFetch }), /changed remotely/);

const azurePreview = await previewPlanPublish(root, draft.id, { type: "azure" });
let azureCreated = false;
const azureFetch = async (url, options = {}) => {
  if (options.method === "POST") { azureCreated = true; return response({ id: 42, url: "https://dev.azure.test/org/Demo/_workitems/edit/42", rev: 1 }); }
  throw new Error(`unexpected Azure method ${options.method || "GET"} ${url}`);
};
const azure = await publishPlan(root, draft.id, { type: "azure" }, azurePreview.token, { confirm: true, fetchImpl: azureFetch });
assert.equal(azureCreated, true);
assert.equal(azure.results[0].id, 42);
console.log("Plan publishing preview, confirmation, retry mapping, and conflict checks passed.");
if (oldGithub === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldGithub;
if (oldAzure === undefined) delete process.env.AZDO_PAT; else process.env.AZDO_PAT = oldAzure;
fs.rmSync(root, { recursive: true, force: true });
