#!/usr/bin/env node
// Shared sequential batch state machine. Runtime and skills-only hosts use the
// same rules: a fixed item list, concurrency 1, durable attempt accounting and
// conservative recovery for in-flight work after a restart.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BATCH_VERSION = 1;
export const BATCH_KIND = "atl-overnight-batch";
export const ITEM_STATUSES = Object.freeze([
  "pending", "running", "succeeded", "failed", "blocked", "exhausted",
  "interrupted", "needs_reconciliation", "skipped",
]);
export const TERMINAL_ITEM_STATUSES = Object.freeze([
  "succeeded", "failed", "blocked", "exhausted", "interrupted", "needs_reconciliation", "skipped",
]);

const TERMINAL = new Set(TERMINAL_ITEM_STATUSES);
const ALLOWED = new Set(ITEM_STATUSES);

function iso(value) { return new Date(value).toISOString(); }
function hashOf(body) { return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"); }
function bodyOf(batch) { const { hash, ...body } = batch; return body; }
function cleanLimit(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(max, Math.floor(number));
}

export function sealBatch(batch) {
  const next = { ...batch, updated_at: batch.updated_at || new Date().toISOString() };
  return { ...next, hash: hashOf(bodyOf(next)) };
}

export function createBatch({ id, project = null, tasks, limits = {}, now = Date.now() } = {}) {
  const name = String(id || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) throw new Error("batch id must be 1-64 safe characters");
  const list = (Array.isArray(tasks) ? tasks : []).map((entry) => typeof entry === "string" ? { task: entry } : entry)
    .map((entry) => ({ task: String(entry.task || "").trim(), depends_on: Array.isArray(entry.depends_on) ? entry.depends_on.map(String) : [] }))
    .filter((entry) => entry.task);
  if (!list.length) throw new Error("a batch needs at least one task");
  if (new Set(list.map((entry) => entry.task)).size !== list.length) throw new Error("a batch cannot repeat a task id");
  const maxMinutes = cleanLimit(limits.max_minutes ?? limits.maxMinutes, 60, 24 * 60);
  const maxAttempts = cleanLimit(limits.max_attempts ?? limits.maxAttempts, 2, 3);
  const maxSessions = limits.max_sessions ?? limits.maxSessions ?? null;
  const startedAt = iso(now);
  return sealBatch({
    version: BATCH_VERSION,
    kind: BATCH_KIND,
    id: name,
    project,
    created_at: startedAt,
    updated_at: startedAt,
    status: "running",
    concurrency: 1,
    limits: {
      max_minutes: maxMinutes,
      max_attempts: maxAttempts,
      max_sessions: maxSessions == null || maxSessions === "" ? null : Number.isFinite(Number(maxSessions)) ? Number(maxSessions) : null,
    },
    deadline_at: iso(now + maxMinutes * 60 * 1000),
    lease: null,
    items: list.map((entry) => ({
      task: entry.task,
      depends_on: entry.depends_on,
      status: "pending",
      attempts: 0,
      started_at: null,
      ended_at: null,
      reason: null,
      receipt: null,
      evidence: [],
    })),
    log: [{ at: startedAt, event: "created", task: null, detail: `${list.length} task(s)` }],
  });
}

export function validateBatch(batch) {
  const fail = (reason) => ({ ok: false, reason });
  if (!batch || typeof batch !== "object") return fail("checkpoint missing");
  if (batch.kind !== BATCH_KIND || batch.version !== BATCH_VERSION) return fail(`unsupported batch schema: ${batch.kind || "unknown"} v${batch.version ?? "unknown"}`);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(String(batch.id || ""))) return fail("invalid batch id");
  if (batch.concurrency !== 1) return fail("only concurrency 1 is supported");
  if (!Array.isArray(batch.items) || !batch.items.length) return fail("batch items missing");
  const seen = new Set();
  for (const item of batch.items) {
    if (!item || typeof item.task !== "string" || !item.task) return fail("item without a task id");
    if (seen.has(item.task)) return fail(`duplicate task ${item.task}`);
    seen.add(item.task);
    if (!ALLOWED.has(item.status)) return fail(`unknown item status: ${item.status}`);
    if (!Number.isInteger(item.attempts) || item.attempts < 0) return fail(`invalid attempts for ${item.task}`);
  }
  const limits = batch.limits || {};
  if (!(limits.max_minutes > 0) || limits.max_minutes > 24 * 60) return fail("invalid time limit");
  if (!(limits.max_attempts >= 0) || limits.max_attempts > 3) return fail("invalid attempt limit");
  if (!batch.deadline_at || Number.isNaN(Date.parse(batch.deadline_at))) return fail("invalid deadline");
  if (batch.hash !== hashOf(bodyOf(batch))) return fail("checkpoint hash does not match its content");
  return { ok: true, reason: null };
}

function touch(batch, event, task = null, detail = "") {
  batch.updated_at = new Date().toISOString();
  batch.log = [...(batch.log || []), { at: batch.updated_at, event, task, detail }];
}

export function leaseActive(batch, now = Date.now()) {
  const lease = batch?.lease;
  if (!lease) return false;
  const heartbeat = Date.parse(lease.heartbeat_at || lease.started_at || 0);
  const ttl = Number(lease.ttl_seconds || 120) * 1000;
  return Number.isFinite(heartbeat) && now - heartbeat < ttl;
}

export function renewLease(batch, { holder, now = Date.now(), ttlSeconds = 120 } = {}) {
  batch.lease = { holder: holder || batch.lease?.holder || `pid-${process.pid}`, started_at: batch.lease?.started_at || iso(now), heartbeat_at: iso(now), ttl_seconds: ttlSeconds };
  return batch;
}

function normalizeItems(batch) {
  for (const item of batch.items) {
    if (item.status === "pending" && item.attempts >= batch.limits.max_attempts) {
      item.status = "exhausted";
      item.ended_at ||= batch.updated_at;
      item.reason ||= "attempt limit reached";
    }
  }
  return batch;
}

export function nextBatchItem(batch, { now = Date.now() } = {}) {
  const check = validateBatch(batch);
  if (!check.ok) return { item: null, reason: "invalid_checkpoint", detail: check.reason };
  if (batch.status !== "running") return { item: null, reason: `batch_${batch.status}` };
  normalizeItems(batch);
  if (now >= Date.parse(batch.deadline_at)) return { item: null, reason: "deadline" };
  const reconciling = batch.items.find((item) => item.status === "needs_reconciliation");
  if (reconciling) return { item: null, reason: "reconciliation_required", detail: reconciling.task };
  const inFlight = batch.items.find((item) => item.status === "running");
  if (inFlight) return { item: null, reason: "in_flight", detail: inFlight.task };
  const item = batch.items.find((candidate) => candidate.status === "pending");
  if (!item) {
    const complete = batch.items.every((candidate) => TERMINAL.has(candidate.status));
    return { item: null, reason: complete ? "complete" : "waiting" };
  }
  return { item, reason: null };
}

export function claimBatchItem(batch, task, { now = Date.now(), holder } = {}) {
  const check = validateBatch(batch);
  if (!check.ok) throw new Error(`invalid checkpoint: ${check.reason}`);
  if (batch.status !== "running") throw new Error(`batch is ${batch.status}`);
  if (now >= Date.parse(batch.deadline_at)) throw new Error("batch deadline passed");
  const item = batch.items.find((candidate) => candidate.task === task);
  if (!item) throw new Error(`unknown batch task ${task}`);
  if (item.status !== "pending") throw new Error(`${task} is ${item.status}, not pending`);
  if (item.attempts >= batch.limits.max_attempts) { normalizeItems(batch); throw new Error(`${task} reached its attempt limit`); }
  item.status = "running";
  item.attempts += 1;
  item.started_at = iso(now);
  item.reason = null;
  touch(batch, "claimed", task, `attempt ${item.attempts}`);
  renewLease(batch, { holder, now });
  return sealBatch(batch);
}

export function settleBatchItem(batch, task, { status, reason = null, evidence = [], receipt = null, now = Date.now() } = {}) {
  const check = validateBatch(batch);
  if (!check.ok) throw new Error(`invalid checkpoint: ${check.reason}`);
  if (!TERMINAL.has(status)) throw new Error(`settle needs a terminal status, received ${status}`);
  const item = batch.items.find((candidate) => candidate.task === task);
  if (!item) throw new Error(`unknown batch task ${task}`);
  if (!["running", "needs_reconciliation"].includes(item.status)) throw new Error(`${task} is ${item.status}; only an in-flight item can settle`);
  item.status = status;
  item.reason = reason;
  item.ended_at = iso(now);
  if (Array.isArray(evidence)) item.evidence = evidence;
  if (receipt) item.receipt = receipt;
  touch(batch, `settled:${status}`, task, reason || "");
  renewLease(batch, { now });
  batch.status = batch.items.some((candidate) => candidate.status === "needs_reconciliation")
    ? "recovery_required"
    : batch.items.every((candidate) => TERMINAL.has(candidate.status)) ? "complete" : "running";
  if (batch.status === "complete") batch.finished_at = iso(now);
  return sealBatch(batch);
}

export function requeueBatchItem(batch, task, { reason = "bounded retry", now = Date.now() } = {}) {
  const check = validateBatch(batch);
  if (!check.ok) throw new Error(`invalid checkpoint: ${check.reason}`);
  const item = batch.items.find((candidate) => candidate.task === task);
  if (!item) throw new Error(`unknown batch task ${task}`);
  if (item.status !== "failed") throw new Error(`only a failed item can be requeued; ${task} is ${item.status}`);
  if (item.attempts >= batch.limits.max_attempts) {
    item.status = "exhausted";
    item.reason = `${reason}; attempt limit reached`;
  } else {
    item.status = "pending";
    item.reason = reason;
    if (batch.status === "complete") { batch.status = "running"; delete batch.finished_at; }
  }
  item.ended_at = iso(now);
  touch(batch, item.status === "pending" ? "requeued" : "exhausted", task, reason);
  return sealBatch(batch);
}

export function reconcileBatchAfterRestart(batch, { reason = "restart while an item was in flight; external effect unknown", now = Date.now() } = {}) {
  const check = validateBatch(batch);
  if (!check.ok) throw new Error(`invalid checkpoint: ${check.reason}`);
  let changed = 0;
  for (const item of batch.items) {
    if (item.status !== "running") continue;
    item.status = "needs_reconciliation";
    item.reason = reason;
    item.ended_at = iso(now);
    changed += 1;
  }
  if (changed) {
    batch.status = "recovery_required";
    batch.lease = null;
    touch(batch, "reconciled", null, `${changed} in-flight item(s) need owner inspection`);
  }
  return { batch: sealBatch(batch), changed };
}

export function resumeBatch(batch, { holder, now = Date.now() } = {}) {
  const check = validateBatch(batch);
  if (!check.ok) throw new Error(`invalid checkpoint: ${check.reason}`);
  if (batch.items.some((item) => item.status === "needs_reconciliation")) throw new Error("reconcile in-flight items before resuming");
  if (batch.items.some((item) => item.status === "running")) throw new Error("a batch item is still marked in flight");
  if (batch.items.every((item) => TERMINAL.has(item.status))) throw new Error("batch is complete; nothing to resume");
  if (now >= Date.parse(batch.deadline_at)) throw new Error("batch deadline passed");
  batch.status = "running";
  renewLease(batch, { holder, now });
  touch(batch, "resumed", null, `holder ${batch.lease.holder}`);
  return sealBatch(batch);
}

export function stopBatch(batch, { reason = "stopped by owner", now = Date.now() } = {}) {
  const check = validateBatch(batch);
  if (!check.ok) throw new Error(`invalid checkpoint: ${check.reason}`);
  for (const item of batch.items) {
    if (item.status === "running") { item.status = "needs_reconciliation"; item.reason = `${reason}; in-flight effect unknown`; item.ended_at = iso(now); }
  }
  batch.status = batch.items.some((item) => item.status === "needs_reconciliation") ? "recovery_required" : "stopped";
  batch.lease = null;
  touch(batch, "stopped", null, reason);
  return sealBatch(batch);
}

export function markDeadline(batch, { now = Date.now(), reason = "deadline reached; no new work started" } = {}) {
  const check = validateBatch(batch);
  if (!check.ok) throw new Error(`invalid checkpoint: ${check.reason}`);
  for (const item of batch.items) {
    if (item.status === "pending") { item.status = "skipped"; item.reason = reason; item.ended_at = iso(now); }
  }
  batch.status = batch.items.some((item) => item.status === "needs_reconciliation") ? "recovery_required"
    : batch.items.some((item) => item.status === "running") ? "recovery_required"
      : batch.items.every((item) => TERMINAL.has(item.status)) ? "complete" : batch.status;
  batch.lease = null;
  touch(batch, "deadline", null, reason);
  return sealBatch(batch);
}

export function batchSummary(batch) {
  const check = validateBatch(batch);
  const counts = Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0]));
  for (const item of batch?.items || []) if (ALLOWED.has(item.status)) counts[item.status] += 1;
  const remaining = (batch?.items || []).filter((item) => !TERMINAL.has(item.status));
  const recovery = (batch?.items || []).filter((item) => item.status === "needs_reconciliation" || item.status === "running");
  const unresolved = (batch?.items || []).filter((item) => !["succeeded", "skipped"].includes(item.status));
  return {
    version: batch?.version || null,
    id: batch?.id || null,
    project: batch?.project || null,
    valid: check.ok,
    invalid_reason: check.reason,
    status: batch?.status || "unknown",
    concurrency: batch?.concurrency || null,
    limits: batch?.limits || null,
    created_at: batch?.created_at || null,
    deadline_at: batch?.deadline_at || null,
    finished_at: batch?.finished_at || null,
    progress: { total: batch?.items?.length || 0, ...counts, attempts: (batch?.items || []).reduce((sum, item) => sum + (item.attempts || 0), 0) },
    items: (batch?.items || []).map((item) => ({
      task: item.task, status: item.status, attempts: item.attempts, reason: item.reason,
      receipt: item.receipt || null, started_at: item.started_at, ended_at: item.ended_at,
    })),
    receipts: (batch?.items || []).filter((item) => item.receipt).map((item) => ({ task: item.task, ...item.receipt })),
    recovery_required: recovery.length > 0,
    recovery: recovery.map((item) => ({ task: item.task, status: item.status, reason: item.reason })),
    stop_reason: batch?.status && batch.status !== "running" && batch.status !== "complete"
      ? (batch.items.find((item) => item.reason && item.status !== "succeeded")?.reason || batch.status)
      : null,
    remaining: remaining.map((item) => ({ task: item.task, status: item.status, reason: item.reason })),
    human_decision: unresolved.length ? { task: unresolved[0].task, reason: unresolved[0].reason || unresolved[0].status } : null,
    successful: Boolean(batch) && check.ok && (batch.items || []).length > 0 && (batch.items || []).every((item) => item.status === "succeeded"),
    complete: Boolean(batch) && check.ok && batch.status === "complete",
  };
}

export function renderBatchSummary(batch, { testedHost = "the invoking host" } = {}) {
  const summary = batchSummary(batch);
  const rows = summary.items.map((item) => `| ${item.task} | ${item.status} | ${item.attempts} | ${item.reason || "none"} | ${item.receipt?.verdict?.status || "none"} |`).join("\n");
  const receipts = summary.receipts.length
    ? summary.receipts.map((receipt) => `- ${receipt.task}: ${receipt.verdict?.status || "unknown"} · ${receipt.path || "receipt path not recorded"}`).join("\n")
    : "- none";
  return `# Overnight batch ${summary.id || "unknown"}

Status: **${summary.status}**${summary.valid ? "" : ` (invalid: ${summary.invalid_reason})`}
Tasks: ${summary.progress.total} · succeeded ${summary.progress.succeeded} · failed ${summary.progress.failed} · blocked ${summary.progress.blocked} · exhausted ${summary.progress.exhausted} · skipped ${summary.progress.skipped}
Concurrency: ${summary.concurrency}
Limits: ${summary.limits?.max_minutes ?? "unknown"} minutes · ${summary.limits?.max_attempts ?? "unknown"} attempts/task · ${summary.limits?.max_sessions == null ? "session cap not set" : `${summary.limits.max_sessions} sessions`}
Deadline: ${summary.deadline_at || "unknown"}
Stop reason: ${summary.stop_reason || "none"}
Recovery required: ${summary.recovery_required ? summary.recovery.map((item) => `${item.task} (${item.reason})`).join(", ") : "no"}

| Task | Status | Attempts | Reason | Receipt |
|---|---|---|---|---|
${rows || "| none | - | - | - | - |"}

## Receipts

${receipts}

## Next human decision

${summary.human_decision ? `${summary.human_decision.task}: ${summary.human_decision.reason}` : "none"}

## Boundary

Work runs on ${testedHost}, which must stay available for the duration. This record does not claim a scheduler, durable compute, OS isolation, enforced token caps or remote writeback that the host did not provide.
`;
}

function readJson(file) { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
function writeJson(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}
function arg(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function main(args) {
  const command = args[0];
  const file = args[1];
  try {
    if (command === "validate") {
      const check = validateBatch(readJson(file));
      process.stdout.write(`${JSON.stringify(check, null, 2)}\n`);
      return check.ok ? 0 : 2;
    }
    if (command === "summary") {
      const batch = readJson(file);
      process.stdout.write(renderBatchSummary(batch));
      return batchSummary(batch).complete ? 0 : 2;
    }
    if (command === "create") {
      const tasks = String(arg(args, "--tasks", "")).split(",").map((value) => value.trim()).filter(Boolean);
      const batch = createBatch({
        id: arg(args, "--id", path.basename(file, ".json")),
        tasks,
        limits: { max_minutes: arg(args, "--minutes", 60), max_attempts: arg(args, "--attempts", 2), max_sessions: arg(args, "--sessions", null) },
      });
      writeJson(file, batch);
      process.stdout.write(`${batch.id}: ${batch.items.length} task(s), deadline ${batch.deadline_at}\n`);
      return 0;
    }
    if (command === "next") {
      const batch = readJson(file); const next = nextBatchItem(batch, { now: Date.parse(arg(args, "--now", new Date().toISOString())) });
      writeJson(file, sealBatch(batch));
      process.stdout.write(`${JSON.stringify({ task: next.item?.task || null, reason: next.reason, detail: next.detail || null }, null, 2)}\n`);
      return next.item ? 0 : 2;
    }
    if (command === "claim" || command === "settle" || command === "requeue") {
      const batch = readJson(file); const task = args[2];
      const now = Date.parse(arg(args, "--now", new Date().toISOString()));
      const next = command === "claim" ? claimBatchItem(batch, task, { now, holder: arg(args, "--holder", `pid-${process.pid}`) })
        : command === "settle" ? settleBatchItem(batch, task, { status: args[3], reason: arg(args, "--reason", null), now })
          : requeueBatchItem(batch, task, { reason: arg(args, "--reason", "bounded retry"), now });
      writeJson(file, next);
      process.stdout.write(`${task}: ${next.items.find((item) => item.task === task).status}\n`);
      return 0;
    }
    if (command === "reconcile") {
      const batch = readJson(file); const result = reconcileBatchAfterRestart(batch, { now: Date.parse(arg(args, "--now", new Date().toISOString())) });
      writeJson(file, result.batch);
      process.stdout.write(`reconciled ${result.changed} in-flight item(s)\n`);
      return 0;
    }
    if (command === "stop") {
      const batch = readJson(file); const next = stopBatch(batch, { reason: arg(args, "--reason", "stopped by owner"), now: Date.parse(arg(args, "--now", new Date().toISOString())) });
      writeJson(file, next);
      process.stdout.write(`${next.id}: ${next.status}\n`);
      return 0;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  process.stderr.write("Usage: batch-runner.mjs create <file> --id <id> --tasks A,B --minutes N --attempts N [--sessions N] | next <file> | claim <file> <task> | settle <file> <task> <status> [--reason text] | requeue <file> <task> | reconcile <file> | stop <file> | summary <file> | validate <file>\n");
  return 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
