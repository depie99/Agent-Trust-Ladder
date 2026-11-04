#!/usr/bin/env node
// Portable outcome economics for the skills-only surface. The Control Plane
// imports this module so both surfaces report the same denominators, coverage
// and decision backlog.
//
// Rules this module enforces:
//   - unknown usage is counted, never priced as zero
//   - a duplicated attempt is reported once and cannot inflate accepted counts
//   - a reservation is charged until it is settled; an unknown settlement stays
//     charged and demands reconciliation
//   - enforcement is claimed only for calls admitted through this wrapper
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ECONOMICS_VERSION = 1;
export const ATTEMPT_STATUSES = Object.freeze(["completed", "failed", "repaired", "cancelled", "blocked", "running"]);

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);

export function outcomeSummary(records = [], { expectedAttempts = null } = {}) {
  const seen = new Set();
  const duplicates = [];
  const attempts = [];
  for (const [index, record] of records.entries()) {
    const id = String(record.attempt_id || record.session_id || `${record.task_id || "unknown"}#${index}`);
    if (seen.has(id)) { duplicates.push(id); continue; }
    seen.add(id);
    attempts.push({ ...record, attempt_id: id });
  }
  const counts = { attempted: attempts.length, completed: 0, accepted: 0, failed: 0, repaired: 0, cancelled: 0, blocked: 0, running: 0 };
  for (const attempt of attempts) {
    const status = ATTEMPT_STATUSES.includes(attempt.status) ? attempt.status : "running";
    counts[status] += 1;
    if (status === "completed" && attempt.accepted !== false) counts.accepted += 1;
  }
  const measured = attempts.filter((attempt) => attempt.tokens && attempt.tokens.total != null);
  const unknownAttempts = attempts.length - measured.length;
  const sum = (field) => (measured.length && measured.every((attempt) => attempt.tokens[field] != null)
    ? measured.reduce((total, attempt) => total + Number(attempt.tokens[field]), 0)
    : null);
  const wall = attempts.filter((attempt) => typeof attempt.wall_ms === "number");
  const reviewerMinutes = attempts.reduce((total, attempt) => total + Number(attempt.review_minutes || 0), 0);
  const gaps = [
    ...attempts.filter((attempt) => !attempt.tokens || attempt.tokens.total == null).map((attempt) => ({ kind: "missing-telemetry", attempt_id: attempt.attempt_id, task_id: attempt.task_id || null })),
    ...attempts.filter((attempt) => attempt.wrapped === false || attempt.external === true).map((attempt) => ({ kind: "outside-admission-boundary", attempt_id: attempt.attempt_id, task_id: attempt.task_id || null })),
  ];
  return {
    version: ECONOMICS_VERSION,
    denominators: {
      tasks: new Set(attempts.map((attempt) => attempt.task_id).filter(Boolean)).size,
      attempts: attempts.length,
      expected_attempts: expectedAttempts ?? attempts.length,
      duplicate_attempts_ignored: duplicates.length,
      duplicates,
    },
    outcomes: counts,
    usage: {
      measured_attempts: measured.length,
      unknown_attempts: unknownAttempts,
      coverage: attempts.length === 0 ? "unknown" : unknownAttempts === 0 ? "complete" : measured.length === 0 ? "unknown" : "partial",
      input: sum("input"),
      output: sum("output"),
      cached_input: sum("cached_input"),
      total: sum("total"),
      note: "unknown attempts are counted separately and never priced as zero",
    },
    effort: {
      wall_ms: wall.length ? wall.reduce((total, attempt) => total + attempt.wall_ms, 0) : null,
      reviewer_minutes: reviewerMinutes,
      manual_interventions: attempts.filter((attempt) => attempt.manual_intervention === true).length,
    },
    coverage_gaps: gaps,
  };
}

export function createLedger({ window = null } = {}) {
  return { version: ECONOMICS_VERSION, window: window || new Date().toISOString().slice(0, 10), reservations: [], settlements: [], gaps: [] };
}

export function economicsPaths(root) {
  const dir = path.join(root, ".atl", "economics");
  return { dir, ledger: path.join(dir, "ledger.json") };
}

export function loadLedger(root) {
  const file = economicsPaths(root).ledger;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("ledger is not an object");
    return { ...createLedger({ window: parsed.window }), ...parsed, reservations: parsed.reservations || [], settlements: parsed.settlements || [], gaps: parsed.gaps || [] };
  } catch (error) {
    if (error.code === "ENOENT") return createLedger();
    // A lost ledger cannot silently reset allowances; the gap is visible.
    const ledger = createLedger();
    ledger.corrupt = true;
    recordGap(ledger, { kind: "ledger-corrupt", detail: error.message });
    return ledger;
  }
}

export function saveLedger(root, ledger) {
  const { dir, ledger: file } = economicsPaths(root);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2) + "\n");
  fs.renameSync(temporary, file);
  return file;
}

export function windowUsage(ledger, windowId = ledger.window) {
  const held = ledger.reservations.filter((item) => item.window === windowId && item.state !== "settled").reduce((total, item) => total + Number(item.cost || 0), 0);
  const charged = ledger.settlements.filter((item) => item.window === windowId).reduce((total, item) => total + Number(item.charged || 0), 0);
  return { window: windowId, held, charged, total: held + charged };
}

export function admitCall(ledger, { key, cost = 0, limit = 0, windowId = ledger.window, now = Date.now() } = {}) {
  if (!key) throw new Error("admission needs the wrapped tool or API key");
  const usage = windowUsage(ledger, windowId);
  if (Number(limit) > 0 && usage.total + Number(cost) > Number(limit)) {
    return { admitted: false, reason: "quota", limit: Number(limit), usage, boundary: "wrapped" };
  }
  const reservation = {
    reservation_id: `res-${digest(`${key}:${windowId}:${ledger.reservations.length}:${now}`)}`,
    key, cost: Number(cost) || 0, window: windowId,
    created_at: new Date(now).toISOString(), state: "held",
  };
  ledger.reservations.push(reservation);
  return { admitted: true, reservation, limit: Number(limit) || null, usage: windowUsage(ledger, windowId), boundary: "wrapped" };
}

export function settleCall(ledger, { reservation_id, actual = null, charged = null, now = Date.now(), note = "" } = {}) {
  const reservation = ledger.reservations.find((item) => item.reservation_id === reservation_id);
  if (!reservation) throw new Error(`unknown reservation: ${reservation_id}`);
  if (reservation.state === "settled") throw new Error(`reservation already settled: ${reservation_id}`);
  const unknown = actual == null && charged == null;
  const value = unknown ? reservation.cost : Number(charged != null ? charged : actual);
  if (!unknown && (!Number.isFinite(value) || value < 0)) throw new Error("a settled charge must be a non-negative number");
  reservation.state = "settled";
  reservation.settled_at = new Date(now).toISOString();
  const settlement = { reservation_id, key: reservation.key, window: reservation.window, charged: value, unknown_effect: unknown, reconciliation_required: unknown, note };
  ledger.settlements.push(settlement);
  return { ...settlement, usage: windowUsage(ledger, reservation.window) };
}

export function reconcileCall(ledger, { reservation_id, actual, now = Date.now(), note = "late reconciliation" } = {}) {
  const settlement = [...ledger.settlements].reverse().find((item) => item.reservation_id === reservation_id);
  if (!settlement) throw new Error(`unknown settlement: ${reservation_id}`);
  if (!settlement.reconciliation_required) return { ...settlement, reconciled: false, reason: "settlement already had a measured charge" };
  if (!Number.isFinite(Number(actual)) || Number(actual) < 0) throw new Error("reconciliation needs the real non-negative charge");
  settlement.charged = Number(actual);
  settlement.reconciliation_required = false;
  settlement.reconciled_at = new Date(now).toISOString();
  settlement.note = note;
  return { ...settlement, reconciled: true, usage: windowUsage(ledger, settlement.window) };
}

export function pendingReconciliation(ledger) {
  return ledger.settlements.filter((item) => item.reconciliation_required).map((item) => ({ reservation_id: item.reservation_id, key: item.key, window: item.window, held_charge: item.charged }));
}

export function recordGap(ledger, { kind, detail = "", at = new Date().toISOString() } = {}) {
  if (!kind) throw new Error("a coverage gap needs a kind");
  const gap = { kind, detail, at };
  ledger.gaps.push(gap);
  return gap;
}

export function reviewCapacity({ pending = 0, limit = 3, decisions = [] } = {}) {
  const open = Math.max(0, Number(pending) || 0);
  const capped = Math.max(1, Number(limit) || 1);
  const over = open >= capped;
  return {
    pending: open,
    limit: capped,
    admission: over ? "stopped" : "open",
    over_limit: over,
    message: over
      ? `Review capacity reached (${open}/${capped}). New unattended work stops until a decided review is recorded; inspection and reconciliation stay available.`
      : `${open}/${capped} reviews pending. New work may be admitted.`,
    next_decision: decisions[0] || null,
    backlog: decisions,
  };
}

export function economicsReport({ ledger = null, records = [], expectedAttempts = null, review = null } = {}) {
  const summary = outcomeSummary(records, { expectedAttempts });
  return {
    version: ECONOMICS_VERSION,
    summary,
    admission: ledger ? {
      window: ledger.window,
      usage: windowUsage(ledger),
      enforcement: "claimed only for calls admitted through admitCall",
      enforcement_scope: "wrapped",
      pending_reconciliation: pendingReconciliation(ledger),
      gaps: ledger.gaps,
    } : null,
    review: review ? reviewCapacity(review) : null,
  };
}
