// Render plain control-room frames from the real project state so UI changes
// can be reviewed as rendered text (run: node scripts/render-ui-frames.mjs).
import fs from "node:fs";
import path from "node:path";
import { createDashboardSnapshot, renderDashboard, renderLogsScreen, renderQueueScreen, renderRunScreen, tailFileLines, scanSessions } from "../runtime/lib/dashboard.mjs";
import { buildLaunchPlan } from "../runtime/lib/launch.mjs";
import { queueIds } from "../runtime/lib/queue.mjs";

const root = process.cwd();
const snap = createDashboardSnapshot(root);
const out = [];
const frame = (name, text) => { out.push(`======== ${name} ========`); out.push(text); out.push(""); };

frame("DASHBOARD 120x34", renderDashboard(snap, { width: 120, height: 34, plain: true, syncedAt: Date.now() - 3000 }));
frame("LOGS 120x34", renderLogsScreen(snap, { logsFollow: true, logsScroll: 0 }, 120, 34, true));
let plan = null;
try { plan = buildLaunchPlan(root, { taskIds: queueIds(root) }); } catch (e) { plan = null; }
frame("QUEUE 120x30", renderQueueScreen(snap, { launchPlan: plan, runTasks: [], queueSelected: 0 }, 120, 30, true));

const sessions = scanSessions(root);
const last = sessions[sessions.length - 1];
const runTasks = plan
  ? plan.items.map((item, index) => index === 0
    ? { taskId: item.taskId, role: item.role, provider: `${item.provider.worker}/${item.provider.auth}`, state: "running", status: null, session: 1, sessionMax: plan.budget.maxSessions, startedAt: Date.now() - 6 * 60000, exit: null, reason: null }
    : { taskId: item.taskId, role: item.role, provider: `${item.provider.worker}/${item.provider.auth}`, state: "queued", status: null, session: 0, sessionMax: null, startedAt: null, exit: null, reason: null })
  : [];
const runUi = {
  running: true,
  runStartedAt: Date.now() - 14 * 60000,
  runEndedAt: null,
  runCurrent: last ? { taskId: last.taskId, role: "rowan", provider: "codex", model: "gpt-5.3-codex", session: 1, sessionMax: 5, startedAt: Date.now() - 6 * 60000, phase: "recording transcript" } : null,
  runTasks,
  runLogName: last ? last.name : null,
  runLogTail: last ? tailFileLines(last.file, 6) : [],
};
frame("RUN 120x34 (live tail from real session log)", renderRunScreen(runUi, 120, 34, true));
frame("RUN FINISHED 120x34", renderRunScreen({
  ...runUi,
  running: false,
  runEndedAt: Date.now() - 30000,
  runCurrent: null,
  runTasks: [runTasks[0], { ...runTasks[1], state: "skipped", status: "queued", reason: "not reached: session budget exhausted" }],
}, 120, 34, true));

const target = path.join(root, ".trust", "manager", "ui-frames", "frames.txt");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out.join("\n"));
console.log(`rendered ${out.length} sections -> ${path.relative(root, target)} | sessions: ${sessions.length} | feed: ${snap.feed.length} | tasks: ${snap.tasks.length} | queue: ${snap.queue.length}`);
