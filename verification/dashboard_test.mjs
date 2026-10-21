import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDashboardSnapshot, renderDashboard, resolveTaskSource } from "../runtime/lib/dashboard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = createDashboardSnapshot(root);

assert.equal(snapshot.tasks.length, 5, "fixture should expose the current five-task portfolio");
assert.equal(snapshot.counts.blocked || 0, snapshot.tasks.filter((task) => task.status === "blocked").length, "blocked count should come from state.json");
assert.equal(snapshot.counts.in_review || 0, snapshot.tasks.filter((task) => task.status === "in_review").length, "review count should come from state.json");
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: true }), /CONTROL ROOM/);
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: true }), /LIFECYCLE/);
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: true }), /T-001/);
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: true }), /ACTIONS.*c create task.*e edit selected.*x (add to|remove from) queue.*l run queue.*r refresh/);
assert.match(renderDashboard(snapshot, { width: 80, height: 24, plain: true }), /SELECTED TASK/);
assert.doesNotMatch(renderDashboard(snapshot, { width: 120, height: 34, plain: true }), /\x1b\[/);
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: false, selected: 1 }), /FOCUS 2\/5/);
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: false, selected: 1 }), /\x1b\[48;2;/);
const blockedIndex = snapshot.tasks.findIndex((task) => task.status === "blocked");
assert.ok(blockedIndex >= 0, "fixture should expose at least one blocked task");
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: true, selected: blockedIndex }), /RECOVERY/);
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: true, selected: blockedIndex }), /u unblock/);
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: true, feedScroll: 10 }), /FEED VIEW/);
assert.match(renderDashboard(snapshot, { width: 120, height: 34, plain: true, interactive: false }), /SNAPSHOT/);
assert.doesNotMatch(renderDashboard(snapshot, { width: 120, height: 34, plain: true, interactive: false }), /select/);

const selected = snapshot.tasks.find((task) => task.id === "T-001");
assert.ok(resolveTaskSource(root, selected), "Enter should be able to resolve the task source from the inbox");

console.log("PASS: dashboard projection and width-safe plain rendering");
