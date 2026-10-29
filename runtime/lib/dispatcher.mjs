// Supervisor scheduling policy: deterministic, bounded and project-fair. It
// produces dispatch decisions; launch.mjs remains the only process spawner.
import { loadState } from "./state.mjs";
import { queueList } from "./queue.mjs";
import { selectProjects } from "./supervisor.mjs";
const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
function eligible(task, tasks) {
  return task && ["assigned", "in_progress", "in_review", "verifying"].includes(task.status)
    && task.recovery?.status !== "exhausted"
    && !(task.recovery?.recovery_owner === "owner" && task.recovery.status !== "resolved")
    && (!task.execution_budget || task.execution_budget.used < task.execution_budget.max_sessions)
    && (task.plan_depends_on || []).every((id) => tasks[id]?.status === "done");
}
export function buildDispatchPlan(projects, { active = [], maxConcurrent = 2, now = Date.now(), excluded = new Set() } = {}) {
  const activeKeys = new Set(active.map((item) => `${item.project}:${item.task}`)); const slots = Math.max(0, Math.min(5, Number(maxConcurrent) || 1) - active.length); const plan = [];
  for (const project of selectProjects(projects, { cursor: now % Math.max(1, projects.length) })) {
    if (!slots || plan.length >= slots) break;
    let state; try { state = loadState(project.root); } catch { continue; }
    const queued = queueList(project.root).filter((queue) => !["paused", "archived"].includes(queue.status)).flatMap((queue) => queue.items.map((item) => ({ ...item, queueId: queue.id }))).map((item) => ({ ...item, task: state.tasks[item.id] })).filter((item) => eligible(item.task, state.tasks) && !activeKeys.has(`${project.id}:${item.id}`) && !excluded.has(`${project.id}:${item.id}`));
    queued.sort((a, b) => (rank[a.task.priority] ?? 2) - (rank[b.task.priority] ?? 2) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    if (queued[0]) plan.push({ project: project.id, root: project.root, task: queued[0].id, queue: queued[0].queueId, role: queued[0].task.assigned_worker || "rowan" });
  }
  return plan;
}
