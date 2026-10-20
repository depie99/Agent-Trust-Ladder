// Persistent state store for the atl-manager runner.
// One state.json is the whole brain: when a session dies, the next one
// resumes from here. No hidden state anywhere else.

import fs from "node:fs";
import path from "node:path";

export const STATUSES = [
  "new", "triaged", "assigned", "in_progress", "in_review",
  "verifying", "done", "blocked", "rejected", "escalated",
];

// Who is allowed to drive each transition. The human manager ("manager")
// can always do anything; agents must present the right name.
export const TRANSITIONS = {
  "new->triaged":     { actors: ["pip"],           requires: ["objective", "completion_checks"] },
  "new->rejected":    { actors: ["pip"],           requires: [] },
  "new->blocked":     { actors: ["pip"],           requires: ["blocker"] },
  "triaged->assigned":{ actors: ["mira"],          requires: ["assigned_worker"] },
  "triaged->rejected":{ actors: ["mira"],          requires: [] },
  "triaged->blocked": { actors: ["mira"],          requires: ["blocker"] },
  "assigned->in_progress": { actors: ["rowan", "pip", "sage", "beacon"], requires: [] },
  "assigned->blocked":{ actors: ["rowan", "mira"], requires: ["blocker"] },
  "in_progress->in_review": { actors: ["rowan", "pip", "sage", "beacon"], requires: ["workspace", "evidence"] },
  "in_progress->blocked":   { actors: ["rowan"], requires: ["blocker"] },
  "in_review->verifying":   { actors: ["sage"],  requires: ["review"] },
  "in_review->in_progress": { actors: ["sage"],  requires: ["review"] }, // changes requested
  "in_review->blocked":     { actors: ["sage"],  requires: ["blocker"] },
  "verifying->done":        { actors: ["beacon"], requires: ["all_checks_pass"] },
  "verifying->in_progress": { actors: ["beacon"], requires: [] }, // verification failed, retry
  "verifying->escalated":   { actors: ["beacon"], requires: ["blocker"] },
  "blocked->triaged":       { actors: ["mira", "pip"], requires: [] },
  "escalated->triaged":     { actors: ["mira"],  requires: [] },
};

export class StateError extends Error {}

export function paths(root) {
  return {
    state: path.join(root, ".trust", "manager", "state.json"),
    inbox: path.join(root, ".trust", "manager", "inbox"),
    briefs: path.join(root, ".trust", "manager", "briefs"),
    workspaces: path.join(root, ".trust", "manager", "workspaces"),
    config: path.join(root, "config", "manager.json"),
    routing: path.join(root, "config", "model-routing.json"),
    skillRouting: path.join(root, "config", "skill-routing.json"),
  };
}

export function emptyState() {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tasks: {},
    seq: 0,
    log: [],
  };
}

export function loadState(root) {
  const p = paths(root).state;
  if (!fs.existsSync(p)) {
    throw new StateError(
      `No state file at ${p}. Run: node runtime\\atl-manager.mjs init`
    );
  }
  const state = JSON.parse(fs.readFileSync(p, "utf8"));
  if (state.version !== 1) {
    throw new StateError(`Unsupported state version ${state.version}`);
  }
  return state;
}

export function saveState(root, state) {
  const p = paths(root).state;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  state.updated_at = new Date().toISOString();
  if (state.log.length > 500) state.log = state.log.slice(-500);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

export function nextTaskId(state) {
  state.seq += 1;
  return "T-" + String(state.seq).padStart(3, "0");
}

export function logEvent(state, { task, actor, event, detail }) {
  state.log.push({ at: new Date().toISOString(), task, actor, event, detail });
}

export function createTask(state, fields) {
  const id = nextTaskId(state);
  const now = new Date().toISOString();
  state.tasks[id] = {
    id,
    title: fields.title,
    status: "new",
    source: fields.source || { type: "manual" },
    objective: "",
    completion_checks: [],
    priority: fields.priority || "normal",      // low | normal | high | urgent
    risk: fields.risk || "normal",              // normal | risky
    labels: fields.labels || [],
    selected_skills: fields.selected_skills || [],
    proposed_worker: fields.proposed_worker || null,
    skill_route: fields.skill_route || null,
    review_required: fields.risk === "risky",
    assigned_worker: null,                      // pip | rowan | sage | beacon
    workspace: null,
    attempt_count: 0,
    last_checkpoint: null,                      // { at, note }
    evidence: [],                               // { kind, check, result, detail, actor, at }
    blocker: null,                              // { reason, since, actor }
    next_wake_at: null,
    decision_log: fields.decision_log || [],
    created_at: now,
    updated_at: now,
    intake_key: fields.intake_key || null,      // dedupe key from the source
  };
  return state.tasks[id];
}

function fail(required, task) {
  for (const r of required) {
    if (r === "objective" && !task.objective)
      throw new StateError(`${task.id}: objective is required (set with --set objective=...)`);
    if (r === "completion_checks" && !(task.completion_checks.length > 0))
      throw new StateError(`${task.id}: at least one completion check is required (--check "...")`);
    if (r === "assigned_worker" && !task.assigned_worker)
      throw new StateError(`${task.id}: choose a worker (--to rowan|pip|sage|beacon)`);
    if (r === "workspace" && !task.workspace)
      throw new StateError(`${task.id}: create the isolated workspace first (workspace ${task.id})`);
    if (r === "evidence" && !(task.evidence.some((e) => e.kind === "check")))
      throw new StateError(`${task.id}: at least one observed check result is required (--evidence-pass "...")`);
    if (r === "review") {
      const ok = task.evidence.some((e) => e.kind === "review" && e.result === "approve");
      if (!ok) throw new StateError(`${task.id}: an approved review must be recorded first (--review "approve: ...")`);
    }
    if (r === "blocker" && !task.blocker)
      throw new StateError(`${task.id}: --reason "..." is required to block a task`);
    if (r === "all_checks_pass") {
      const missing = (task.completion_checks || []).filter(
        (c) => !task.evidence.some((e) => e.kind === "check" && e.check === c && e.result === "pass")
      );
      if (missing.length > 0)
        throw new StateError(
          `${task.id}: cannot finish, these checks have no passing evidence: ${missing.join(" | ")}`
        );
      if ((task.review_required || false) && !task.evidence.some((e) => e.kind === "review" && e.result === "approve"))
        throw new StateError(`${task.id}: review_required is set but no approved review exists`);
    }
  }
}

// Apply a status transition with actor + requirement enforcement.
export function transition(state, taskId, toStatus, { actor, note }) {
  const task = state.tasks[taskId];
  if (!task) throw new StateError(`Unknown task ${taskId}`);
  if (!STATUSES.includes(toStatus)) throw new StateError(`Unknown status "${toStatus}"`);
  if (task.status === toStatus) throw new StateError(`${taskId}: already ${toStatus}`);

  const rule = TRANSITIONS[`${task.status}->${toStatus}`];
  if (!rule) throw new StateError(`${taskId}: illegal transition ${task.status} -> ${toStatus}`);
  if (actor !== "manager" && !rule.actors.includes(actor)) {
    throw new StateError(
      `${taskId}: ${task.status} -> ${toStatus} must be performed by ${rule.actors.join(" or ")} (actor was "${actor}")`
    );
  }
  fail(rule.requires, task);

  const from = task.status;
  task.status = toStatus;
  if (toStatus === "in_progress") {
    task.attempt_count += 1;
  }
  if (toStatus === "blocked" || toStatus === "escalated") {
    // handled by caller via setBlocker, but keep state coherent if called raw
    if (!task.blocker) task.blocker = { reason: note || "unspecified", since: new Date().toISOString(), actor };
  }
  if (toStatus === "done") {
    task.blocker = null;
    task.next_wake_at = null;
  }
  task.updated_at = new Date().toISOString();
  logEvent(state, { task: taskId, actor, event: `${from} -> ${toStatus}`, detail: note || "" });
  return task;
}

export function addEvidence(state, taskId, entry, actor) {
  const task = state.tasks[taskId];
  if (!task) throw new StateError(`Unknown task ${taskId}`);
  task.evidence.push({
    kind: entry.kind, check: entry.check || null, result: entry.result || null,
    detail: entry.detail || "", actor, at: new Date().toISOString(),
  });
  task.updated_at = new Date().toISOString();
  logEvent(state, { task: taskId, actor, event: `evidence:${entry.kind}`, detail: entry.detail || entry.check || "" });
}
