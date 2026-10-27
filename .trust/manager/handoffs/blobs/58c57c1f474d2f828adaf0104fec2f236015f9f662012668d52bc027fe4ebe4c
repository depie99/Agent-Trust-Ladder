// Spec 014 UI feedback pass: auto-refresh contract, LOGS stream, run-screen
// queue progress, and the live session-log tail — all rendered plain against
// a throwaway project. Nothing here starts a provider session.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState, loadState, logEvent, createTask, transition } from "../runtime/lib/state.mjs";
import { post as feedPost } from "../runtime/lib/feed.mjs";
import { queueAdd } from "../runtime/lib/queue.mjs";
import {
  createDashboardSnapshot,
  renderDashboard,
  renderLogsScreen,
  renderRunScreen,
  renderQueueScreen,
  renderReviewScreen,
  renderHelp,
  renderFeedView,
  tailFileLines,
  mergedLogEntries,
} from "../runtime/lib/dashboard.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-ui-feedback-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }, null, 2));
saveState(root, emptyState());

// Two tasks: T-001 assigned to rowan mid-run, T-002 fresh; T-001 is queued.
{
  const state = loadState(root);
  const a = createTask(state, { title: "Ship the feedback panel" });
  const b = createTask(state, { title: "Write the release notes" });
  a.objective = "The control room shows live progress without a manual refresh.";
  a.completion_checks = ["snapshot age stays under 3s while idle"];
  a.assigned_worker = "rowan";
  transition(state, a.id, "triaged", { actor: "manager", note: "packet approved" });
  transition(state, a.id, "assigned", { actor: "manager", note: "rowan" });
  state.tasks[a.id].assigned_worker = "rowan";
  logEvent(state, { task: a.id, actor: "manager", event: "assigned -> assigned", detail: "smoke" });
  saveState(root, state);
  feedPost(root, { from: "runner", text: `launch queue: taking ${a.id}`, task: a.id });
  feedPost(root, { from: "rowan", text: "started the bounded build session.", task: a.id });
  queueAdd(root, a.id, { by: "manager" });
}

const snapshot = createDashboardSnapshot(root);

// 1. mergedLogEntries: state decisions and feed narration in one stream.
{
  const entries = mergedLogEntries(snapshot);
  assert.ok(entries.length >= 4, "merge should include state events and feed messages");
  const kinds = new Set(entries.map((e) => e.kind));
  assert.ok(kinds.has("state") && kinds.has("feed"), "both sources must appear");
  const times = entries.map((e) => e.at);
  assert.deepEqual(times, [...times].sort(), "entries must be chronological");
}

// 2. tailFileLines: last non-empty lines, ANSI stripped, missing file is safe.
{
  const logFile = path.join(root, ".trust", "manager", "overnight", "T-001", "session-01-rowan.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, ["head line", "", "\x1b[38;5;9mrowan: reading task packet\x1b[39m", "rowan: editing src/app.ts", "rowan: running checks"].join("\n"));
  const tail = tailFileLines(logFile, 3);
  assert.equal(tail.length, 3, "tail returns the requested count");
  assert.equal(tail[0], "rowan: reading task packet", "empty lines are skipped");
  assert.ok(!tail.some((l) => l.includes("\x1b[")), "ANSI escapes are stripped");
  assert.deepEqual(tailFileLines(path.join(root, "nope", "missing.log"), 3), [], "missing file is an empty tail");
}

// 3. LOGS screen: follow mode shows the latest, history mode labels the offset.
{
  const following = renderLogsScreen(snapshot, { logsFollow: true, logsScroll: 0 }, 120, 30, true);
  assert.match(following, /LOGS/);
  assert.match(following, /FOLLOWING latest/);
  assert.match(following, /⚙ manager/, "state decisions appear with the ⚙ marker");
  assert.match(following, /Rowan/, "feed narration appears under the bot's name");
  const history = renderLogsScreen(snapshot, { logsFollow: false, logsScroll: 50 }, 120, 30, true);
  assert.match(history, /history −\d+/);
}

// 4. Run screen: queue progress states, session counts, elapsed, log tail.
const baseUi = {
  running: true,
  runStartedAt: Date.now() - 90_000,
  runEndedAt: null,
  runCurrent: { taskId: "T-001", role: "rowan", provider: "codex", model: "gpt-5.3", session: 1, sessionMax: 5, startedAt: Date.now() - 42_000, phase: "recording transcript" },
  runTasks: [
    { taskId: "T-001", role: "rowan", provider: "codex/codex", state: "running", status: null, session: 1, sessionMax: 5, startedAt: Date.now() - 42_000, exit: null, reason: null },
    { taskId: "T-002", role: "pip", provider: "codex/codex", state: "queued", status: null, session: 0, sessionMax: null, startedAt: null, exit: null, reason: null },
  ],
  runLogName: "session-01-rowan.log",
  runLogTail: ["rowan: reading task packet", "rowan: editing src/app.ts"],
  runLogLines: ["rowan: reading task packet", "rowan: editing src/app.ts"],
  runLines: ["[T-001] session 1/5 · rowan · codex · gpt-5.3", "BRIEF · T-001 rowan · exit 0 · assigned → in_review"],
};
{
  const running = renderRunScreen(baseUi, 120, 34, true);
  assert.match(running, /RUN QUEUE/);
  assert.match(running, /Queue is running · total 1m30s/);
  assert.match(running, /QUEUE PROGRESS/);
  assert.match(running, /STRUCTURED TIMELINE/);
  assert.match(running, /BRIEF · T-001 rowan/);
  assert.match(running, /session 1\/5/);
  assert.match(running, /running · rowan\/codex/);
  assert.match(running, /queued · pip\/codex/);
  assert.match(running, /SESSION LOG · session-01-rowan\.log/);
  assert.match(running, /rowan: editing src\/app\.ts/, "the live log tail is on the run screen");
  assert.match(running, /L logs/, "the logs tab is reachable from the run");
  const longLine = "provider detail that must remain readable beyond the old clipped tail — " + "x".repeat(80);
  const complete = renderRunScreen({ ...baseUi, runLogLines: [longLine] }, 120, 34, true);
  assert.match(complete, /old clipped tail/);
  assert.match(complete, /x{20}/, "raw transcript content is wrapped, not discarded");

  const finished = renderRunScreen({
    ...baseUi,
    running: false,
    runEndedAt: Date.now() - 1000,
    runCurrent: null,
    runTasks: [
      { taskId: "T-001", role: "rowan", provider: "codex/codex", state: "done", status: "done", session: 2, sessionMax: 5, startedAt: null, exit: 0, reason: null },
      { taskId: "T-002", role: "pip", provider: "codex/codex", state: "gate", status: "in_review", session: 1, sessionMax: 5, startedAt: null, exit: 0, reason: "one-shot session complete" },
    ],
  }, 120, 34, true);
  assert.match(finished, /Queue run finished · total/);
  assert.match(finished, /done · rowan\/codex/);
  assert.match(finished, /at gate · in_review/);
  assert.match(finished, /exit 0/);
  assert.match(finished, /final/, "the tail is labeled final after the run");

  const blocked = renderRunScreen({
    ...baseUi,
    running: false,
    runTasks: [{ taskId: "T-001", role: "rowan", provider: "codex/codex", state: "blocked", status: "blocked", session: 1, sessionMax: 5, startedAt: null, exit: 1, reason: "worker ended unsuccessfully (code 1)" }],
  }, 120, 34, true);
  assert.match(blocked, /blocked · rowan\/codex/);
  assert.match(blocked, /worker ended unsuccessfully/);
}

// 5. Queue screen shows the live gate state, not the plan-time snapshot.
{
  const ui = { launchPlan: { items: [{ taskId: "T-001", title: snapshot.tasks[0].title, status: "assigned", role: "rowan", provider: { worker: "codex", model: "gpt-5.3", auth: "subscription" }, blockers: [] }] }, runTasks: baseUi.runTasks, queueSelected: 0 };
  const frame = renderQueueScreen(snapshot, ui, 120, 30, true);
  assert.match(frame, /EXECUTION QUEUE/);
  assert.match(frame, /Run/, "T-001 shows its live in_progress state while running");
  assert.match(frame, /gate states refresh live/);
}

// 6. Header sync age + queue depth are visible on the dashboard.
{
  const frame = renderDashboard(snapshot, { width: 120, height: 34, plain: true, syncedAt: Date.now() - 7000 });
  assert.match(frame, /synced 7s ago/, "the header reports the sync age");
  assert.match(frame, /1 queued/, "queue depth is on the summary line");
  assert.doesNotMatch(renderDashboard(snapshot, { width: 120, height: 34, plain: true }), /\x1b\[/);
}

// 7. Regression: a multi-line objective must spread into separate panel rows.
//    A missing spread nested wrap()'s array into the lines list, and the
//    implicit Array.toString() rendered the objective as one comma-joined row.
{
  const task = {
    id: "T-900", title: "Wrap regression", status: "in_progress", priority: "normal", risk: "normal",
    attempt_count: 0,
    objective: "This objective is deliberately long enough that the review panel must wrap it across two panel rows without joining them.",
    completion_checks: [], evidence: [], resources: [],
    source: { type: "manual" },
  };
  const frame = renderReviewScreen({ tasks: [task], queue: [] }, { reviewTaskId: "T-900" }, 120, 30, false);
  const text = frame.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(!/[a-z0-9],[a-z0-9]/.test(text), "wrapped objective lines must never be comma-joined");
  assert.match(text, /without/, "the objective tail must appear on its own row");
}

// 8. Mouse interaction contract: text selection is a first-class citizen.
//    Mouse capture used to be enabled for the whole session, which made
//    drag-select/copy impossible everywhere in the TUI.
{
  const help = renderHelp(120, 40, true);
  const helpText = help.replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(helpText, /click cards and controls/, "help states the interactive mouse default");
  assert.match(helpText, /Shift\+M/, "help documents the wheel-panning toggle");
  // The feed hint promises wheel scrolling because capture is interactive by default.
  const feed = renderFeedView(snapshot, 120, 30, 0, true);
  assert.match(feed, /scroll/, "feed keeps a keyboard fallback for scrolling");
  // Tripwire: the enable sequence may only exist behind the ui.mouseMode
  // toggle — never as an unconditional startup write.
  const source = fs.readFileSync(new URL("../runtime/lib/dashboard.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /write\("\\x1b\[\?100[06]h/, "mouse capture must never be enabled unconditionally");
  assert.ok(source.includes("\\x1b[?1000l"), "startup/close must disable mouse capture");
}

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: control room feedback — logs stream, run progress, live tail, sync age");
