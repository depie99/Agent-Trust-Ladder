import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWorkerChannel, scopedWorkerArguments } from "../runtime/lib/worker-channel.mjs";
import { createWorkerCredential } from "../runtime/lib/session-auth.mjs";
import { acquireLease, releaseLease } from "../runtime/lib/leases.mjs";
import { emptyState, saveState, loadState } from "../runtime/lib/state.mjs";

const execute = promisify(execFile);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-worker-channel-"));
const workspace = path.join(root, "workspace");
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, "app.txt"), "Persian task evidence\n");
const scope = { task: "T-001", role: "rowan" };
assert.deepEqual(scopedWorkerArguments(["show"], scope), ["show", "T-001"]);
assert.deepEqual(scopedWorkerArguments(["wake"], scope), ["show", "T-001"]);
assert.deepEqual(scopedWorkerArguments(["observe", "--actor", "rowan", "T-001", "packet.json"], scope), ["observe", "T-001", "packet.json", "--actor", "rowan"]);
for (const argv of [["move", "T-002", "in_review"], ["move", "T-001", "in_review", "--actor", "manager"], ["launch", "--confirm"], ["update", "T-001", "--set", "status=done"], ["update", "T-001", "--set", "evidence=[]"], ["feed", "--task", "T-002"], ["move", "T-001", "in_review", "--actor", "rowan", "--actor", "sage"]]) assert.throws(() => scopedWorkerArguments(argv, scope));

const state = emptyState();
state.tasks[scope.task] = { id: scope.task, title: "Bounded handoff", source: { type: "test" }, status: "in_progress", objective: "Test actual worker handoff", completion_checks: ["focused check"], evidence: [], workspace, packet_revision: 1, evidence_contract: 2, attempt_count: 1, review_required: true };
saveState(root, state);
const lease = acquireLease(root, { project: path.resolve(root), task: scope.task, role: scope.role, run: "channel-regression", ttlMs: 120000 });
let channel;
const open = async (role, expiresInSeconds = 120) => {
  if (channel) await channel.close();
  const credential = createWorkerCredential({ project: path.resolve(root), task: scope.task, role, run: lease.run, generation: lease.generation, leaseId: lease.id, leaseKey: lease.key, expiresInSeconds });
  channel = createWorkerChannel(root, { workspace, task: scope.task, role, credential });
};
const call = async (...args) => {
  // The actual client is denied writes anywhere outside the workspace.
  const env = { ...process.env, ...channel.env }; delete env.ATL_WORKER_CREDENTIAL;
  return execute(process.execPath, ["--permission", "--allow-fs-read=*", `--allow-fs-write=${workspace}`, channel.client, ...args], { cwd: workspace, env, windowsHide: true });
};
try {
  await open("rowan");
  await assert.rejects(execute(process.execPath, ["--permission", "--allow-fs-read=*", `--allow-fs-write=${workspace}`, "-e", "require('fs').writeFileSync(process.argv[1], 'denied')", path.join(root, ".trust", "manager", "state.json")], { windowsHide: true }), /Access to this API has been restricted|ERR_ACCESS_DENIED/);
  assert.match((await call("show", scope.task)).stdout, /Bounded handoff/);
  fs.writeFileSync(path.join(root, "outside-packet.json"), "{}");
  await assert.rejects(call("observe", scope.task, "../outside-packet.json"), /must remain inside its workspace/);
  await assert.rejects(call("move", scope.task, "done", "--actor", "manager"), /cannot impersonate/);
  await call("update", scope.task, "--evidence-pass", "focused check", "--checkpoint", "Check ran inside sandbox");
  await call("move", scope.task, "in_review");
  assert.equal(loadState(root).tasks[scope.task].status, "in_review");
  assert.equal(loadState(root).tasks[scope.task].evidence[0].actor, "rowan");
  assert.ok(loadState(root).tasks[scope.task].evidence[0].code_revision);
  await open("sage");
  await call("update", scope.task, "--review", "approve: independent fixture review of bounded artifact");
  await call("move", scope.task, "verifying");
  await open("beacon");
  await call("update", scope.task, "--evidence-pass", "focused check");
  await call("move", scope.task, "done");
  assert.equal(loadState(root).tasks[scope.task].status, "done");
  const before = fs.readFileSync(path.join(root, ".trust", "manager", "state.json"), "utf8");
  releaseLease(root, lease);
  await assert.rejects(call("update", scope.task, "--note", "stale mutation"), /stale lease/);
  assert.equal(fs.readFileSync(path.join(root, ".trust", "manager", "state.json"), "utf8"), before);
  await channel.close();
  await assert.rejects(call("show", scope.task), /channel closed/);
  assert.throws(() => createWorkerChannel(root, { workspace, ...scope, credential: createWorkerCredential({ project: path.resolve(root), ...scope, run: lease.run, generation: lease.generation, leaseId: lease.id, leaseKey: lease.key, expiresInSeconds: -1 }) }), /expired credential/);
  console.log("PASS: sandbox denies shared-state writes; manager channel advances builder/review/verifier gates and rejects cross-task, impersonated, stale and closed requests");
} finally {
  if (channel) await channel.close();
  releaseLease(root, lease);
  fs.rmSync(root, { recursive: true, force: true });
}
