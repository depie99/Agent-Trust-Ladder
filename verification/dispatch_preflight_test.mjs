import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatchPreflight } from "../runtime/lib/dispatch-preflight.mjs";

const mkRoot = (id) => fs.mkdtempSync(path.join(os.tmpdir(), `atl-preflight-${id}-`));
const mkTask = (root) => {
  const workspace = path.join(root, "repo");
  fs.mkdirSync(path.join(workspace, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "app", version: "1.0.0", dependencies: { left: "^1.0.0" } }));
  return { id: "T", title: "preflight", status: "assigned", workspace, dispatch_contract: {} };
};
const bunLockBody = '{"lockfileVersion":1,"packages":{"left@^1.0.0":["left@1.0.0",{},{}]}}';
const receiptFor = (workspace, manager, lockFile) => JSON.stringify({ lock: fs.readFileSync(path.join(workspace, lockFile)).toString("base64"), manifest: JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8")), manager });
const cmdString = (calls) => process.platform === "win32" ? String(calls[0]?.[1]?.[3] || "") : `${calls[0]?.[0]} ${(calls[0]?.[1] || []).join(" ")}`;

let root = mkRoot("fresh");
let task = mkTask(root);
fs.writeFileSync(path.join(task.workspace, "bun.lock"), bunLockBody);
fs.mkdirSync(path.join(task.workspace, "node_modules", ".bun"), { recursive: true });
fs.writeFileSync(path.join(task.workspace, ".atl-dependencies.json"), receiptFor(task.workspace, "bun", "bun.lock"));
let calls = [];
let result = dispatchPreflight(root, task, [task], { provisionLocal: true, execute: (...a) => { calls.push(a); return { status: 0 }; } });
assert.equal(result.ready, true, "bun.lock with fresh marker and matching receipt must be ready without running an install");
assert.equal(calls.length, 0, "fresh bun dependencies must not reinstall");

root = mkRoot("install");
task = mkTask(root);
fs.writeFileSync(path.join(task.workspace, "bun.lock"), bunLockBody);
calls = [];
result = dispatchPreflight(root, task, [task], { provisionLocal: true, execute: (...a) => { calls.push(a); return { status: 0, stdout: "", stderr: "" }; } });
assert.equal(result.ready, true, "bun.lock with provisionLocal must install and become ready");
assert.match(cmdString(calls), /bun install --frozen-lockfile --offline --ignore-scripts/, "bun install must run frozen, offline, and without lifecycle scripts");
assert.equal(fs.readFileSync(path.join(task.workspace, ".atl-dependencies.json"), "utf8"), receiptFor(task.workspace, "bun", "bun.lock"), "a dependency receipt must be written after the bun install");

root = mkRoot("nolock");
task = mkTask(root);
result = dispatchPreflight(root, task, [task], { provisionLocal: true, execute: () => ({ status: 0 }) });
assert.equal(result.ready, false);
assert.equal(result.cause, "locked-dependencies");
assert.match(result.reason, /bun\.lock/, "the no-lockfile blocker must mention bun.lock");

root = mkRoot("stale");
task = mkTask(root);
fs.writeFileSync(path.join(task.workspace, "bun.lock"), bunLockBody);
fs.mkdirSync(path.join(task.workspace, "node_modules", ".bun"), { recursive: true });
fs.writeFileSync(path.join(task.workspace, ".atl-dependencies.json"), '{"stale":true}');
calls = [];
result = dispatchPreflight(root, task, [task], { provisionLocal: true, execute: (...a) => { calls.push(a); return { status: 0, stdout: "", stderr: "" }; } });
assert.equal(result.ready, true, "a stale receipt must trigger bun re-preparation");
assert.equal(calls.length, 1, "stale bun dependencies must reinstall exactly once");

root = mkRoot("noprov");
task = mkTask(root);
fs.writeFileSync(path.join(task.workspace, "bun.lock"), bunLockBody);
result = dispatchPreflight(root, task, [task], { provisionLocal: false, execute: () => ({ status: 0 }) });
assert.equal(result.ready, false);
assert.equal(result.cause, "local-dependencies");
assert.match(result.reason, /bun install --frozen-lockfile --offline/, "the unprepared blocker must name the exact bun command");

root = mkRoot("precedence");
task = mkTask(root);
fs.writeFileSync(path.join(task.workspace, "package-lock.json"), '{"lockfileVersion":3}');
fs.writeFileSync(path.join(task.workspace, "bun.lock"), bunLockBody);
fs.writeFileSync(path.join(task.workspace, "node_modules", ".package-lock.json"), "{}");
fs.writeFileSync(path.join(task.workspace, ".atl-dependencies.json"), receiptFor(task.workspace, "npm", "package-lock.json"));
calls = [];
result = dispatchPreflight(root, task, [task], { provisionLocal: true, execute: (...a) => { calls.push(a); return { status: 0 }; } });
assert.equal(result.ready, true, "package-lock.json must take precedence over bun.lock and be satisfied by an npm receipt");
assert.equal(calls.length, 0, "npm precedence must not trigger a bun install");

for (const dir of fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("atl-preflight-"))) fs.rmSync(path.join(os.tmpdir(), dir), { recursive: true, force: true });
console.log("PASS: dispatch preflight honors bun lockfiles alongside npm/yarn/pnpm with frozen offline preparation");
