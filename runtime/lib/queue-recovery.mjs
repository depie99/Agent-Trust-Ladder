// Durable budgets belong to blocker identities, never to runner lifetimes.
import crypto from "node:crypto";
import { loadState, saveState, reviseTaskPacket } from "./state.mjs";

export function recordBlocker(task, failure) {
  const cause = failure.cause || "execution";
  const id = crypto.createHash("sha256").update(`${cause}:${failure.identity || failure.reason}`).digest("hex");
  task.recovery_records ||= [];
  let record = task.recovery_records.find((item) => item.id === id);
  if (!record) {
    record = { version: 1, id, cause, reason: failure.reason, evidence: failure.evidence || [], recovery_owner: failure.recovery_owner || "mira", attempts: [], status: "waiting" };
    task.recovery_records.push(record);
  }
  task.recovery = record;
  if (failure.recovery_owner && record.recovery_owner !== "owner") record.recovery_owner = failure.recovery_owner;
  if (record.status === "resolved") {
    record.status = "exhausted";
    record.escalation = "unchanged failure recurred after a successful repair preflight";
  }
  task.waiting_reason = failure.reason;
  task.blocker = { ...(typeof task.blocker === "object" ? task.blocker : {}), version: 1, recovery_id: id, reason: failure.reason, cause, evidence: record.evidence, recovery_owner: record.recovery_owner, since: task.blocker?.since || new Date().toISOString(), actor: task.blocker?.actor || "mira" };
  return record;
}
export function attemptsRemaining(record) { return record.status === "exhausted" ? 0 : Math.max(0, 2 - record.attempts.length); }
export async function repairBlocker(root, taskId, { action, remedy, preflight, maxAttempts = 2 }) {
  let state = loadState(root); let task = state.tasks[taskId]; const record = task.recovery_records?.find((item) => item.id === task.recovery?.id);
  if (!record) return { recovered: false, reason: "no structured blocker" };
  task.recovery = record;
  if (record.recovery_owner === "owner") return { recovered: false, kind: "owner-blocked" };
  const interrupted = record.attempts.find((item) => item.action === action && item.status === "repairing");
  if (interrupted) {
    // The remedy may already have completed. Observe its postcondition rather
    // than repeating a mutation or restoring its consumed attempt allowance.
    const result = await preflight(task, state.tasks);
    interrupted.preflight = result; interrupted.status = result.ready ? "repaired" : "failed";
    record.status = result.ready ? "resolved" : attemptsRemaining(record) ? "waiting" : "exhausted";
    task.waiting_reason = result.ready ? null : result.reason; saveState(root, state);
    return { recovered: Boolean(result.ready), kind: record.status, result, resumed: true };
  }
  if (record.status === "exhausted" || record.attempts.length >= Math.min(2, Math.max(0, maxAttempts)) || !attemptsRemaining(record) || record.attempts.some((attempt) => attempt.action === action)) {
    record.status = "exhausted"; saveState(root, state); return { recovered: false, kind: "exhausted" };
  }
  const attempt = { action, status: "repairing", started_at: new Date().toISOString() };
  record.attempts.push(attempt); record.status = "repairing"; saveState(root, state);
  try {
    const evidence = await remedy(task);
    // Reload after a runtime/Pip action so concurrent packet updates survive.
    state = loadState(root); task = state.tasks[taskId];
    const current = task.recovery_records.find((item) => item.id === record.id);
    const persisted = current.attempts.find((item) => item.action === action);
    persisted.evidence = evidence;
    const result = await preflight(task, state.tasks);
    persisted.preflight = result; persisted.status = result.ready ? "repaired" : "failed";
    current.status = result.ready ? "resolved" : attemptsRemaining(current) ? "waiting" : "exhausted";
    task.recovery = current;
    task.waiting_reason = result.ready ? null : result.reason;
    if (!result.ready && result.recovery_owner === "owner") current.recovery_owner = "owner";
    saveState(root, state);
    return { recovered: Boolean(result.ready), kind: current.status, result };
  } catch (error) {
    state = loadState(root); task = state.tasks[taskId];
    const current = task.recovery_records.find((item) => item.id === record.id);
    const persisted = current.attempts.find((item) => item.action === action);
    persisted.status = "failed"; persisted.error = error.message;
    current.status = attemptsRemaining(current) ? "waiting" : "exhausted";
    task.recovery = current; saveState(root, state);
    return { recovered: false, kind: current.status, reason: error.message };
  }
}

export function repairContract(root, taskId, patch, { objective, budgetApproved = false, evidence = "" } = {}) {
  const state = loadState(root); const task = state.tasks[taskId];
  if (!budgetApproved || objective !== task.objective || task.pip_repair) throw new Error("Pip repair requires the approved objective, budget, and unused repair allowance");
  if (task.pip_repair_request && task.pip_repair_request.objective !== task.objective) throw new Error("Pip repair objective differs from the approved request");
  if (!String(evidence).trim()) throw new Error("Pip repair requires evidence explaining the revision");
  // Acceptance is immutable during automatic repair. Pip may repair ownership,
  // dependency and verifier assumptions, with every old observation invalidated.
  if (Object.keys(patch).some((key) => !["plan_depends_on", "dispatch_contract", "check_owners"].includes(key))) throw new Error("automatic repair cannot weaken acceptance");
  if (patch.dispatch_contract) {
    if ((task.dispatch_contract?.commands || []).length && !(patch.dispatch_contract.commands || []).length) throw new Error("repair cannot remove verification commands");
    if ((task.dispatch_contract?.artifacts || []).some((name) => !(patch.dispatch_contract.artifacts || []).includes(name))) throw new Error("repair cannot remove prerequisite artifacts");
  }
  for (const id of patch.plan_depends_on || []) if (task.plan_draft_id && state.tasks[id]?.plan_draft_id !== task.plan_draft_id) throw new Error("repair cannot add prerequisites outside the approved plan");
  const proposed = { ...task, ...patch };
  validateContracts({ ...state.tasks, [taskId]: proposed });
  Object.assign(task, patch);
  task.pip_repair = { version: 1, evidence, previous_revision: task.packet_revision || 1, at: new Date().toISOString() };
  reviseTaskPacket(state, taskId, { actor: "pip", reason: "bounded contract repair" });
  const affected = new Set([taskId]);
  let changed = true;
  while (changed) { changed = false; for (const peer of Object.values(state.tasks)) if (!affected.has(peer.id) && (peer.plan_depends_on || []).some((id) => affected.has(id))) { affected.add(peer.id); changed = true; } }
  for (const id of affected) {
    const peer = state.tasks[id];
    if (id !== taskId) reviseTaskPacket(state, id, { actor: "pip", reason: `input contract repaired: ${taskId}` });
    for (const item of peer.evidence || []) item.invalidated = true;
    peer.handoff = null; peer.dispatch_preflight = null;
    if (id !== taskId && peer.status === "done") {
      // Invalidation restores a previously traversed build gate. It cannot
      // grant completion: Rowan, Sage and Beacon must produce fresh evidence.
      peer.status = "assigned"; peer.assigned_worker = "rowan"; peer.review_required = true;
      peer.revalidation_requested = { version: 1, input: taskId, reason: "upstream contract evidence invalidated" };
      state.log.push({ at: new Date().toISOString(), task: id, actor: "mira", event: "evidence-invalidated-reopen", detail: `Reopened after contract repair of ${taskId}; execution allowance retained` });
    }
  }
  saveState(root, state); return task;
}
export function validateContracts(tasks) {
  const visited = new Set(); const visiting = new Set();
  function visit(task) {
    if (visiting.has(task.id)) throw new Error(`prerequisite cycle: ${task.id}`);
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const id of task.plan_depends_on || task.depends_on || []) {
      if (!tasks[id]) throw new Error(`unknown prerequisite: ${id}`);
      visit(tasks[id]);
    }
    visiting.delete(task.id); visited.add(task.id);
  }
  for (const task of Object.values(tasks)) visit(task);
  for (const task of Object.values(tasks)) {
    for (const owner of Object.values(task.check_owners || {})) {
      if (!tasks[owner]) throw new Error(`unknown check owner: ${owner}`);
      const depends = (candidate, target, seen = new Set()) => {
        if (seen.has(candidate.id)) return false; seen.add(candidate.id);
        return (candidate.plan_depends_on || candidate.depends_on || []).some((id) => id === target || depends(tasks[id], target, seen));
      };
      if (owner !== task.id && depends(tasks[owner], task.id)) throw new Error(`${task.id}: check owned by downstream stage ${owner}`);
    }
  }
}

export function selectedContracts(tasks, ids) {
  const selected = {};
  const collect = (id) => {
    if (selected[id] || !tasks[id]) return;
    selected[id] = tasks[id];
    for (const dependency of [...(tasks[id].plan_depends_on || []), ...Object.values(tasks[id].check_owners || {})]) collect(dependency);
  };
  for (const id of ids) collect(id);
  return selected;
}
