// Operator abort: Ctrl+C (twice) in the control room must stop the live
// session, keep the interrupted task at its gate (never containment-blocked
// for a kill it did not cause), and mark untouched queue tasks "not reached".
// Proven with a real spawned child that sleeps until it is killed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { queueAdd } from "../runtime/lib/queue.mjs";
import { executeLaunchQueue, requestRunAbort } from "../runtime/lib/launch.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-run-abort-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({
  version: 1,
  inbox_dir: ".trust/manager/inbox",
  providers: {
    default: "sleeper",
    auth: "subscription",
    catalog: {
      sleeper: {
        command: process.execPath,
        model: "sleep-1",
        args: ["-e", "setInterval(() => {}, 1000);"],
      },
    },
  },
  intake: { file: { enabled: true }, github: { enabled: false }, azure: { enabled: false } },
}, null, 2));

const state = emptyState();
for (const id of ["T-001", "T-002"]) {
  state.tasks[id] = {
    id,
    title: `abort probe ${id}`,
    status: "assigned",
    priority: "normal",
    assigned_worker: "rowan",
    objective: "be aborted mid-session without changing gate status",
    completion_checks: [],
    attempt_count: 0,
    updated_at: new Date().toISOString(),
  };
}
saveState(root, state);
queueAdd(root, "T-001");
queueAdd(root, "T-002");

const progress = [];
const run = executeLaunchQueue(root, {
  confirm: true,
  maxMinutes: 5,
  maxSessions: 5,
  onProgress: (line) => progress.push(line),
  echo: false,
});

// Wait until the first session is actually live, then abort like the TUI does.
await new Promise((resolve) => setTimeout(resolve, 1200));
requestRunAbort();

const guarded = await Promise.race([
  run,
  new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 20000)),
]);
assert.notEqual(guarded, "TIMEOUT", "abort did not stop the queue run — the killed session never resolved");

const results = guarded.results;
assert.equal(results[0].id, "T-001");
assert.match(results[0].reason, /aborted by operator/);
assert.equal(results[1].id, "T-002");
assert.match(results[1].reason, /not reached: run aborted by operator/);

const after = loadState(root);
for (const id of ["T-001", "T-002"]) {
  assert.equal(after.tasks[id].status, "assigned", `${id} must keep its gate status`);
  assert.equal(after.tasks[id].blocker, undefined, `${id} must not be containment-blocked by an operator abort`);
}

const feed = fs.readFileSync(path.join(root, ".trust", "manager", "feed.jsonl"), "utf8");
assert.match(feed, /aborted by the operator/, "the abort must be narrated in the team feed");
assert.match(feed, /starting bounded sleeper session/, "the session start was narrated before the abort");
const stateLog = JSON.stringify(after.log || []);
assert.match(stateLog, /worker_start/, "the session start reached the state log");
assert.doesNotMatch(stateLog, /containment/, "an operator abort records no containment block");

requestRunAbort(); // no active child: must be a safe no-op

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: operator abort stops the live session, keeps gate status, and marks the rest not reached");
