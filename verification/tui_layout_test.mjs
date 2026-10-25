// TUI acceptance: layout primitives plus the shared task/run/blocker journeys
// at 60/80/120 columns — keyboard paths, resize notice, state coverage
// (empty/loading/error/blocked/running/success), stable focus, optional mouse
// capture, and bounded output everywhere.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { layoutFor, viewport, wrapLine, wrapLines } from "../runtime/lib/tui-layout.mjs";
import { actionLabel, boundedViewport, statusBadge, telemetryBadge } from "../runtime/lib/tui-components.mjs";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { submitFeedback } from "../runtime/lib/feedback.mjs";
import { commandCompletions, dispatchTuiCommand } from "../runtime/lib/command-console.mjs";
import { createDashboardSnapshot, renderDashboard, renderHelp, renderRunScreen, renderCommandScreen, renderFileView } from "../runtime/lib/dashboard.mjs";

assert.equal(layoutFor(120, 34).mode, "wide", "120 columns use the wide shell");
assert.equal(layoutFor(80, 24).mode, "medium", "80 columns use the medium shell");
assert.equal(layoutFor(60, 24).mode, "narrow", "60 columns use the narrow shell");
assert.equal(layoutFor(59, 24).isInteractive, false, "below minimum width is an explicit resize state");

const long = "The active checkout still has concurrent release-scope churn and Git denied writing the worktree index lock.";
const wrapped = wrapLine(long, 30);
assert.ok(wrapped.every((line) => line.length <= 30), "wrapped evidence never exceeds its viewport");
assert.match(wrapped.join("\n"), /worktree/);
const all = wrapLines([long, "second line"], 30);
const page = viewport(all, { height: 2, offset: 0 });
assert.equal(page.lines.length, 2, "viewport is height bounded");
assert.ok(page.maxOffset > 0, "long evidence is scrollable");
assert.equal(viewport(all, { height: 2, offset: 999 }).offset, page.maxOffset, "offset is clamped");

assert.match(statusBadge("blocked", { plain: true }), /× Blocked/);
assert.match(telemetryBadge("unknown", { plain: true }), /\? Unknown/);
assert.match(actionLabel("Run", "confirm", { plain: true }), /confirm/);
assert.equal(boundedViewport([long], 20, 3).lines.length, 3);

// ---------- shared fixture: one project in a mixed real state
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-tui-journeys-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
state.tasks["T-001"] = { id: "T-001", title: "Build queue book", status: "in_progress", priority: "high", assigned_worker: "rowan", objective: "named queues end to end" };
state.tasks["T-002"] = { id: "T-002", title: "Recover the release blocker", status: "blocked", priority: "urgent", assigned_worker: "mira", blocker: { reason: "owner must approve the spend", since: new Date().toISOString(), actor: "manager" } };
state.tasks["T-003"] = { id: "T-003", title: "Shipped the intake adapter", status: "done", priority: "normal" };
state.seq = 3;
saveState(root, state);
submitFeedback(root, { taskId: "T-001", prompt: "keep queues isolated", mode: "checkpoint", role: "rowan" });
const snapshot = createDashboardSnapshot(root);

function assertBounded(frame, width, label) {
  assert.ok(frame.split("\n").every((line) => line.length <= width), `${label} is width bounded at ${width}`);
}

for (const width of [60, 80, 120]) {
  // Task portfolio journey: blocked, running, and done states visible at once.
  const dash = renderDashboard(snapshot, { width, height: 34, plain: true, interactive: false });
  assert.match(dash, /ATL CONTROL ROOM/);
  assert.match(dash, /T-002/, "the blocked task is reachable from the portfolio");
  assert.match(dash, /1 shipped|shipped/, "the done count renders");
  assertBounded(dash, width, `dashboard at ${width}`);

  // Loading state.
  const loading = renderDashboard(snapshot, { width, height: 34, plain: true, loading: true, spinner: 1, interactive: false });
  assert.match(loading, /SYNCING/, "the loading state renders");
  assertBounded(loading, width, `loading dashboard at ${width}`);

  // Running journey: live queue run with a current session.
  const running = renderRunScreen({
    running: true,
    runCurrent: { taskId: "T-001", role: "rowan", provider: "codex", model: "glm-5.3", session: 2, sessionMax: 5, startedAt: Date.now() - 8000, phase: "building" },
    runTasks: [
      { taskId: "T-001", state: "running", role: "rowan", provider: "codex", session: 2, sessionMax: 5, startedAt: Date.now() - 8000 },
      { taskId: "T-002", state: "blocked", reason: "owner must approve the spend" },
    ],
    runLines: ["[T-001] session 2/5 · rowan · codex", "[T-002] blocked: owner must approve the spend"],
    runStartedAt: Date.now() - 60000,
  }, width, 30, true);
  assert.match(running, /Queue is running/);
  assert.match(running, /T-001/);
  assert.match(running, /owner must approve the spend/, "the blocker continues onto the run screen");
  assertBounded(running, width, `run screen at ${width}`);

  // Success journey: finished run.
  const finished = renderRunScreen({
    running: false,
    runTasks: [{ taskId: "T-003", state: "done", exit: 0 }],
    runStartedAt: Date.now() - 120000,
    runEndedAt: Date.now() - 30000,
  }, width, 30, true);
  assert.match(finished, /Queue run finished/);
  assertBounded(finished, width, `finished run at ${width}`);

  // Keyboard-driven console journey: completion, help, why, and refusals.
  assert.deepEqual(commandCompletions("qu"), ["queue"], "keyboard completion finds the queue command");
  const help = dispatchTuiCommand(root, "help");
  assert.equal(help.ok, true);
  assert.ok(help.lines.every((line) => line.length <= width), `help output is bounded at ${width}`);
  const why = dispatchTuiCommand(root, "why T-002");
  assert.equal(why.ok, true);
  assert.match(why.lines.join("\n"), /owner must approve the spend/, "why explains the blocker");
  const bad = dispatchTuiCommand(root, "definitely-not-a-command");
  assert.equal(bad.ok, false, "unknown keyboard commands are refused");
  assert.ok(bad.lines.every((line) => line.length <= width), `error output is bounded at ${width}`);
}

// Error state: an unresolvable task source renders the checked paths, bounded.
const errorView = renderFileView({ root, taskId: "T-001", filePath: null, lines: [], scroll: 0, error: "Could not resolve a local source file." }, 80, 24, true);
assert.match(errorView, /Could not resolve a local source file/, "the file view reports its error state");
assertBounded(errorView, 80, "file view error state");

// Console screen: command echo and bounded output lines.
const consoleFrame = renderCommandScreen({ command: { input: "why T-002", output: ["T-002 [blocked] why: owner gate"] } }, 80, 24, true);
assert.match(consoleFrame, /why T-002/);
assertBounded(consoleFrame, 80, "command console");

// Empty state: a fresh project renders a quiet room, bounded.
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-tui-empty-"));
fs.mkdirSync(path.join(emptyRoot, ".trust", "manager"), { recursive: true });
saveState(emptyRoot, emptyState());
const emptySnapshot = createDashboardSnapshot(emptyRoot);
const emptyDash = renderDashboard(emptySnapshot, { width: 80, height: 24, plain: true, interactive: false });
assert.match(emptyDash, /ATL CONTROL ROOM/);
assert.match(emptyDash, /FOCUS 0\/0|PORTFOLIO/, "the empty portfolio still renders its frame");
assertBounded(emptyDash, 80, "empty dashboard");
fs.rmSync(emptyRoot, { recursive: true, force: true });

// Resize: below the 60-column minimum the dashboard shows an explicit notice.
const narrow = renderDashboard(snapshot, { width: 50, height: 24, plain: true, interactive: false });
assert.match(narrow, /RESIZE/, "below minimum width shows the resize notice");
assert.match(narrow, /60-column minimum/);
assertBounded(narrow, 60, "resize notice frame");

// Stable focus: identical inputs render identically; focus changes are visible.
const focusA = renderDashboard(snapshot, { width: 120, height: 34, plain: true, panelFocus: "portfolio", interactive: true });
const focusB = renderDashboard(snapshot, { width: 120, height: 34, plain: true, panelFocus: "task", interactive: true });
assert.equal(focusA, renderDashboard(snapshot, { width: 120, height: 34, plain: true, panelFocus: "portfolio", interactive: true }), "focus rendering is stable");
assert.notEqual(focusA, focusB, "focus movement is visible in the frame");
assertBounded(focusA, 120, "focused dashboard");

// Optional mouse capture is discoverable in the help screen.
const helpFrame = renderHelp(80, 24, true);
assert.match(helpFrame, /Shift\+M/, "mouse capture toggle is documented");
assert.match(helpFrame, /mouse/, "mouse behavior is documented");
assertBounded(helpFrame, 80, "help screen");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: TUI acceptance — journeys at 60/80/120, states, resize notice, focus stability, mouse docs, bounded output");
