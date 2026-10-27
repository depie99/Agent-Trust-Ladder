import fs from "node:fs";
import path from "node:path";
import { loadState, paths } from "./state.mjs";
import { loadQueueBook, queueList } from "./queue.mjs";
import { listNotifications, notificationUnreadCount } from "./notifications.mjs";
import { loadUsage, latestUsage } from "./usage.mjs";
import { pendingFeedback } from "./feedback.mjs";
import { CONTRACTS } from "./roles.mjs";
import { readOvernightRun, readManagerConfig } from "./launch.mjs";
import { listClaims, sourceStatus } from "./brain.mjs";
import { listRoutines, listSkills, staleClaims } from "./governance.mjs";
import { approvalSnapshot } from "./approvals.mjs";
import { supervisorSnapshot } from "./supervisor.mjs";
import { reconcileLeases } from "./leases.mjs";
import { listBackups } from "./backup.mjs";
import { listRoutineRuns, schedulerStatus } from "./routines.mjs";

export const CONTROL_PLANE_VERSION = 1;

// Human phase labels per task status, used by the Team page role cards.
export const ROLE_PHASE = {
  triaged: "awaiting assignment",
  assigned: "ready to start",
  in_progress: "working",
  in_review: "independent review",
  verifying: "verification",
  blocked: "blocked — manager action",
  escalated: "escalated to owner",
  done: "shipped",
  rejected: "rejected",
  archived: "archived",
};

// One scan of the overnight directory → the newest session summary per role.
// Session summaries are the durable completion briefs written by the runner.
function latestRoleSessions(root) {
  const base = path.join(root, ".trust", "manager", "overnight");
  const newest = {};
  let taskDirs = [];
  try {
    taskDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return newest;
  }
  for (const taskId of taskDirs) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(base, taskId)).filter((f) => f.startsWith("session-") && f.endsWith(".json")).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const summary = JSON.parse(fs.readFileSync(path.join(base, taskId, file), "utf8"));
        if (!summary?.role) continue;
        const prev = newest[summary.role];
        if (!prev || String(summary.finishedAt || "").localeCompare(String(prev.summary?.finishedAt || "")) >= 0) {
          newest[summary.role] = {
            taskId,
            logPath: path.join(base, taskId, file.replace(/\.json$/i, ".log")),
            summary,
          };
        }
      } catch {
        // A torn summary file must never break the team view.
      }
    }
  }
  return newest;
}

function latestBriefRecord(root) {
  const dir = paths(root).briefs;
  try {
    const name = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().at(-1);
    if (!name) return null;
    const full = path.join(dir, name);
    return { name, path: full, at: fs.statSync(full).mtime.toISOString() };
  } catch {
    return null;
  }
}

function teamRoles(root, state, queues, sessions, brief) {
  const tasks = state.tasks || {};
  const queueOf = new Map();
  for (const queue of queues) {
    for (const item of queue.items || []) if (!queueOf.has(item.id)) queueOf.set(item.id, queue.id);
  }
  return Object.keys(CONTRACTS).map((role) => {
    const assigned = Object.values(tasks)
      .filter((task) => task.assigned_worker === role && !["done", "rejected", "archived"].includes(task.status))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const task = assigned[0] || null;
    const session = sessions[role] || null;
    let feedback = null;
    if (task) {
      const pending = pendingFeedback(root, { taskId: task.id, role });
      if (pending.length) feedback = { pending: pending.length, latest: pending.at(-1).id };
    }
    return {
      role,
      mission: CONTRACTS[role].mission,
      taskId: task?.id || session?.taskId || null,
      taskTitle: task?.title || null,
      taskStatus: task?.status || null,
      queueId: task ? queueOf.get(task.id) || null : null,
      provider: session?.summary?.worker || null,
      model: session?.summary?.model || null,
      phase: ROLE_PHASE[task?.status] || "idle",
      session: session
        ? {
            n: session.summary.session ?? null,
            logPath: session.logPath,
            finishedAt: session.summary.finishedAt || null,
            checkpoint: session.summary.checkpoint || null,
          }
        : null,
      latestBrief: brief,
      feedback,
    };
  });
}

export function createControlPlaneSnapshot(root, { queueId = null, notificationLimit = 50 } = {}) {
  const state = loadState(root);
  const queueBook = loadQueueBook(root);
  const activeQueueId = queueId || queueBook.active_queue;
  const queues = queueList(root, { includeArchived: false });
  const notifications = listNotifications(root, { limit: notificationLimit });
  const usage = loadUsage(root);
  const brief = latestBriefRecord(root);
  return {
    version: CONTROL_PLANE_VERSION,
    captured_at: new Date().toISOString(),
    state: {
      version: state.version,
      updated_at: state.updated_at,
      task_count: Object.keys(state.tasks || {}).length,
      tasks: state.tasks,
      log_tail: (state.log || []).slice(-50),
    },
    queues: {
      active_queue: activeQueueId,
      book_updated_at: queueBook.updated_at,
      items: queues,
    },
    notifications: {
      unread: notificationUnreadCount(root),
      items: notifications,
    },
    usage: {
      updated_at: usage.updated_at,
      snapshots: usage.snapshots,
      latest: latestUsage(root),
      default_provider: readManagerConfig(root).providers?.use || readManagerConfig(root).providers?.default || "codex",
    },
    overnight: readOvernightRun(root),
    team: teamRoles(root, state, queues, latestRoleSessions(root), brief),
    brain: {
      sources: sourceStatus(root),
      claims: listClaims(root),
      stale: staleClaims(root, { maxAgeDays: 30 }),
      skills: listSkills(root),
      routines: listRoutines(root),
      defaults: { freshness_days: 30, approval_owner: "manager", routines_enabled_by_default: false },
    },
    approvals: approvalSnapshot(root),
    supervisor: supervisorSnapshot(),
    leases: reconcileLeases(root),
    backups: listBackups(root),
    routine_runs: listRoutineRuns(root),
    scheduler: schedulerStatus(root),
  };
}
