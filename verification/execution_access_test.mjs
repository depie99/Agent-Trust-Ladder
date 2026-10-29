import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { executionAccess, saveExecutionAccess, executionPermissionArgs } from "../runtime/lib/execution-access.mjs";
import { buildInvocation } from "../runtime/lib/worker.mjs";
import { createAssistant, assistantFailureDetails } from "../runtime/lib/control-assistant.mjs";
import { emptyState, saveState, loadState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-access-"));
try {
  const state = emptyState();
  const workspace = path.join(root, ".trust/manager/workspaces/T-001");
  fs.mkdirSync(workspace, { recursive: true });
  state.tasks["T-001"] = { id: "T-001", title: "Access regression", status: "blocked", workspace, completion_checks: [], execution_budget: { used: 2, max_sessions: 4 } };
  saveState(root, state);
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config/manager.json"), JSON.stringify({ navigation: { mode: "on" }, providers: { use: "gapgpt" } }));
  assert.equal(executionAccess(root, "T-001").mode, "workspace-write");
  saveExecutionAccess(root, { mode: "read-only" });
  assert.equal(executionAccess(root, "T-001").mode, "read-only");
  const assistant = createAssistant(root);
  assert.throws(() => assistant.start({ scope: "T-001", mode: "fix", workspace, message: "Repair", provider: "gapgpt" }), /read-only/);
  assert.equal(loadState(root).tasks["T-001"].execution_budget.used, 2, "access denial must not consume a session");
  saveExecutionAccess(root, { task: "T-001", mode: "workspace-write" });
  assert.equal(executionAccess(root, "T-001").source, "task");
  assert.equal(executionAccess(root).default, "read-only");
  for (const worker of ["gapgpt", "codex"]) {
    for (const model of ["model-one", "model-two"]) {
      const invocation = buildInvocation(worker, { root, workspace, role: "rowan", task: state.tasks["T-001"], provider: { command: worker, model, args: ["exec", "--model", model, "--sandbox", "read-only", "-c", 'default_permissions=":read-only"', "--cd", "{cwd}", "-"] } });
      const permissions = executionPermissionArgs(worker, "workspace-write");
      for (const arg of permissions) assert.ok(invocation.args.includes(arg));
      assert.ok(!invocation.args.includes("read-only"));
      assert.ok(!invocation.args.includes('default_permissions=":read-only"'));
      assert.ok(invocation.args.includes(model), "catalog models stay selected");
    }
  }
  assert.deepEqual(executionPermissionArgs("gapgpt", "workspace-write", "win32"), ["-c", 'default_permissions=":workspace"', "-c", 'windows.sandbox="unelevated"']);
  assert.deepEqual(executionPermissionArgs("gapgpt", "read-only", "win32"), ["-c", 'default_permissions=":read-only"', "-c", 'windows.sandbox="unelevated"']);
  assert.deepEqual(executionPermissionArgs("codex", "workspace-write", "win32"), ["--sandbox", "workspace-write", "-c", 'default_permissions=":workspace"', "-c", 'windows.sandbox="unelevated"']);
  assert.deepEqual(executionPermissionArgs("codex", "read-only", "win32"), ["--sandbox", "read-only", "-c", 'default_permissions=":read-only"', "-c", 'windows.sandbox="unelevated"']);
  saveExecutionAccess(root, { task: "T-001", mode: "inherit" });
  assert.equal(executionAccess(root, "T-001").mode, "read-only");
  assert.equal(executionAccess(root, "T-001").override, null);
  assert.throws(() => saveExecutionAccess(root, { mode: "danger-full-access" }), /Choose/);
  assert.throws(() => saveExecutionAccess(root, { task: "T-999", mode: "workspace-write" }), /Task not found/);
  const config = JSON.parse(fs.readFileSync(path.join(root, "config/manager.json")));
  assert.equal(config.navigation.mode, "on"); assert.equal(config.providers.use, "gapgpt");
  assert.equal(assistantFailureDetails({ mode: "fix", provider: "gapgpt", diagnostic: "MCP tool call requires approval, but approval policy is never", output: "No files were changed." }).code, "runner-tool-policy");
  saveExecutionAccess(root, { task: "T-001", mode: "workspace-write" });
  let child; let capturedArgs; let permissionReady = false;
  const runner = createAssistant(root, {
    checkAccess: () => ({ ok: permissionReady, detail: "Windows sandbox is not set up" }),
    providerStatus: () => [{ id: "gapgpt", installed: true, signedIn: true, command: "gapcode", defaultModel: "model-one", models: [{ id: "model-one" }] }],
    discover: () => ({ available: true, path: "gapcode.exe" }),
    launch: (_command, args) => { capturedArgs = args; child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); return child; },
  });
  assert.throws(() => runner.start({ scope: "T-001", mode: "fix", provider: "gapgpt", model: "model-one", workspace, message: "Repair" }), /preflight failed.*no task session was consumed/);
  assert.equal(child, undefined, "denied access does not start a provider");
  assert.equal(loadState(root).tasks["T-001"].execution_budget.used, 2, "preflight denial preserves session budget");
  permissionReady = true;
  runner.start({ scope: "T-001", mode: "fix", provider: "gapgpt", model: "model-one", workspace, message: "Repair" });
  for (const arg of executionPermissionArgs("gapgpt", "workspace-write")) assert.ok(capturedArgs.includes(arg), "Ask ATL uses the same permissions as the queue");
  child.stderr.write("MCP tool call requires approval, but approval policy is never");
  child.stdout.write("No files were changed."); child.emit("close", 0);
  assert.equal(runner.read("T-001").status, "failed", "exit zero with denied tool access must not be ready for review");
  assert.equal(runner.read("T-001").failure.code, "runner-tool-policy");
  runner.start({ scope: "T-001", mode: "fix", provider: "gapgpt", model: "model-one", workspace, message: "Repair" });
  assert.equal(runner.read("T-001").failure, null, "a new run clears stale failure cards");
  child.stderr.write("GapCode v1\nsandbox: read-only\n" + "diagnostic padding".repeat(600)); child.emit("close", 0);
  assert.equal(runner.read("T-001").status, "failed", "read-only startup header survives diagnostic tail truncation");
  assert.equal(runner.read("T-001").failure.code, "workspace-access");
  assert.match(runner.read("T-001").failure.next_action, /Codex aliases backed by GapCode/);
  saveExecutionAccess(root, { task: "T-001", mode: "inherit" });
  const running = await startControlPlaneServer(root);
  try {
    const post = (payload, headers = {}) => fetch(`${running.url}api/execution-access`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
    assert.equal((await fetch(`${running.url}api/execution-access?task=T-001`).then(r => r.json())).access.mode, "read-only");
    assert.equal((await post({ action: "save", mode: "workspace-write" }, { origin: "http://other.invalid" })).status, 403);
    assert.equal((await post({ action: "save", mode: "workspace-write" }, { origin: running.url.slice(0, -1) })).status, 403, "browser permission changes require an owner session and CSRF token");
    assert.equal((await post({ action: "save", mode: "danger-full-access" })).status, 400);
    assert.equal((await post({ action: "save", task: "T-001", mode: "workspace-write" }).then(r => r.json())).access.mode, "workspace-write");
    assert.equal((await post({ action: "save", task: "T-999", mode: "workspace-write" })).status, 400);
    assert.equal((await post({ action: "save", task: "T-001", mode: "inherit" }).then(r => r.json())).access.source, "project");
  } finally { await new Promise(resolve => running.server.close(resolve)); }
  console.log("PASS: access inheritance, task overrides, all-model launch args, budget preservation, validation and owner/CSRF boundary");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
