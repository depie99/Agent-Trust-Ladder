import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTeamContext, injectIntoCodexThread, startCodexThread, syncTeamContext } from "../runtime/lib/codex-bridge.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-codex-bridge-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.mkdirSync(path.join(root, ".trust", "manager", "overnight", "T-001"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ codex_bridge: { enabled: true, thread_id: "thread-test" } }));
fs.writeFileSync(path.join(root, ".trust", "manager", "feed.jsonl"), `${JSON.stringify({ at: "2026-10-22T10:00:00Z", from: "rowan", task: "T-001", text: "implemented the bridge" })}\n`);
const log = path.join(root, ".trust", "manager", "overnight", "T-001", "session-01-rowan.log");
fs.writeFileSync(log, "OpenAI Codex v0.149.1\nworker output\ncheck passed\n");

const context = buildTeamContext(root, { taskId: "T-001", sessionLog: log, maxChars: 2000 });
assert.match(context, /ATL TEAM CONTEXT/);
assert.match(context, /implemented the bridge/);
assert.match(context, /check passed/);
console.log("PASS: ATL context combines feed and session transcript");

const serverLog = path.join(root, "server.jsonl");
const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-app-server.mjs");
process.env.ATL_FAKE_APP_SERVER_LOG = serverLog;
const result = await injectIntoCodexThread({
  root,
  threadId: "thread-test",
  text: context,
  appServer: { command: process.execPath, args: [fake] },
});
assert.equal(result.injected, true);
const requests = fs.readFileSync(serverLog, "utf8");
// The fake server needs the log path through the environment; this assertion
// is intentionally after the call so the full request sequence is durable.
assert.match(requests, /initialize/);
assert.match(requests, /thread\/resume/);
assert.match(requests, /thread\/inject_items/);
assert.match(requests, /implemented the bridge/);
console.log("PASS: app-server handshake resumes the target and injects context");

const started = await startCodexThread({
  root,
  name: "ATL Team History",
  appServer: { command: process.execPath, args: [fake] },
});
assert.equal(started.threadId, "thread-dedicated");
const startedRequests = fs.readFileSync(serverLog, "utf8");
assert.match(startedRequests, /thread\/start/);
assert.match(startedRequests, /thread\/name\/set/);
console.log("PASS: dedicated history thread can be created without a model turn");

fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ codex_bridge: { enabled: true, thread_id: "thread-test", mode: "target" } }));
const firstSync = await syncTeamContext(root, {
  taskId: "T-001",
  sessionLog: log,
  appServer: { command: process.execPath, args: [fake] },
});
const secondSync = await syncTeamContext(root, {
  taskId: "T-001",
  sessionLog: log,
  appServer: { command: process.execPath, args: [fake] },
});
assert.equal(firstSync.injected, true);
assert.equal(secondSync.injected, false);
assert.equal(secondSync.reason, "no new context");
console.log("PASS: repeated sync is idempotent and does not duplicate context");

console.log("ALL OK: Codex bridge");
