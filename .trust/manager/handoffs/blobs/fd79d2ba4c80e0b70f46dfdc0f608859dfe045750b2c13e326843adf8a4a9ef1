import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { readOvernightRun, reconcileOvernightRun, resumeOvernightRun } from "../runtime/lib/launch.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-overnight-recovery-"));
fs.mkdirSync(path.join(root, ".trust", "manager", "overnight"), { recursive: true });
saveState(root, emptyState());

const runFile = path.join(root, ".trust", "manager", "overnight", "run.json");
fs.writeFileSync(runFile, JSON.stringify({
  version: 2, runId: "R-crashed", status: "running", runnerPid: 4000000000,
  taskOrder: ["T-001", "T-002", "T-003"], cursor: 1, currentTaskId: "T-002",
  budget: { maxMinutes: 120, maxSessions: 5 },
}, null, 2));

const reconciled = reconcileOvernightRun(root);
assert.equal(reconciled.state, "interrupted", "a dead runner is reconciled honestly");
assert.equal(reconciled.interruptedTaskId, "T-002", "the in-flight task is retained for manager inspection");
assert.deepEqual(reconciled.resumableTaskIds, ["T-003"], "only untouched work is resumable");
const persisted = readOvernightRun(root);
assert.equal(persisted.status, "interrupted", "reconciliation persists the recovery state");
assert.match(persisted.recovery, /T-002/, "the persisted record names the unsafe task");
await assert.rejects(() => resumeOvernightRun(root), /explicit confirmation/, "recovery never starts without a fresh confirmation");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: overnight recovery â€” durable safe boundaries, interrupted sessions excluded, fresh confirmation required");
