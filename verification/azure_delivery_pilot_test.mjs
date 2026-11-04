// Deterministic paired pilot: one frozen Azure item, a skills-only installation
// without manager state, a bounded batch, and receipts that agree with the
// runtime projection of the same record. No live provider call is made.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { azureTasksFromExport, fetchAzureTasks, reconcileAzureTasks } from "../skills/atl/scripts/azure-intake.mjs";
import { buildDeliveryReceipt, evaluateDeliveryReceipt } from "../skills/atl/scripts/developer-delivery.mjs";
import { snapshot } from "../runtime/lib/handoffs.mjs";
import { taskDeliveryReceiptFromRecord } from "../runtime/lib/delivery.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "atl-pilot-fixture-"));
const manager = fs.mkdtempSync(path.join(os.tmpdir(), "atl-pilot-manager-"));
const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-pilot-base-"));
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-pilot-out-"));
const write = (dir, name, value) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const cfg = {
  org_url: "https://devops.example.invalid:32678/Solico-Group",
  project: "Middleware-and-Portals",
  iteration_path: "Middleware-and-Portals\\Sprint 74",
  token_env: "ATL_SYNTHETIC_AZURE_PAT",
  repository: "example/middleware",
};
const checkId = "value is fixed and persisted";
const files = {
  "src/value.txt": "broken\n",
  "verification/accept.mjs": `import fs from "node:fs";\nconst value = fs.readFileSync("src/value.txt", "utf8").trim();\nif (value === "ok") { console.log("value=ok"); } else { console.error("value=" + value); process.exit(1); }\n`,
  "verification/readback.mjs": `import fs from "node:fs";\nfs.mkdirSync(".atl-evidence", { recursive: true });\nfs.writeFileSync(".atl-evidence/result.json", JSON.stringify({ value: fs.readFileSync("src/value.txt", "utf8").trim() }));\nconst stored = JSON.parse(fs.readFileSync(".atl-evidence/result.json", "utf8"));\nconsole.log(stored.value === "ok" ? "persisted=ok" : "persisted=" + stored.value);\nprocess.exit(stored.value === "ok" ? 0 : 1);\n`,
};
const manifest = {
  version: 1,
  id: "pilot-value",
  owner: "rowan",
  tools: ["node"],
  prerequisites: [{ files: ["src/value.txt", "verification/accept.mjs"], command: ["node", "--check", "verification/accept.mjs"] }],
  baseline: { commands: [["node", "--check", "verification/readback.mjs"]] },
  checks: [{
    id: checkId,
    command: ["node", "verification/accept.mjs"],
    expected: { exit_code: 0, stdout_includes: "value=ok" },
    readback: { command: ["node", "verification/readback.mjs"], expected: { exit_code: 0, stdout_includes: "persisted=ok" } },
    artifacts: [".atl-evidence/result.json"],
  }],
  content: Object.keys(files),
  evidence: ".atl-evidence/project-verifier.json",
};

try {
  // 1) Skills-only installation: no Control Plane service and no manager state.
  for (const skill of ["atl", "atl-implement", "atl-verify"]) fs.cpSync(path.join(project, "skills", skill), path.join(fixture, ".agents", "skills", skill), { recursive: true });
  const installed = path.join(fixture, ".agents", "skills", "atl-implement");
  for (const bundled of ["scripts/developer-delivery.mjs", "scripts/project-verifier.mjs", "scripts/batch-runner.mjs", "references/developer-delivery.md", "references/overnight-batch.md"]) {
    assert.ok(fs.existsSync(path.join(installed, bundled)), `the installed skill bundles ${bundled}`);
  }
  assert.equal(fs.existsSync(path.join(fixture, ".trust")), false, "the skills-only fixture starts without manager state");

  // 2) Authorization is explicit; a frozen export is labeled as frozen.
  await assert.rejects(() => fetchAzureTasks(cfg, { requestImpl: async () => { throw new Error("transport must not run"); }, env: {} }), /personal access token/);
  const exported = azureTasksFromExport({ value: [{ id: 741, fields: { "System.Rev": 3, "System.Title": checkId, "System.WorkItemType": "Bug", "System.State": "New", "System.Description": "<p>Fix the persisted value.</p>" } }] }, cfg);
  assert.equal(exported[0].source.frozen, true, "a supplied export is a frozen snapshot, not a live sync");
  assert.equal(exported[0].source.remote_id, 741);
  assert.equal(exported[0].source.revision, 3);
  const replay = reconcileAzureTasks({ "T-001": { id: "T-001", status: "assigned", intake_key: exported[0].intake_key, source: exported[0].source } }, exported);
  assert.equal(replay.unchanged.length, 1, "re-importing an unchanged item creates no duplicate task");

  // 3) Readiness and the genuine broken/fixed verifier run, skills-only.
  for (const [name, value] of Object.entries(files)) write(fixture, name, value);
  write(fixture, ".atl-verifier.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const verifier = path.join(installed, "scripts", "project-verifier.mjs");
  const run = () => {
    try { return { code: 0, output: execFileSync(process.execPath, [verifier, "run", ".atl-verifier.json"], { cwd: fixture, encoding: "utf8" }) }; }
    catch (error) { return { code: error.status, output: `${error.stdout || ""}${error.stderr || ""}` }; }
  };
  const broken = run();
  assert.equal(broken.code, 2, "the deliberately broken behavior fails the declared verifier");
  write(fixture, "src/value.txt", "ok\n");
  const fixed = run();
  assert.equal(fixed.code, 0, "the genuine fix passes with an independent readback");
  assert.match(fixed.output, /value=ok/);
  assert.match(fixed.output, /persisted=ok/);

  // 4) A bounded batch records the same acceptance check without a manager.
  const checkpoint = path.join(fixture, ".atl-evidence", "pilot-batch.json");
  const batchCli = path.join(installed, "scripts", "batch-runner.mjs");
  execFileSync(process.execPath, [batchCli, "create", checkpoint, "--id", "pilot", "--tasks", "T-001,T-002", "--minutes", "60", "--attempts", "1"], { cwd: fixture });
  for (const task of ["T-001", "T-002"]) {
    execFileSync(process.execPath, [batchCli, "claim", checkpoint, task], { cwd: fixture });
    execFileSync(process.execPath, [batchCli, "settle", checkpoint, task, "succeeded", "--reason", "verified locally"], { cwd: fixture });
  }
  const summary = execFileSync(process.execPath, [batchCli, "summary", checkpoint], { cwd: fixture, encoding: "utf8" });
  assert.match(summary, /Status: \*\*complete\*\*/);
  assert.match(summary, /must stay available/);

  // 5) The same record yields the same revision-bound verdict on both surfaces.
  for (const [name, value] of Object.entries(files)) write(baselineDir, name, value);
  for (const [name, value] of Object.entries(files)) write(outputDir, name, name === "src/value.txt" ? "ok\n" : value);
  const baseSnapshot = snapshot(manager, baselineDir);
  const outputSnapshot = snapshot(manager, outputDir);
  assert.ok(outputSnapshot.revision);

  const receiptInput = {
    task: { id: "T-001", source: exported[0].source },
    content: { files: outputSnapshot.files, modes: outputSnapshot.modes },
    checks: [{ id: checkId, result: "pass", coverage: "complete", content_revision: outputSnapshot.revision, command: "node verification/accept.mjs", verified_by: "beacon" }],
    review: { result: "approve", content_revision: outputSnapshot.revision, reviewer: "sage", independent: true },
    changes: [{ path: "src/value.txt", status: "modified" }],
    host: { capabilities: { execution: true, independent_review: true, visual_observation: false, budget_enforcement: false } },
    usage: { coverage: "unknown" },
  };
  const portable = buildDeliveryReceipt(receiptInput);
  const runtimeTask = {
    id: "T-001",
    packet_revision: 1,
    completion_checks: [checkId],
    evidence: [
      { kind: "check", check: checkId, result: "pass", coverage: "complete", code_revision: outputSnapshot.revision, command: "node verification/accept.mjs", actor: "beacon", packet_revision: 1 },
      { kind: "review", result: "approve", code_revision: outputSnapshot.revision, actor: "sage", packet_revision: 1 },
    ],
  };
  const record = { baseline: baseSnapshot, output: outputSnapshot, changed_files: ["src/value.txt"] };
  const runtime = taskDeliveryReceiptFromRecord(runtimeTask, record);
  assert.equal(runtime.receipt.content.revision, portable.content.revision, "both surfaces bind the same content revision");
  assert.equal(runtime.verdict.status, evaluateDeliveryReceipt(portable).status);
  assert.equal(runtime.verdict.status, "verified-local");

  const withoutReview = structuredClone(runtimeTask);
  withoutReview.evidence = withoutReview.evidence.filter((entry) => entry.kind !== "review");
  const runtimeNoReview = taskDeliveryReceiptFromRecord(withoutReview, record);
  const portableNoReview = buildDeliveryReceipt({ ...receiptInput, review: null });
  assert.equal(runtimeNoReview.verdict.status, "review-required", "an absent independent review is not fabricated");
  assert.equal(evaluateDeliveryReceipt(portableNoReview).status, runtimeNoReview.verdict.status, "both surfaces report the same missing-review verdict");

  // 6) The corrected content stales the earlier receipt on both surfaces.
  write(fixture, "src/value.txt", "ok\n");
  write(fixture, "verification/accept.mjs", `${files["verification/accept.mjs"]}// touched after verification\n`);
  const touched = snapshot(manager, fixture);
  assert.notEqual(touched.revision, outputSnapshot.revision);
  assert.equal(evaluateDeliveryReceipt(portable, { observedContentRevision: touched.revision }).status, "incomplete");

  console.log("PASS: paired pilot — frozen Azure intake, skills-only verifier and bounded batch, runtime/portable receipt parity, stale content and an explicit live gate");
} finally {
  for (const dir of [fixture, manager, baselineDir, outputDir]) fs.rmSync(dir, { recursive: true, force: true });
}
