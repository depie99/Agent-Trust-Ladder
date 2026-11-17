// Persistent state store for the atl-manager runner.
// One state.json is the whole brain: when a session dies, the next one
// resumes from here. No hidden state anywhere else.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { latestTaskEvidence } from "./task-diagnostics.mjs";

const contractFile = new URL("../../config/manager-state-contract.json", import.meta.url);
export const STATE_CONTRACT = JSON.parse(fs.readFileSync(contractFile, "utf8"));
export const STATUSES = STATE_CONTRACT.statuses;

// The human manager ("manager") can always do anything; agents must present
// the actor named by this shared contract.
export const TRANSITIONS = STATE_CONTRACT.transitions;

export class StateError extends Error {}

export function paths(root) {
  return {
    state: path.join(root, ".trust", "manager", "state.json"),
    queue: path.join(root, ".trust", "manager", "queue.json"),
    notifications: path.join(root, ".trust", "manager", "notifications.jsonl"),
    usage: path.join(root, ".trust", "manager", "usage.json"),
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
    revision: 0,
    log: [],
  };
}

export function loadState(root) {
  const p = paths(root).state;
  if (!fs.existsSync(p)) {
    throw new StateError(
      `No state file at ${p}. Run: atl init`
    );
  }
  const state = JSON.parse(fs.readFileSync(p, "utf8"));
  if (state.version !== 1) {
    throw new StateError(`Unsupported state version ${state.version}`);
  }
  return state;
}

// Windows note: under contention openSync("wx") reports EPERM (not EEXIST)
// when another process is creating or removing the same lock path, and rename
// fails with EPERM while a reader still holds the destination open.
function acquireLock(lock, label) {
  const deadline = Date.now() + 10000;
  let lockFd;
  while (lockFd === undefined) {
    try {
      lockFd = fs.openSync(lock, "wx", 0o600);
      fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, created_at: Date.now() }));
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (probe) { alive = probe.code === "EPERM"; }
        if (!alive && Date.now() - Number(owner.created_at || 0) > 1000) fs.rmSync(lock, { force: true });
      } catch { /* A newly-created lock may not have its metadata yet. */ }
      if (Date.now() >= deadline) throw new StateError(`Timed out waiting for ${label} lock ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  return lockFd;
}

// Only remove a lock whose recorded owner is this process: a stolen lock path
// must never be deleted out from under its new owner.
function releaseLock(lock) {
  try {
    const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
    if (owner.pid !== process.pid) return;
  } catch { return; }
  fs.rmSync(lock, { force: true });
}

export function saveState(root, state, { expectedRevision = null } = {}) {
  const p = paths(root).state;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const lock = `${p}.lock`;
  const lockFd = acquireLock(lock, "state");
  try {
    const current = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
    const expected = expectedRevision ?? state.revision ?? 0;
    if ((current?.revision || 0) !== expected)
      throw new StateError(`state revision conflict: expected ${expected}, found ${current?.revision || 0}; reload state and retry`);
    state.updated_at = new Date().toISOString();
    state.revision = (current?.revision || state.revision || 0) + 1;
    if (state.log.length > 500) state.log = state.log.slice(-500);
    const tmp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(tmp, p); break; }
        catch (error) {
          if (error.code !== "EPERM" || attempt >= 6) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
        }
      }
    } finally { fs.rmSync(tmp, { force: true }); }
  } finally {
    fs.closeSync(lockFd);
    releaseLock(lock);
  }
}

// Read-modify-write with retry: reloads and re-runs the mutator when another
// writer won the race (issue #31 — concurrent composes must not lose tasks).
// The mutator must be idempotent enough to re-run; compose/intake are
// idempotent by content/intake_key.
export function mutateState(root, mutator, { attempts = 64 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.floor(Math.min(250, 10 + Math.random() * 20 * attempt)));
    const state = loadState(root);
    const result = mutator(state);
    try {
      saveState(root, state);
      return { state, result };
    } catch (error) {
      if (error instanceof StateError && /revision conflict/.test(error.message)) { lastError = error; continue; }
      throw error;
    }
  }
  throw new StateError(`state kept changing under ${attempts} attempts; ${lastError?.message || "retry later"}`);
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
    resources: Array.isArray(fields.resources) ? fields.resources : [],
    objective: "",
    packet_revision: 1,
    packet_approved_revision: null,
    completion_checks: [],
    priority: fields.priority || "normal",      // low | normal | high | urgent
    risk: fields.risk || "normal",              // normal | risky
    labels: fields.labels || [],
    selected_skills: fields.selected_skills || [],
    proposed_worker: fields.proposed_worker || null,
    skill_route: fields.skill_route || null,
    review_required: fields.risk === "risky",
    plan_review_required: Boolean(fields.plan_review_required),
    plan_reviewed_by_draft: fields.plan_reviewed_by_draft || null,
    assigned_worker: null,                      // pip | rowan | sage | beacon
    workspace: null,
    attempt_count: 0,
    auto_recovery_count: 0,
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
      const ok = latestTaskEvidence(task, "review")?.result === "approve";
      if (!ok) throw new StateError(`${task.id}: an approved review must be recorded first (--review "approve: ...")`);
    }
    if (r === "review_approved") {
      const ok = latestTaskEvidence(task, "review")?.result === "approve";
      if (!ok) throw new StateError(`${task.id}: an approved review must be recorded first (--review "approve: ...")`);
    }
    if (r === "review_changes_requested") {
      const ok = latestTaskEvidence(task, "review")?.result === "changes-requested";
      if (!ok) throw new StateError(`${task.id}: a changes-requested review must be recorded first (--review "changes-requested: ...")`);
    }
    if (r === "blocker" && !task.blocker)
      throw new StateError(`${task.id}: --reason "..." is required to block a task`);
    if (r === "all_checks_pass") {
      const missing = (task.completion_checks || []).filter(
        (c) => {
          const e = latestTaskEvidence(task, "check", c);
          const review = latestTaskEvidence(task, "review");
          const rejected = review?.result === "changes-requested" && task.evidence.indexOf(e) < task.evidence.indexOf(review);
          return !e || e.result !== "pass" || e.coverage === "partial" || rejected || (task.evidence_contract === 2 && (e.coverage !== "complete" || !e.code_revision));
        }
      );
      if (missing.length > 0)
        throw new StateError(
          `${task.id}: cannot finish, these checks have no passing evidence: ${missing.join(" | ")}`
        );
      if ((task.review_required || false) && latestTaskEvidence(task, "review")?.result !== "approve")
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
  if (entry.kind === "review" && !["sage", "manager"].includes(actor)) throw new StateError("Sage owns independent review");
  if (entry.kind === "browser-journey" && !["beacon", "manager"].includes(actor)) throw new StateError("Beacon owns integrated browser verification");
  if (entry.kind === "check" && (!entry.check || ![...task.completion_checks, ...(task.integrated_checks || [])].includes(entry.check))) {
    throw new StateError(`${task.id}: evidence must copy one completion check verbatim (--evidence-pass/--evidence-fail)`);
  }
  if (entry.result === "pass" && entry.coverage === "partial") throw new StateError(`${task.id}: partial observations cannot pass a complete check`);
  if (task.evidence_contract === 2 && entry.kind === "check" && entry.result === "pass" && (entry.coverage !== "complete" || !entry.code_revision)) throw new StateError(`${task.id}: complete coverage and an output revision are required for passing evidence`);
  task.evidence.push({
    kind: entry.kind, check: entry.check || null, result: entry.result || null,
    detail: entry.detail || "", actor, at: new Date().toISOString(), packet_revision: task.packet_revision || 1,
    code_revision: entry.code_revision || null, session_id: entry.session_id || null,
    command: entry.command || null, exit_code: entry.exit_code ?? null, artifact_hash: entry.artifact_hash || null,
    coverage: entry.coverage || null,
  });
  task.updated_at = new Date().toISOString();
  logEvent(state, { task: taskId, actor, event: `evidence:${entry.kind}`, detail: entry.detail || entry.check || "" });
}

// A changed task contract invalidates evidence tied to an older contract.
// Evidence is retained for audit; gates only consider the current revision.
export function reviseTaskPacket(state, taskId, { actor = "manager", reason = "task packet changed" } = {}) {
  const task = state.tasks[taskId];
  if (!task) throw new StateError(`Unknown task ${taskId}`);
  task.packet_revision = (task.packet_revision || 1) + 1;
  task.attempt_count_at_revision = task.attempt_count || 0;
  task.packet_approved_revision = null;
  task.updated_at = new Date().toISOString();
  logEvent(state, { task: taskId, actor, event: "packet-revised", detail: `${reason}; revision=${task.packet_revision}` });
  return task;
}
