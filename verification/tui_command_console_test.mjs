import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask, emptyState, loadState, saveState, transition } from "../runtime/lib/state.mjs";
import { dispatchTuiCommand, commandCompletions } from "../runtime/lib/command-console.mjs";
import { renderCommandScreen } from "../runtime/lib/dashboard.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-command-console-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
const task = createTask(state, { title: "Inspect a long blocker" });
task.objective = "Keep evidence readable in the TUI";
task.completion_checks = ["the blocker is fully visible"];
transition(state, task.id, "triaged", { actor: "manager", note: "packet ready" });
task.assigned_worker = "rowan";
transition(state, task.id, "assigned", { actor: "manager", note: "rowan" });
task.blocker = { reason: "The active checkout still has concurrent release-scope churn and Git denied writing the worktree index lock; manager must resolve access before retrying.", since: new Date().toISOString(), actor: "rowan" };
transition(state, task.id, "blocked", { actor: "manager", note: task.blocker.reason });
saveState(root, state);

const why = dispatchTuiCommand(root, `why ${task.id}`);
assert.equal(why.ok, true, "why succeeds in the console");
assert.match(why.lines.join("\n"), /index lock/);
assert.match(why.lines.join("\n"), /manager action required/);

const selectedWhy = dispatchTuiCommand(root, "why", { selectedTaskId: task.id });
assert.match(selectedWhy.lines.join("\n"), /Inspect a long blocker/, "selected task is the default why target");
const cliStyleWhy = dispatchTuiCommand(root, `atl why ${task.id}`);
assert.equal(cliStyleWhy.ok, true, "the in-TUI console accepts the normal ATL CLI prefix");
assert.match(cliStyleWhy.lines.join("\n"), /index lock/);

const bad = dispatchTuiCommand(root, "rm -rf .");
assert.equal(bad.ok, false, "unknown command is rejected");
assert.match(bad.lines.join("\n"), /Unknown command/);
assert.equal(loadState(root).tasks[task.id].status, "blocked", "unknown command cannot mutate state");

const add = dispatchTuiCommand(root, `queue add ${task.id}`);
assert.equal(add.refresh, true, "queue add requests a snapshot refresh");
assert.match(dispatchTuiCommand(root, "queue list").lines.join("\n"), new RegExp(task.id));

const archive = dispatchTuiCommand(root, `task archive ${task.id} --note "not ready for this queue"`);
assert.equal(archive.ok, true, "archive is available from the command surface");
assert.equal(loadState(root).tasks[task.id].status, "archived");
assert.equal(dispatchTuiCommand(root, `task restore ${task.id}`).ok, true, "restore is available from the command surface");

const help = dispatchTuiCommand(root, "help");
assert.match(help.lines.join("\n"), /launch --dry-run/);
assert.deepEqual(commandCompletions("que"), ["queue"], "completion is allowlisted");

const frame = renderCommandScreen({ command: { input: `why ${task.id}`, output: why.lines, outputScroll: 0 }, commandHistory: ["why T-001"] }, 60, 20, true);
const plain = frame.replace(/\x1b\[[0-9;]*m/g, "");
assert.ok(plain.split("\n").every((line) => line.length <= 60), "command output stays within the terminal frame");
assert.match(plain, /COMMAND CONSOLE/);
const longInputFrame = renderCommandScreen({ command: { input: "atl task edit T-001 --objective "+"x".repeat(100), output: [], outputScroll: 0 }, commandHistory: [] }, 60, 20, true);
assert.ok(longInputFrame.split("\n").every((line) => line.length <= 60), "long command input stays within the terminal frame");
assert.match(longInputFrame, /…x+/, "long command input keeps its insertion end visible");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: TUI command console — why, allowlist, queue/task actions, completion, bounded output");
