// Dependency-aware readiness for the task graph.
//
// Tasks may carry `depends_on: [task-id, ...]`. A task is READY when every
// dependency is satisfied (done or archived); WAITING when at least one
// dependency is still open; and STUCK-FOREVER when it sits inside a
// dependency cycle, which no amount of waiting resolves. This module is
// read-only: it computes views over state.json; it never mutates state.
// Verification lives in verification/dependencies_test.mjs and
// verification/dependencies_model.py (exhaustive small-graph model check).

export const SATISFIED = ["done", "archived"];
export const TERMINAL = ["done", "rejected", "archived"];
export const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

export function dependsOn(task) {
  return Array.isArray(task?.depends_on) ? task.depends_on.map(String) : [];
}

function isSatisfied(task) {
  return SATISFIED.includes(task.status);
}

function isTerminal(task) {
  return TERMINAL.includes(task.status);
}

export function orderTasks(tasks) {
  return [...tasks].sort((a, b) =>
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    || String(a.id).localeCompare(String(b.id)));
}

// Build the dependency graph over all tasks in state.
// unknown: dependencies that point at task ids that do not exist.
export function buildGraph(state) {
  const tasks = state.tasks || {};
  const unknown = [];
  const depsById = {};
  for (const task of Object.values(tasks)) {
    const deps = dependsOn(task);
    depsById[task.id] = deps;
    for (const d of deps) if (!tasks[d]) unknown.push({ id: task.id, depends_on: d });
  }
  return { tasks, depsById, unknown };
}

// Detect dependency cycles among non-satisfied edges. Returns arrays of
// task ids like ["A", "B", "A"]; satisfied deps can never close a cycle.
export function findCycles(graph) {
  const tasks = graph.tasks;
  const open = {};
  for (const [id, deps] of Object.entries(graph.depsById)) {
    if (!tasks[id]) continue;
    open[id] = deps.filter((d) => tasks[d] && !isSatisfied(tasks[d]));
  }
  const color = {}; // 0 unvisited, 1 in stack, 2 done
  const stack = [];
  const cycles = [];
  const visit = (id) => {
    color[id] = 1;
    stack.push(id);
    for (const dep of open[id] || []) {
      if (color[dep] === 1) {
        const at = stack.indexOf(dep);
        cycles.push([...stack.slice(at), dep]);
      } else if (!color[dep]) {
        visit(dep);
      }
    }
    stack.pop();
    color[id] = 2;
  };
  for (const id of Object.keys(open)) if (!color[id]) visit(id);
  return cycles;
}

// Full readiness view:
//   ready   — open tasks whose deps are all satisfied (launchable now)
//   waiting — open tasks with unsatisfied deps, each listing what it waits for
//   stuck   — open tasks inside a cycle, or transitively depending on one
//   unknown — edges pointing at nonexistent task ids
export function analyzeReadiness(state) {
  const graph = buildGraph(state);
  const cycles = findCycles(graph);
  const stuckIds = new Set();
  for (const cyc of cycles) for (const id of new Set(cyc)) stuckIds.add(id);

  // Propagate stuck-ness to everything that (transitively) depends on a
  // stuck task — waiting on a stuck dependency never resolves either.
  // A dependency that already ended unsatisfied (rejected) can never be
  // satisfied either, so its dependents are stuck from the start.
  for (const task of Object.values(graph.tasks)) {
    if (isTerminal(task)) continue;
    if (dependsOn(task).some((d) => graph.tasks[d] && graph.tasks[d].status === "rejected")) {
      stuckIds.add(task.id);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, deps] of Object.entries(graph.depsById)) {
      if (stuckIds.has(id) || !graph.tasks[id] || isTerminal(graph.tasks[id])) continue;
      if (deps.some((d) => stuckIds.has(d))) {
        stuckIds.add(id);
        grew = true;
      }
    }
  }

  const ready = [];
  const waiting = [];
  for (const task of Object.values(graph.tasks)) {
    if (isTerminal(task)) continue;
    const unmet = dependsOn(task)
      .filter((d) => graph.tasks[d] && !isSatisfied(graph.tasks[d]))
      .map((d) => ({ id: d, status: graph.tasks[d].status }));
    if (stuckIds.has(task.id)) continue; // reported via stuck below
    if (unmet.length === 0) ready.push(task);
    else waiting.push({ task, unmet });
  }
  const stuck = [...stuckIds].map((id) => graph.tasks[id]).filter((t) => t && !isTerminal(t));
  return {
    ready: orderTasks(ready),
    waiting: orderTasks(waiting.map((w) => w.task)).map((task) => ({
      task,
      unmet: waiting.find((w) => w.task.id === task.id).unmet,
    })),
    stuck: orderTasks(stuck),
    cycles,
    unknown: graph.unknown,
  };
}

export function renderReadiness(analysis) {
  const L = [];
  L.push(`Ready now (${analysis.ready.length}):`);
  if (!analysis.ready.length) L.push("  (none)");
  for (const t of analysis.ready) {
    L.push(`  ${t.id}  [${t.priority}] ${t.status.padEnd(11)} ${t.title}`);
  }
  L.push(`Waiting on dependencies (${analysis.waiting.length}):`);
  if (!analysis.waiting.length) L.push("  (none)");
  for (const w of analysis.waiting) {
    const needs = w.unmet.map((u) => `${u.id}(${u.status})`).join(", ");
    L.push(`  ${w.task.id}  [${w.task.priority}] ${w.task.title}\n        waits for ${needs}`);
  }
  if (analysis.stuck.length) {
    L.push(`Stuck in dependency cycles (${analysis.stuck.length}) — needs a human:`);
    for (const t of analysis.stuck) L.push(`  ${t.id}  ${t.title}`);
  }
  if (analysis.cycles.length) {
    for (const c of analysis.cycles) L.push(`  cycle: ${c.join(" -> ")}`);
  }
  if (analysis.unknown.length) {
    L.push(`Unknown dependency ids (${analysis.unknown.length}):`);
    for (const u of analysis.unknown) L.push(`  ${u.id} depends on missing task ${u.depends_on}`);
  }
  return L.join("\n");
}
