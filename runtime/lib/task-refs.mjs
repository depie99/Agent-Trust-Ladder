// One project model (issue #34): task ids are qualified outside their project
// as `<project>:T-001`. Inside the owning project the bare T-### stays the
// durable id; qualification exists only for cross-project surfaces (the
// supervisor registry, project work map, repository cards), which resolve a
// qualified reference back to its project and task.
import { loadState } from "./state.mjs";
import { supervisorSnapshot } from "./supervisor.mjs";

const QUALIFIED = /^(.+):(T-\d{3,})$/;

export function qualifyTaskId(project, taskId) {
  return `${project.id}:${taskId}`;
}

export function parseQualifiedTaskId(reference) {
  const match = QUALIFIED.exec(String(reference || "").trim());
  if (!match) return null;
  return { qualifier: match[1], taskId: match[2] };
}

// Resolve a bare or qualified task reference against the supervisor registry.
// A bare T-### resolves in the given project; `<id>:T-###` resolves in the
// registered project it names (by project id, or by exact name when unambiguous).
export function resolveTaskRef(root, reference, { projectRoot = root } = {}) {
  const raw = String(reference || "").trim();
  if (!raw) return null;
  const qualified = parseQualifiedTaskId(raw);
  if (!qualified) {
    const state = loadState(projectRoot);
    return { project: null, taskId: raw, task: state.tasks[raw] || null };
  }
  const projects = supervisorSnapshot().projects || [];
  const target = projects.find((project) => project.id === qualified.qualifier)
    || projects.filter((project) => project.name === qualified.qualifier).at(0)
    || null;
  if (!target) {
    throw new Error(`unknown project qualifier "${qualified.qualifier}" — use <project-id>:T-001 from the Projects registry`);
  }
  const state = loadState(target.root);
  return { project: target, taskId: qualified.taskId, task: state.tasks[qualified.taskId] || null };
}
