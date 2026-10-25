// Team page: all five role cards must render current task, queue, provider,
// phase, session, latest brief, feedback state, and log links from ONE
// consistent control-plane snapshot — bounded at the minimum supported width.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { queueAdd, queueCreate, queueSetActive } from "../runtime/lib/queue.mjs";
import { submitFeedback } from "../runtime/lib/feedback.mjs";
import { createControlPlaneSnapshot } from "../runtime/lib/control-plane.mjs";
import { renderTeamScreen } from "../runtime/lib/dashboard.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-team-panel-"));
fs.mkdirSync(path.join(root, ".trust", "manager", "briefs"), { recursive: true });
fs.mkdirSync(path.join(root, ".trust", "manager", "overnight", "T-001"), { recursive: true });
const state = emptyState();
state.tasks["T-001"] = { id: "T-001", title: "Build queue book", status: "in_progress", priority: "high", assigned_worker: "rowan" };
state.tasks["T-002"] = { id: "T-002", title: "Review queue book", status: "in_review", priority: "normal", assigned_worker: "sage" };
saveState(root, state);
queueAdd(root, "T-001");
queueCreate(root, "release", { name: "Release" });
queueSetActive(root, "release");
queueAdd(root, "T-002");
submitFeedback(root, { taskId: "T-001", prompt: "use named queues for the release work", mode: "checkpoint", role: "rowan" });
fs.writeFileSync(path.join(root, ".trust", "manager", "overnight", "T-001", "session-01-rowan.json"), JSON.stringify({
  taskId: "T-001", role: "rowan", worker: "codex", model: "glm-5.3", session: 1,
  startedAt: "2026-10-22T08:00:00.000Z", finishedAt: "2026-10-22T08:12:00.000Z",
  exitCode: 0, timedOut: false, statusBefore: "assigned", statusAfter: "in_progress",
  checkpoint: { at: "2026-10-22T08:12:00.000Z", note: "queue book scaffolded" },
}, null, 2));
fs.writeFileSync(path.join(root, ".trust", "manager", "briefs", "brief-2026-10-22-08-30.md"), "# Morning brief\n");

// One authoritative snapshot feeds every render — no per-page rereads.
const snapshot = createControlPlaneSnapshot(root);
assert.equal(snapshot.team.length, 5, "all five roles are in the snapshot");
const rowan = snapshot.team.find((card) => card.role === "rowan");
assert.equal(rowan.taskId, "T-001");
assert.equal(rowan.queueId, "default");
assert.equal(rowan.provider, "codex");
assert.equal(rowan.model, "glm-5.3");
assert.equal(rowan.phase, "working");
assert.equal(rowan.session.logPath.endsWith("session-01-rowan.log"), true, "the session log link is part of the card");
assert.equal(rowan.latestBrief.name, "brief-2026-10-22-08-30.md");
assert.equal(rowan.feedback.pending, 1, "pending human feedback is part of the card");
const sage = snapshot.team.find((card) => card.role === "sage");
assert.equal(sage.taskId, "T-002");
assert.equal(sage.queueId, "release");
assert.equal(sage.phase, "independent review");

for (const width of [60, 80, 120]) {
  const frame = renderTeamScreen(snapshot, { runTasks: [] }, width, 30, true);
  assert.match(frame, /TEAM/);
  for (const role of ["mira", "pip", "rowan", "sage", "beacon"]) {
    assert.match(frame, new RegExp(role), `${role} is visible at ${width} columns`);
  }
  assert.match(frame, /T-001/, "current task id is visible");
  assert.match(frame, /release/, "queue membership is visible");
  assert.match(frame, /codex/, "provider is visible");
  assert.match(frame, /WORKING/, "phase is visible");
  assert.match(frame, /session 1/, "session progress is visible");
  assert.match(frame, /brief-2026-10-22-08-30\.md/, "latest brief link is visible");
  assert.match(frame, /feedback 1 pending/, "feedback state is visible");
  assert.match(frame, /session-01-rowan\.log/, "log link is visible");
  assert.ok(frame.split("\n").every((line) => line.length <= width), `team panel is width bounded at ${width}`);
}

const again = renderTeamScreen(snapshot, { runTasks: [] }, 80, 30, true);
assert.equal(again, renderTeamScreen(snapshot, { runTasks: [] }, 80, 30, true), "rendering never mutates the shared snapshot");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: team panel — five linked role cards from one snapshot, bounded at 60/80/120");
