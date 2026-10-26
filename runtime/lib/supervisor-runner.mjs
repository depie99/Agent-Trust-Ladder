// Supervisor-owned multi-project runner. Launches are still delegated to the
// existing launch engine; this module owns fairness, caps, cancellation, and
// the bounded process set.
import { buildDispatchPlan } from "./dispatcher.mjs";
import { executeLaunchQueue, requestRunAbort } from "./launch.mjs";
import { supervisorSnapshot } from "./supervisor.mjs";
import { reconcileLeases } from "./leases.mjs";
import { reconcileRuntime } from "./recovery.mjs";
import { scheduledBackup } from "./backup.mjs";
import { schedulerTick } from "./routines.mjs";

let stopRequested = false;
export function requestSupervisorStop() { stopRequested = true; requestRunAbort(); }
export function clearSupervisorStop() { stopRequested = false; }
export function supervisorRunning() { return !stopRequested; }

export async function executeSupervisor(root, { projects = null, maxMinutes = 120, maxSessions = 8, onProgress = console.log, launch = executeLaunchQueue } = {}) {
  const recovery = reconcileRuntime(root); if (!recovery.ready) throw new Error("runtime recovery is incomplete; inspect journal records before accepting new work");
  clearSupervisorStop(); const config = supervisorSnapshot(); const registered = (projects || config.projects).map((p) => ({ ...p, eligible: true }));
  const globalCap = Math.min(5, Math.max(1, Number(config.defaults?.maxConcurrent || 2))); const active = new Map(); const results = [];
  const started = Date.now();
  while (!stopRequested && Date.now() - started < maxMinutes * 60 * 1000) {
    try { scheduledBackup(root, { intervalHours: 24, retention: 10 }); } catch { /* backup failure remains visible through supervisor logs */ }
    try { schedulerTick(root, { now: new Date() }); } catch { /* routine failures are durable run records */ }
    reconcileLeasesForProjects(registered);
    const plan = buildDispatchPlan(registered, { active: [...active.values()].map((x) => ({ project: x.project, task: x.task })), maxConcurrent: globalCap, now: Date.now() });
    const available = plan.filter((item) => !active.has(`${item.project}:${item.task}`));
    if (!available.length && !active.size) break;
    for (const item of available) {
      if (active.size >= globalCap) break;
      const project = registered.find((p) => p.id === item.project); const projectActive = [...active.values()].filter((x) => x.project === item.project).length;
      if (!project || projectActive >= Math.min(5, Math.max(1, Number(project.maxConcurrent || 1)))) continue;
      const key = `${item.project}:${item.task}`; const promise = launch(project.root, { confirm: true, taskIds: [item.task], maxMinutes, maxSessions, onProgress: (line) => onProgress(`[${project.name}] ${line}`) }).then((outcome) => { results.push({ project: item.project, task: item.task, outcome }); return outcome; }).catch((error) => { const outcome = { status: "failed", reason: error.message }; results.push({ project: item.project, task: item.task, outcome }); return outcome; }).finally(() => active.delete(key));
      active.set(key, { project: item.project, task: item.task, promise });
    }
    if (active.size) await Promise.race([...active.values()].map((entry) => entry.promise));
  }
  if (stopRequested) for (const entry of active.values()) onProgress(`stopping ${entry.project}:${entry.task}`);
  await Promise.all([...active.values()].map((entry) => entry.promise));
  return { stopped: stopRequested, cap: globalCap, results };
}
function reconcileLeasesForProjects(projects) { for (const project of projects) { try { reconcileLeases(project.root); } catch { /* an unavailable project remains visible to the supervisor */ } } }
