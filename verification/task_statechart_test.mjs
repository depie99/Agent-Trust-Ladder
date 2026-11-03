import assert from "node:assert/strict";
import { STATE_CONTRACT } from "../runtime/lib/state.mjs";
import { taskStatechart } from "../runtime/lib/task-statechart.mjs";
const task = { id: "T-001", status: "done" };
const log = [
  { task: task.id, event: "ready -> in_progress", actor: "worker", at: "2026-11-01T01:00:00Z", detail: "start" },
  { task: "T-002", event: "new -> ready" },
  { task: task.id, event: "evidence:check" },
  { task: task.id, event: "in_progress -> blocked", detail: "<script>" },
  { task: task.id, event: "blocked -> in_progress" },
  { task: task.id, event: "verifying -> done", actor: "manager" }
];
const chart = taskStatechart(task, log);
assert.equal(chart.evidence_level, "recorded-history");
assert.deepEqual(chart.steps.map(s => s.state), ["ready", "in_progress", "blocked", "in_progress", "verifying", "done"]);
assert.equal(chart.steps[4].gap_before, true);
assert.equal(chart.transitions.length, 4);
assert.equal(chart.transitions[0].actor, "worker");
assert.equal(chart.transitions[0].at, log[0].at);
assert.equal(chart.transitions[1].detail, "<script>");
assert.equal(chart.history_complete, false);
assert.match(chart.mermaid, /history gap/);
assert.deepEqual(taskStatechart(task).steps, [{ state: "done", at: null, gap_before: false, snapshot: true }]);
assert.equal(taskStatechart(task).transitions.length, 0);
const mismatch = taskStatechart({ ...task, status: "archived" }, log);
assert.equal(mismatch.steps.at(-1).gap_before, true);
assert.equal(mismatch.transitions.length, 4, "snapshot mismatch does not invent a transition");
console.log("PASS: recorded order, retries, task isolation, metadata, gaps and snapshot fallback");

assert.equal(chart.workflow_states.length, STATE_CONTRACT.statuses.length);
assert.equal(chart.workflow_transitions.length, Object.keys(STATE_CONTRACT.transitions).length);
assert.match(chart.workflow_mermaid, /stateDiagram-v2/);
assert.match(chart.workflow_mermaid, /all_checks_pass/);
