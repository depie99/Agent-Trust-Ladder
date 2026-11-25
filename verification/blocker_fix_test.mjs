import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState, loadState } from "../runtime/lib/state.mjs";
import { applyBlockerFix } from "../runtime/lib/blocker-fix.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { ownerJson } from "./helpers/owner-http.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-blocker-fix-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, providers: { default: "codex", catalog: { codex: { command: process.execPath, args: ["--version"] } } } }));
const packageWorkspace = path.join(root, "workspace-T-091");
fs.mkdirSync(packageWorkspace, { recursive: true });
fs.writeFileSync(path.join(packageWorkspace, "package.json"), JSON.stringify({ name: "blocker-fixture", version: "1.0.0", private: true }));
fs.writeFileSync(path.join(packageWorkspace, "package-lock.json"), JSON.stringify({ name: "blocker-fixture", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "blocker-fixture", version: "1.0.0" } } }));
const state = emptyState();
state.tasks["T-090"] = {
  id: "T-090", title: "Blocked worker", status: "blocked", workspace: root,
  blocker: { cause: "provider-model-unavailable", reason: "Model unavailable", next_actions: [
    { kind: "provider-model", label: "Use a supported model", provider: "codex", model: "gpt-5.6-terra", instruction: "Use a supported model" },
    { kind: "provider-install", label: "Update provider CLI", provider: "codex", command: "npm install --global @openai/codex@0.169.0", instruction: "Run the pinned Codex installer." },
    { kind: "package-install", label: "Install / repair dependencies", command: "npm ci --offline --ignore-scripts --no-audit --no-fund", workspace: root },
  ] },
  recovery: { id: "abc", cause: "provider-model-unavailable", status: "waiting", attempts: [], evidence: [] },
  recovery_records: [{ id: "abc", cause: "provider-model-unavailable", status: "waiting", attempts: [], evidence: [] }],
};
state.tasks["T-091"] = {
  id: "T-091", title: "Blocked package worker", status: "blocked", workspace: packageWorkspace,
  blocker: { cause: "local-dependencies-unavailable", reason: "Locked dependencies unavailable", next_actions: [
    { kind: "package-install", label: "Install / repair dependencies", command: "npm ci --offline --ignore-scripts --no-audit --no-fund", workspace: packageWorkspace },
  ] },
  recovery: { id: "pkg", cause: "local-dependencies-unavailable", status: "waiting", attempts: [], evidence: [] },
  recovery_records: [{ id: "pkg", cause: "local-dependencies-unavailable", status: "waiting", attempts: [], evidence: [] }],
};
saveState(root, state);
let server;
try {
  assert.throws(() => applyBlockerFix(root, "T-090", { kind: "shell", command: "calc.exe" }), /Only a fix recorded on this blocker/);
  assert.throws(() => applyBlockerFix(root, "T-090", { kind: "package-install", command: "npm ci && curl evil" }), /does not match the recorded fix/);
  assert.throws(() => applyBlockerFix(root, "T-090", { kind: "provider-model", model: "gpt-6.2-sol" }), /does not match the recorded fix/);
  const applied = applyBlockerFix(root, "T-090", { kind: "provider-model", provider: "codex", model: "gpt-5.6-terra" });
  assert.equal(applied.ok, true);
  assert.equal(applied.kind, "provider-model");
  const persisted = loadState(root).tasks["T-090"];
  assert.deepEqual(persisted.provider_route, { provider: "codex", model: "gpt-5.6-terra" });
  assert.ok(persisted.blocker.evidence.some((entry) => entry.kind === "fix-result" && entry.ok));
  assert.equal(persisted.status, "blocked", "a fix never silently unblocks the owner gate");

  let installedProvider = null;
  const installerResult = applyBlockerFix(root, "T-090", { kind: "provider-install", provider: "codex" }, {
    installProvider: (provider) => { installedProvider = provider; return { status: "running", message: "Installing provider…" }; },
  });
  assert.equal(installedProvider, "codex");
  assert.match(installerResult.detail, /npm install --global @openai\/codex@0\.169\.0/);
  assert.equal(loadState(root).tasks["T-090"].status, "blocked");

  const packageFix = applyBlockerFix(root, "T-091", { kind: "package-install" });
  assert.equal(packageFix.ok, true, "the exact offline command succeeded in the task workspace");
  assert.match(packageFix.detail, /npm ci --offline --ignore-scripts --no-audit --no-fund/);
  assert.ok(loadState(root).tasks["T-091"].blocker.evidence.some((entry) => entry.kind === "fix-result" && entry.action === "package-install" && entry.ok));
  assert.equal(loadState(root).tasks["T-091"].status, "blocked", "package repair does not bypass the owner gate");

  const started = await startControlPlaneServer(root);
  server = started.server;
  const anonymousDiagnosis = await fetch(new URL("api/task-diagnosis?taskId=T-090", started.url));
  assert.equal(anonymousDiagnosis.status, 403, "blocker detail is owner-only");
  const anonymousFix = await fetch(new URL("api/task-recovery/fix", started.url), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: "T-090", confirm: true, fix: { kind: "provider-install", provider: "codex" } }),
  });
  assert.equal(anonymousFix.status, 403, "an anonymous caller cannot start a pinned installer");
  const diagnosis = await ownerJson(new URL("api/task-diagnosis?taskId=T-090", started.url));
  assert.equal(diagnosis.ok, true);
  assert.equal(diagnosis.diagnosis.source, "blocker");
  assert.ok(diagnosis.diagnosis.next_actions.some((action) => action.kind === "provider-model"));
  await assert.rejects(() => ownerJson(new URL("api/task-recovery/fix", started.url), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: "T-090", fix: { kind: "provider-model", provider: "codex", model: "gpt-5.6-terra" } }),
  }), /Authenticated Control Plane read failed \(400\)/);
  const confirmed = await ownerJson(new URL("api/task-recovery/fix", started.url), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: "T-090", confirm: true, fix: { kind: "provider-model", provider: "codex", model: "gpt-5.6-terra" } }),
  });
  assert.equal(confirmed.ok, true);
  console.log("PASS: allowlisted blocker fixes, confirmation gate and bounded diagnosis endpoint");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
