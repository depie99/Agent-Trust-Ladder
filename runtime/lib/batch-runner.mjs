// Manager-side adapter for one finite sequential batch. The checkpoint rules
// live in the bundled portable helper so both surfaces share one state machine.
import fs from "node:fs";
import path from "node:path";
import {
  BATCH_KIND, BATCH_VERSION, batchSummary, claimBatchItem, createBatch, leaseActive,
  markDeadline, nextBatchItem, reconcileBatchAfterRestart, renderBatchSummary,
  requeueBatchItem, resumeBatch, sealBatch, settleBatchItem, stopBatch, validateBatch,
} from "../../skills/atl/scripts/batch-runner.mjs";
import { loadState } from "./state.mjs";
import { taskDeliveryReceipt } from "./delivery.mjs";
import { executeLaunchQueue } from "./launch.mjs";
import { renderDeliveryReceipt } from "../../skills/atl/scripts/developer-delivery.mjs";

const TERMINAL_TASK = new Set(["done", "rejected", "archived"]);
const directory = (root) => path.join(root, ".trust", "manager", "batches");
const checkpointFile = (root, id) => path.join(directory(root), `${id}.json`);

export function readBatch(root, id) {
  try { return JSON.parse(fs.readFileSync(checkpointFile(root, id), "utf8")); } catch { return null; }
}

export function writeBatch(root, batch) {
  const target = checkpointFile(root, batch.id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(batch, null, 2)}\n`);
  fs.renameSync(tmp, target);
  return batch;
}

export function listBatches(root) {
  let names = [];
  try { names = fs.readdirSync(directory(root)).filter((name) => name.endsWith(".json") && !name.includes("-summary")); } catch { return []; }
  return names.map((name) => {
    try { return batchSummary(JSON.parse(fs.readFileSync(path.join(directory(root), name), "utf8"))); }
    catch (error) { return { id: name.replace(/\.json$/, ""), valid: false, invalid_reason: error.message, status: "unreadable" }; }
  }).sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

function readinessFor(state, taskId) {
  const task = state.tasks[taskId];
  if (!task) return { ready: false, reason: "task not found in manager state" };
  if (TERMINAL_TASK.has(task.status)) return { ready: false, reason: `task is already ${task.status}` };
  if (task.recovery?.recovery_owner === "owner" && task.recovery.status !== "resolved") return { ready: false, reason: `owner-only recovery: ${task.recovery.reason || task.blocker?.reason || "inspection required"}` };
  if (task.recovery?.status === "exhausted") return { ready: false, reason: "automatic recovery is exhausted" };
  return { ready: true, reason: null };
}

export function startBatch(root, { id, tasks, limits = {}, project = null, now = Date.now(), holder = `pid-${process.pid}` } = {}) {
  const existing = readBatch(root, id);
  if (existing) {
    const check = validateBatch(existing);
    if (check.ok && ["running", "recovery_required"].includes(existing.status) && leaseActive(existing, now)) {
      throw new Error(`batch "${id}" is already active under ${existing.lease?.holder}; stop or reconcile it first`);
    }
  }
  const batch = createBatch({ id, tasks, limits, project, now });
  batch.lease = { holder, started_at: new Date(now).toISOString(), heartbeat_at: new Date(now).toISOString(), ttl_seconds: 120 };
  const state = loadState(root);
  for (const item of batch.items) {
    const readiness = readinessFor(state, item.task);
    item.readiness = readiness;
    if (!readiness.ready) {
      item.status = "blocked";
      item.reason = readiness.reason;
      item.ended_at = new Date(now).toISOString();
    }
  }
  if (batch.items.some((item) => item.status === "needs_reconciliation")) batch.status = "recovery_required";
  if (batch.items.every((item) => ["succeeded", "failed", "blocked", "exhausted", "interrupted", "needs_reconciliation", "skipped"].includes(item.status))) {
    batch.status = "complete";
    batch.finished_at = new Date(now).toISOString();
  }
  batch.log.push({ at: new Date(now).toISOString(), event: "readiness", task: null, detail: batch.items.map((item) => `${item.task}:${item.readiness.ready ? "ready" : item.reason}`).join("; ") });
  return writeBatch(root, sealBatch(batch));
}

export function reconcileBatch(root, id, { now = Date.now(), reason } = {}) {
  const batch = readBatch(root, id);
  if (!batch) throw new Error(`unknown batch ${id}`);
  const result = reconcileBatchAfterRestart(batch, { now, ...(reason ? { reason } : {}) });
  return writeBatch(root, result.batch);
}

export function resumeStoppedBatch(root, id, { now = Date.now(), holder = `pid-${process.pid}` } = {}) {
  const batch = readBatch(root, id);
  if (!batch) throw new Error(`unknown batch ${id}`);
  return writeBatch(root, resumeBatch(batch, { now, holder }));
}

export function stopBatchRun(root, id, { reason = "stopped by owner", now = Date.now() } = {}) {
  const batch = readBatch(root, id);
  if (!batch) throw new Error(`unknown batch ${id}`);
  return writeBatch(root, stopBatch(batch, { reason, now }));
}

function classify(root, taskId, outcome) {
  const task = loadState(root).tasks?.[taskId];
  const reason = outcome?.reason || task?.waiting_reason || task?.blocker?.reason || null;
  if (task?.status === "done") return { status: "succeeded", reason: outcome?.status === "completed" ? "task reached done" : reason };
  if (task?.recovery?.recovery_owner === "owner" && task.recovery.status !== "resolved") return { status: "blocked", reason: reason || "owner-only recovery" };
  if (task?.recovery?.status === "exhausted") return { status: "exhausted", reason: reason || "automatic recovery is exhausted" };
  if (task?.status === "blocked" || task?.status === "escalated") return { status: "blocked", reason: reason || `task is ${task.status}` };
  return { status: "failed", reason: reason || "no verified result" };
}

export async function runBatch(root, id, { launch = executeLaunchQueue, onProgress = console.log, now = () => Date.now(), holder = `pid-${process.pid}` } = {}) {
  let batch = readBatch(root, id);
  if (!batch) throw new Error(`unknown batch ${id}`);
  let check = validateBatch(batch);
  if (!check.ok) throw new Error(`batch checkpoint is invalid: ${check.reason}`);
  if (batch.status === "recovery_required") throw new Error("batch needs reconciliation before it can run");
  if (batch.status !== "running") throw new Error(`batch is ${batch.status}`);
  const results = [];
  let stopReason = "batch complete";
  try {
    for (;;) {
      const clock = now();
      const remainingMinutes = Math.max(0, (Date.parse(batch.deadline_at) - clock) / 60000);
      if (remainingMinutes <= 0) {
        batch = markDeadline(batch, { now: clock });
        stopReason = "deadline reached; no new work started";
        writeBatch(root, batch);
        break;
      }
      const next = nextBatchItem(batch, { now: clock });
      batch = sealBatch(batch);
      if (!next.item) {
        stopReason = next.detail ? `${next.reason}: ${next.detail}` : next.reason;
        writeBatch(root, batch);
        break;
      }
      const state = loadState(root);
      const task = state.tasks[next.item.task];
      if (!task || TERMINAL_TASK.has(task.status)) {
        batch = settleBatchItem(batch, next.item.task, { status: "skipped", reason: task ? `already ${task.status} outside the batch` : "task removed before dispatch", now: clock });
        writeBatch(root, batch);
        continue;
      }
      const unmet = (next.item.depends_on || []).filter((dependency) => loadState(root).tasks?.[dependency]?.status !== "done");
      if (unmet.length) {
        batch = settleBatchItem(batch, next.item.task, { status: "blocked", reason: `dependency not done: ${unmet.join(", ")}`, now: clock });
        writeBatch(root, batch);
        continue;
      }
      const readiness = readinessFor(state, next.item.task);
      if (!readiness.ready) {
        batch = settleBatchItem(batch, next.item.task, { status: "blocked", reason: readiness.reason, now: clock });
        writeBatch(root, batch);
        continue;
      }
      batch = claimBatchItem(batch, next.item.task, { now: clock, holder });
      writeBatch(root, batch);
      onProgress(`[batch ${batch.id}] running ${next.item.task} (attempt ${batch.items.find((item) => item.task === next.item.task).attempts}/${batch.limits.max_attempts})`);
      let outcome;
      try {
        outcome = await launch(root, { confirm: true, taskIds: [next.item.task], maxMinutes: remainingMinutes, maxSessions: batch.limits.max_sessions, onProgress: (line) => onProgress(`[${next.item.task}] ${line}`) });
      } catch (error) {
        // An interrupted launch may already have produced an external effect.
        // Stop instead of replaying, and require an owner reconciliation.
        batch = settleBatchItem(batch, next.item.task, { status: "needs_reconciliation", reason: `launch interrupted: ${error.message}`, now: now() });
        writeBatch(root, batch);
        results.push({ task: next.item.task, status: "needs_reconciliation", reason: error.message });
        stopReason = `interrupted while running ${next.item.task}: ${error.message}`;
        break;
      }
      const classification = classify(root, next.item.task, outcome);
      let settled = settleBatchItem(batch, next.item.task, { status: classification.status, reason: classification.reason, now: now() });
      const item = settled.items.find((candidate) => candidate.task === next.item.task);
      if (classification.status === "failed" && item.attempts < settled.limits.max_attempts) {
        settled = requeueBatchItem(settled, next.item.task, { reason: `bounded retry after: ${classification.reason}`, now: now() });
      }
      batch = settled;
      writeBatch(root, batch);
      results.push({ task: next.item.task, status: batch.items.find((candidate) => candidate.task === next.item.task).status, reason: classification.reason });
      onProgress(`[batch ${batch.id}] ${next.item.task}: ${batch.items.find((candidate) => candidate.task === next.item.task).status}`);
    }
  } finally {
    if (batch.lease) {
      batch.lease = null;
      if (batch.status === "running") batch.status = "stopped";
      batch.log = [...(batch.log || []), { at: new Date(now()).toISOString(), event: "runner-exit", task: null, detail: stopReason }];
      writeBatch(root, sealBatch(batch));
    }
  }
  return { ...batchSummary(readBatch(root, id)), results, stop_reason: stopReason };
}

export function batchMorningSummary(root, id) {
  let batch = readBatch(root, id);
  if (!batch) throw new Error(`unknown batch ${id}`);
  const check = validateBatch(batch);
  if (!check.ok) throw new Error(`batch checkpoint is invalid: ${check.reason}`);
  const receipts = [];
  for (const item of batch.items) {
    if (item.status !== "succeeded") continue;
    try {
      const adapted = taskDeliveryReceipt(root, item.task);
      const target = path.join(directory(root), id, "receipts", item.task);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(`${target}.json`, `${JSON.stringify(adapted.receipt, null, 2)}\n`);
      fs.writeFileSync(`${target}.md`, renderDeliveryReceipt(adapted.receipt, adapted.verdict));
      item.receipt = {
        verdict: adapted.verdict,
        content_revision: adapted.receipt.content.revision,
        path: path.relative(root, `${target}.json`),
        markdown_path: path.relative(root, `${target}.md`),
      };
      receipts.push({ task: item.task, ...item.receipt });
    } catch (error) {
      item.receipt = { verdict: { status: "unavailable", reason: error.message }, content_revision: null, path: null, markdown_path: null };
      receipts.push({ task: item.task, ...item.receipt });
    }
  }
  batch = sealBatch(batch);
  const markdown = renderBatchSummary(batch);
  const summaryFile = path.join(directory(root), `${id}-summary.json`);
  const markdownFile = path.join(directory(root), `${id}-summary.md`);
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
  const summary = { ...batchSummary(batch), receipts, generated_at: new Date().toISOString() };
  fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(markdownFile, markdown);
  writeBatch(root, batch);
  return { summary, markdown, files: { json: summaryFile, markdown: markdownFile } };
}

export { BATCH_KIND, BATCH_VERSION };
