// Runs/overnight control plane: preview and confirm gates, pause-after-bot,
// bounded retry after a stall, run.json lifecycle + lease release, per-session
// completion briefs, and untouched queue work never misreported as failed.
// Proven with real spawned child processes (node -e "process.exit(0)").
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { queueAdd } from "../runtime/lib/queue.mjs";
import { buildLaunchPlan, executeLaunchQueue, readRunLock } from "../runtime/lib/launch.mjs";
import { renderLaunchPreviewScreen, renderRunScreen, scanSessions } from "../runtime/lib/dashboard.mjs";

function makeProject(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atl-run-control-${label}-`));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({
    version: 1,
    inbox_dir: ".trust/manager/inbox",
    providers: {
      default: "flashexit",
      auth: "subscription",
      catalog: {
        flashexit: { command: process.execPath, model: "exit-0", args: ["-e", "process.exit(0);"] },
      },
    },
    intake: { file: { enabled: true }, github: { enabled: false }, azure: { enabled: false } },
  }, null, 2));
  const state = emptyState();
  for (const id of ["T-001", "T-002"]) {
    state.tasks[id] = {
      id,
      title: `run control probe ${id}`,
      status: "assigned",
      priority: "normal",
      assigned_worker: "rowan",
      objective: "exercise the run control plane honestly",
      completion_checks: [],
      attempt_count: 0,
      updated_at: new Date().toISOString(),
    };
  }
  saveState(root, state);
  queueAdd(root, "T-001");
  queueAdd(root, "T-002");
  return root;
}

// ---------- preview + confirm gate (no spawns)
{
  const root = makeProject("preview");
  const plan = buildLaunchPlan(root, { taskIds: ["T-001", "T-002"] });
  assert.deepEqual(plan.order, ["T-001", "T-002"]);
  assert.equal(plan.readyCount, 2);
  const frame = renderLaunchPreviewScreen({ launchPlan: plan }, 100, 30, true);
  assert.match(frame, /LAUNCH PREVIEW/);
  assert.match(frame, /T-001/);
  assert.match(frame, /Enter \/ y to run now/);
  assert.equal(frame, renderLaunchPreviewScreen({ launchPlan: plan }, 100, 30, true), "preview rendering is pure");
  assert.equal(readRunLock(root), null, "previewing starts no run and takes no lease");
  await assert.rejects(() => executeLaunchQueue(root, { confirm: false }), /--confirm/, "launch without confirm is refused");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- pause-after-bot: truthful gate states, run finished, briefs linked
{
  const root = makeProject("pause");
  const sessions = [];
  const run = await executeLaunchQueue(root, {
    confirm: true,
    maxMinutes: 5,
    maxSessions: 5,
    pauseAfterSession: true,
    onReview: async () => "stop",
    onSession: async (summary) => sessions.push(summary),
    onProgress: () => {},
  });
  for (const id of ["T-001", "T-002"]) {
    const entry = run.results.find((row) => row.id === id && /paused after bot by operator/.test(row.reason));
    assert.ok(entry, `${id} reports the operator pause honestly`);
  }
  const after = loadState(root);
  for (const id of ["T-001", "T-002"]) {
    assert.equal(after.tasks[id].status, "assigned", `${id} keeps its gate status after a pause`);
    assert.equal(after.tasks[id].blocker, undefined, `${id} is not containment-blocked by a pause`);
  }
  assert.equal(sessions.length, 2, "both sessions reported through onSession");
  for (const summary of sessions) {
    assert.ok(summary.logPath && summary.taskId && summary.role, "session brief carries its links");
  }
  const scanned = scanSessions(root);
  assert.equal(scanned.length, 2, "session briefs are discoverable from disk");
  assert.ok(scanned.every((item) => item.summary && item.summary.role && item.summary.statusAfter != null), "brief summaries are complete");
  const runMeta = JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "overnight", "run.json"), "utf8"));
  assert.equal(runMeta.status, "paused", "run.json records the operator-paused lifecycle");
  assert.ok(runMeta.runId, "run.json carries the run id");
  assert.equal(readRunLock(root), null, "the run lease is released after the run");

  const reviewFrame = renderRunScreen({
    running: false,
    runTasks: [
      { taskId: "T-001", state: "gate", status: "assigned", role: "rowan", provider: "flashexit" },
      { taskId: "T-002", state: "queued" },
    ],
    reviewPause: true,
    runStartedAt: Date.now() - 30000,
    runEndedAt: Date.now(),
  }, 120, 30, true);
  assert.match(reviewFrame, /HUMAN REVIEW GATE/, "the review gate is visible");
  assert.match(reviewFrame, /a Accept and continue/);
  assert.match(reviewFrame, /b Revise with checkpoint feedback/);
  assert.match(reviewFrame, /i Interrupt and restart/);
  assert.match(reviewFrame, /s Stop queue/);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- bounded retry: stalled worker gets one Mira recovery, then honest block
{
  const root = makeProject("retry");
  const run = await executeLaunchQueue(root, {
    confirm: true,
    maxMinutes: 5,
    maxSessions: 5,
    onProgress: () => {},
  });
  assert.ok(run.results.some((row) => row.status === "requeued"), "the stalled task was retried through Mira's recovery");
  const after = loadState(root);
  assert.equal(after.tasks["T-001"].status, "blocked", "a twice-stalled task ends blocked, not silently running");
  assert.equal(after.tasks["T-001"].blocker.actor, "manager", "containment is recorded under the confirming human's authority");
  const feed = fs.readFileSync(path.join(root, ".trust", "manager", "feed.jsonl"), "utf8");
  assert.match(feed, /auto-recovered/, "the retry is narrated in the team feed");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- per-task session cap: later queue work gets its own allowance
{
  const root = makeProject("budget");
  const run = await executeLaunchQueue(root, {
    confirm: true,
    maxMinutes: 5,
    maxSessions: 1,
    onProgress: () => {},
  });
  const untouched = run.results.filter((row) => row.id === "T-002");
  assert.ok(untouched.length >= 1, "the second task appears in the results");
  assert.match(untouched[0].reason, /worker did not advance|task session budget reached/, "later work reports its own honest outcome");
  assert.notEqual(untouched[0].status, "failed", "later work is never marked failed by another task's budget");
  const after = loadState(root);
  assert.equal(after.tasks["T-002"].status, "assigned", "the untouched task keeps its pre-run state");
  const runMeta = JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "overnight", "run.json"), "utf8"));
  assert.equal(runMeta.status, "finished");
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS: run control plane — preview/confirm/pause/retry flows, truthful states, linked briefs, untouched work preserved");
