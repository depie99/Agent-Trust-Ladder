import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { intakeFromAzure } from "../runtime/lib/intake.mjs";
import {
  azureTasksFromExport,
  fetchAzureTasks,
  reconcileAzureTasks,
} from "../skills/atl/scripts/azure-intake.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-azure-skills-"));
const cfg = {
  org_url: "https://devops.example.invalid:32678/Solico-Group",
  project: "Middleware-and-Portals",
  iteration_path: "Middleware-and-Portals\\Sprint 74",
  token_env: "ATL_SYNTHETIC_AZURE_PAT",
  repository: "example/middleware",
};
const write = (name, value) => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
const calls = [];
const requestImpl = async (url, options) => {
  calls.push({ url, ...options });
  if (url.includes("/wiql?")) return { workItems: [{ id: 741 }] };
  return { value: [{
    id: 741,
    fields: {
      "System.Rev": 3,
      "System.Title": "Repair middleware retry status",
      "System.WorkItemType": "Bug",
      "System.State": "New",
      "System.Description": "<p>An interrupted task resumes with accurate status.</p>",
      "Microsoft.VSTS.Common.Priority": 1,
    },
  }] };
};

try {
  await assert.rejects(() => fetchAzureTasks(cfg, { requestImpl, env: {} }), /personal access token/);
  assert.equal(calls.length, 0, "missing authorization fails before transport");
  const env = { ATL_SYNTHETIC_AZURE_PAT: "synthetic-only" };
  const portable = await fetchAzureTasks(cfg, { requestImpl, env });
  process.env.ATL_SYNTHETIC_AZURE_PAT = "synthetic-only";
  const runtime = await intakeFromAzure(cfg, { requestImpl });
  assert.deepEqual(portable, runtime, "Control Plane and skills-only paths normalize the same Azure task");
  assert.equal(portable[0].source.repository, "example/middleware");
  assert.equal(portable[0].source.remote_id, 741);
  assert.equal(portable[0].source.revision, 3);
  assert.equal(portable[0].source.frozen, false);
  assert.ok(calls.every((call) => call.method === "POST"), "intake only issues read-query POST requests");
  assert.ok(!JSON.stringify(portable).includes("synthetic-only"), "the PAT never enters candidate output");

  const exported = azureTasksFromExport({ value: [{ id: 741, fields: { "System.Rev": 3, "System.Title": "Repair middleware retry status", "System.WorkItemType": "Bug" } }] }, cfg);
  assert.equal(exported[0].source.frozen, true);
  assert.equal(exported[0].source.revision, 3);

  const unchanged = reconcileAzureTasks({
    "T-001": { id: "T-001", status: "assigned", intake_key: portable[0].intake_key, source: portable[0].source },
  }, portable);
  assert.equal(unchanged.unchanged.length, 1);
  assert.equal(unchanged.create.length, 0);
  const changedCandidate = structuredClone(portable[0]);
  changedCandidate.source.revision = 4;
  changedCandidate.intake_key = changedCandidate.intake_key.replace(/:3$/, ":4");
  const activeChange = reconcileAzureTasks({
    "T-001": { id: "T-001", status: "in_progress", intake_key: portable[0].intake_key, source: portable[0].source },
  }, [changedCandidate]);
  assert.equal(activeChange.changed[0].action, "preserve-and-review");

  write("azure-config.json", `${JSON.stringify({ ...cfg, token_env: "ATL_SYNTHETIC_AZURE_PAT" }, null, 2)}\n`);
  write("work-items.json", `${JSON.stringify({ value: [{ id: 741, fields: { "System.Rev": 3, "System.Title": "Repair middleware retry status", "System.WorkItemType": "Bug" } }] }, null, 2)}\n`);
  const helper = path.join(project, "skills", "atl-frame", "scripts", "azure-intake.mjs");
  assert.ok(fs.existsSync(helper), "generated mode skill must bundle the Azure intake helper");
  assert.ok(fs.existsSync(path.join(project, "skills", "atl-frame", "references", "azure-intake.md")), "generated mode skill must bundle the Azure intake reference");
  execFileSync(process.execPath, [helper, "from-export", "work-items.json", "--org-url", cfg.org_url, "--project", cfg.project, "--iteration-path", cfg.iteration_path, "--repository", cfg.repository, "--output", "tasks.json"], { cwd: root });
  const cliOutput = JSON.parse(fs.readFileSync(path.join(root, "tasks.json"), "utf8"));
  assert.equal(cliOutput.frozen, true);
  assert.equal(cliOutput.tasks[0].source.frozen, true);
  assert.equal(cliOutput.tasks[0].source.remote_id, 741);

  const revoked = async () => { throw new Error("HTTP 401 from devops.example.invalid: unauthorized"); };
  await assert.rejects(() => fetchAzureTasks(cfg, { requestImpl: revoked, env }), /401/);
  const missing = async (url) => url.includes("/wiql?") ? { workItems: [] } : { value: [] };
  assert.deepEqual(await fetchAzureTasks(cfg, { requestImpl: missing, env }), []);

  console.log("PASS: live and frozen Azure intake normalize identically, deduplicate unchanged revisions, preserve active changes and bundle the skills-only helper");
} finally {
  delete process.env.ATL_SYNTHETIC_AZURE_PAT;
  fs.rmSync(root, { recursive: true, force: true });
}
