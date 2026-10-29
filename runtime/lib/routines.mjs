// Durable routine scheduler. It only creates internal ATL run records;
// external delivery is intentionally hard-disabled.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { listRoutines } from "./governance.mjs";
const file = (root) => path.join(root, ".trust", "manager", "routine-runs.json");
const empty = () => ({ version: 2, scheduler: { status: "stopped", heartbeat_at: null, pid: null, cursor: 0 }, runs: [] });
function load(root) { try { return JSON.parse(fs.readFileSync(file(root), "utf8")); } catch (error) { if (error.code === "ENOENT") return empty(); throw error; } }
function save(root, state) { fs.mkdirSync(path.dirname(file(root)), { recursive: true }); const tmp = `${file(root)}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n"); fs.renameSync(tmp, file(root)); }
function fields(value, min, max) { if (value === "*") return null; return String(value).split(",").map((part) => { const n = Number(part); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid cron field ${value}`); return n; }); }
function cronMatch(expression, date, timezone = "Asia/Tehran") { const parts = String(expression || "").trim().split(/\s+/); if (parts.length !== 5) throw new Error("cron schedule requires five fields"); const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, minute: "2-digit", hour: "2-digit", day: "2-digit", month: "2-digit", weekday: "short" }); const values = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])); const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday); const match = (field, n) => field == null || field.includes(n); return match(fields(parts[0], 0, 59), Number(values.minute)) && match(fields(parts[1], 0, 23), Number(values.hour)) && match(fields(parts[2], 1, 31), Number(values.day)) && match(fields(parts[3], 1, 12), Number(values.month)) && match(fields(parts[4], 0, 6), weekday); }
function sourceFingerprint(routine, source) { return source || routine.source_fingerprint || routine.idempotency_key || "manual"; }
function appendRun(state, routine, { sourceFingerprint: source = null, dryRun = true, now = new Date(), reason = "manual", occurrence = null } = {}) {
  const fingerprint = sourceFingerprint(routine, source);
  const key = `${routine.id}:${routine.skill_version}:${fingerprint}${occurrence ? `:${occurrence}` : ""}`;
  const statuses = dryRun ? ["preview"] : ["queued", "running", "complete"];
  const existing = state.runs.find((run) => run.idempotency_key === key && statuses.includes(run.status));
  if (existing) return { duplicate: true, run: existing };
  const run = { id: `RR-${crypto.randomUUID()}`, routine_id: routine.id, skill_id: routine.skill_id, skill_version: routine.skill_version, idempotency_key: key, source_fingerprint: fingerprint, occurrence, project: routine.project, trigger_reason: reason, status: dryRun ? "preview" : "queued", created_at: now.toISOString(), attempts: 0, next_retry_at: null, external_delivery: "disabled" };
  state.runs.push(run);
  return { duplicate: false, run };
}
export function runRoutine(root, routineId, options = {}) {
  const routine = listRoutines(root).find((entry) => entry.id === routineId);
  if (!routine) throw new Error(`unknown routine ${routineId}`);
  if (!routine.enabled) throw new Error(`routine ${routineId} is disabled`);
  const state = load(root);
  const result = appendRun(state, routine, options);
  if (!result.duplicate) save(root, state);
  return result;
}
export function schedulerTick(root, { now = new Date(), event = null, sourceFingerprint: source = null } = {}) {
  const state = load(root);
  const routines = listRoutines(root);
  const created = [];
  const minute = new Date(now); minute.setSeconds(0, 0);
  state.scheduler = { ...(state.scheduler || {}), status: "running", heartbeat_at: now.toISOString(), pid: process.pid, cursor: (state.scheduler?.cursor || 0) + 1 };
  for (const failed of state.runs.filter((run) => run.status === "failed" && run.next_retry_at && new Date(run.next_retry_at) <= now)) {
    const routine = routines.find((entry) => entry.id === failed.routine_id);
    const limit = Math.min(2, Number(routine?.retry_limit ?? 2));
    if (!routine || !routine.enabled || failed.attempts >= limit) { failed.next_retry_at = null; continue; }
    failed.status = "queued"; failed.attempts += 1; failed.retry_of = failed.retry_of || failed.id; failed.next_retry_at = null;
    created.push(failed);
  }
  for (const routine of routines) {
    if (!routine.enabled) continue;
    const trigger = routine.trigger || { type: "cron", expression: routine.schedule };
    const fingerprint = source || routine.source_fingerprint || `${trigger.type}:${minute.toISOString()}`;
    try {
      const due = trigger.type === "event" ? event && (!trigger.event || trigger.event === event) : cronMatch(trigger.expression || routine.schedule, minute, routine.timezone || "Asia/Tehran");
      if (!due) continue;
      const result = appendRun(state, routine, { sourceFingerprint: fingerprint, dryRun: false, now, reason: trigger.type, occurrence: trigger.type === "event" ? null : minute.toISOString() });
      if (!result.duplicate) created.push(result.run);
    } catch (error) {
      // Invalid configuration needs a repair, not an automatic execution retry.
      const key = `${routine.id}:${routine.skill_version}:configuration:${error.message}`;
      if (!state.runs.some((run) => run.idempotency_key === key && run.status === "failed")) {
        state.runs.push({ id: `RR-${crypto.randomUUID()}`, routine_id: routine.id, idempotency_key: key, status: "failed", error: error.message, attempts: 0, source_fingerprint: fingerprint, next_retry_at: null, external_delivery: "disabled", created_at: now.toISOString() });
      }
    }
  }
  save(root, state);
  return { created, scheduler: state.scheduler };
}
export function recoverScheduler(root, { now = new Date() } = {}) { const state = load(root); const previous = state.scheduler || {}; const stale = previous.status === "running" && previous.heartbeat_at && now.getTime() - new Date(previous.heartbeat_at).getTime() > 30000; if (stale) state.scheduler = { ...previous, status: "recovered", recovered_at: now.toISOString(), pid: null }; save(root, state); return state.scheduler; }
export function schedulerStatus(root) { return load(root).scheduler || empty().scheduler; }
export function listRoutineRuns(root) { return load(root).runs; }
