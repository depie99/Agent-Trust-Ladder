import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertWorkerAuth, buildInvocation, nextRole, queueSelect, runInvocation, workerEnvPolicy } from "../runtime/lib/worker.mjs";

assert.equal(nextRole({ status: "new" }), "pip");
assert.equal(nextRole({ status: "triaged" }), "mira");
assert.equal(nextRole({ status: "assigned" }), "rowan");
assert.equal(nextRole({ status: "in_review" }), "sage");
assert.equal(nextRole({ status: "verifying" }), "beacon");
assert.equal(nextRole({ status: "done" }), null);

// overnight --all queue order: priority first, then numeric task id, terminal out.
assert.deepEqual(
  queueSelect([
    { id: "T-010", status: "new", priority: "high" },
    { id: "T-002", status: "verifying", priority: "high" },
    { id: "T-005", status: "new", priority: "low" },
    { id: "T-001", status: "new" },
    { id: "T-003", status: "done", priority: "urgent" },
    { id: "T-004", status: "new", priority: "urgent" },
    { id: null },
  ]).map((t) => t.id),
  ["T-004", "T-002", "T-010", "T-001", "T-005"]
);
assert.equal(queueSelect([{ id: "T-001", status: "rejected" }]).length, 0);
assert.equal(queueSelect(undefined).length, 0);

assert.doesNotThrow(() => assertWorkerAuth("claude", "subscription"));
const subscriptionPolicy = workerEnvPolicy("claude", "subscription", { ANTHROPIC_API_KEY: "present", ANTHROPIC_BASE_URL: "gateway" });
assert.deepEqual(
  subscriptionPolicy.unset,
  [
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_PROJECT_ID",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH", "CLAUDE_CODE_SKIP_VERTEX_AUTH",
  ]
);
assert.deepEqual(subscriptionPolicy.stripped, ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]);
assert.match(subscriptionPolicy.set.ATL_BIN, /runtime[\\/]atl-manager\.mjs$/);
const apiPolicy = workerEnvPolicy("claude", "api", { ANTHROPIC_API_KEY: "present" });
assert.deepEqual(apiPolicy.unset, []);
assert.deepEqual(apiPolicy.stripped, []);
assert.match(apiPolicy.set.ATL_BIN, /runtime[\\/]atl-manager\.mjs$/);
assert.doesNotThrow(() => assertWorkerAuth("codex", "subscription"));
assert.throws(() => assertWorkerAuth("claude", "unknown"), /subscription or api/);

const childLog = path.join(os.tmpdir(), `atl-worker-auth-${Date.now()}.log`);
await runInvocation({
  command: process.execPath,
  args: ["-e", "process.stdout.write(process.env.ANTHROPIC_API_KEY || 'missing')"],
  cwd: process.cwd(),
}, {
  env: { ANTHROPIC_API_KEY: "must-not-reach-child" },
  unsetEnv: ["ANTHROPIC_API_KEY"],
  logPath: childLog,
  timeoutMs: 5000,
  echo: false,
});
assert.equal(fs.readFileSync(childLog, "utf8"), "missing");
fs.rmSync(childLog, { force: true });

// Provider prompts and transport diagnostics stay in the transcript by
// default; they must never repaint the user's parent terminal.
const quietLog = path.join(os.tmpdir(), `atl-worker-quiet-${Date.now()}.log`);
const parentWrites = [];
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
process.stdout.write = (chunk) => { parentWrites.push(`stdout:${String(chunk)}`); return true; };
process.stderr.write = (chunk) => { parentWrites.push(`stderr:${String(chunk)}`); return true; };
try {
  await runInvocation({
    command: process.execPath,
    args: ["-e", "process.stdout.write('## Bounded ATL worker run\\n'); process.stderr.write('responses_websocket 404\\n')"],
    cwd: process.cwd(),
  }, { logPath: quietLog, timeoutMs: 5000 });
} finally {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
}
assert.deepEqual(parentWrites, [], "provider output leaked into the parent terminal");
assert.match(fs.readFileSync(quietLog, "utf8"), /Bounded ATL worker run/);
assert.match(fs.readFileSync(quietLog, "utf8"), /responses_websocket 404/);
fs.rmSync(quietLog, { force: true });

const task = {
  id: "T-TEST",
  title: "bounded worker test",
  status: "assigned",
  objective: "run the bounded worker contract test",
  completion_checks: ["the worker invocation is local and explicit"],
  assigned_worker: "rowan",
};
const codex = buildInvocation("codex", {
  root: "C:\\project",
  workspace: "C:\\project\\.trust\\manager\\workspaces\\T-TEST",
  role: "rowan",
  task,
});
assert.match(codex.command, /codex/);
assert.equal(codex.args[0], "exec");
assert.equal(codex.args[codex.args.length - 1], "-");
assert.ok(!codex.args.includes("never"), "codex exec has no --ask-for-approval flag");
assert.equal(codex.cwd, "C:\\project\\.trust\\manager\\workspaces\\T-TEST");
assert.match(codex.prompt, /Bounded ATL worker run/);

const claude = buildInvocation("claude", { root: "C:\\project", role: "pip", task, auth: "subscription" });
assert.match(claude.command, /claude/);
assert.equal(claude.args[0], "-p");
assert.ok(!claude.args.includes(task.objective), "prompt rides on stdin, not the command line");
assert.ok(claude.args.includes("--permission-prompts"));

// Windows reality check: spawning a .cmd shim must survive (CVE-2024-27980
// makes a bare spawn EINVAL) and the prompt must arrive on stdin.
const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-worker-cmd-"));
const shim = path.join(shimDir, "fake-worker.cmd");
const out = path.join(shimDir, "stdin-capture.txt");
fs.writeFileSync(shim, `@echo off\r\nfind /v "" > "${out}"\r\n`, "utf8");
const shimLog = path.join(shimDir, "shim.log");
const shimResult = await runInvocation(
  { command: shim, args: [out], cwd: shimDir, prompt: "stdin rides to the worker" },
  { logPath: shimLog, timeoutMs: 10000, echo: false, stdinText: "stdin rides to the worker" }
);
assert.equal(shimResult.code, 0, `shim exited ${shimResult.code}: ${fs.readFileSync(shimLog, "utf8").slice(0, 400)}`);
assert.ok(fs.readFileSync(out, "utf8").includes("stdin rides to the worker"), "prompt was not delivered on stdin");
fs.rmSync(shimDir, { recursive: true, force: true });

console.log("worker tests passed");
