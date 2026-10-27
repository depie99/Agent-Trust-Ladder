import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { snapshot, readHandoff } from "./handoffs.mjs";
import { ChangeReviewError, changeSetId, compareSnapshots, safePath, validateSnapshot } from "./task-changes.mjs";

const handoffCache = new Map();

function taskDirectory(root, task) {
  if (!/^T-[A-Za-z0-9-]+$/.test(task.id)) throw new ChangeReviewError("invalid_task", "Invalid task identifier");
  return safePath(root, `.trust/manager/change-reviews/${task.id}`);
}
function validate(record, task) {
  validateSnapshot(record?.baseline); validateSnapshot(record?.output);
  if (record.version !== 1 || record.task_id !== task.id || !Number.isInteger(record.packet_revision) || record.id !== changeSetId(task.id, record.packet_revision, record.baseline, record.output)) throw new ChangeReviewError("corrupt_manifest", "Inspection record is corrupt", 409);
  compareSnapshots(record.baseline, record.output);
  return record;
}
function fromHandoff(root, task) {
  const file = safePath(root, `.trust/manager/handoffs/${task.id}.json`);
  safePath(root, ".trust/manager/handoffs/blobs/inspection-check");
  const stat = fs.statSync(file);
  if (stat.size > 16 * 1024 * 1024) throw new ChangeReviewError("manifest_limit", "Handoff manifest exceeds the inspection limit", 413);
  const key = JSON.stringify([root, task.id, task.packet_revision, task.handoff?.record_hash, stat.mtimeMs, stat.ctimeMs, stat.size]);
  if (handoffCache.has(key)) return handoffCache.get(key);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  validateSnapshot(raw.baseline); validateSnapshot(raw.output);
  for (const hash of Object.values(raw.output.files)) safePath(root, `.trust/manager/handoffs/blobs/${hash}`);
  const handoff = readHandoff(root, task);
  const record = { version: 1, id: changeSetId(task.id, handoff.packet_revision, handoff.baseline, handoff.output), task_id: task.id, packet_revision: handoff.packet_revision, baseline: handoff.baseline, output: handoff.output, input_revisions: handoff.input_revisions, captured_at: handoff.created_at, captured_status: task.status, source_kind: "handoff", run_id: null };
  if (handoffCache.size >= 128) handoffCache.delete(handoffCache.keys().next().value);
  handoffCache.set(key, record);
  return record;
}
export function readChangeReview(root, task, id = null) {
  const directory = taskDirectory(root, task);
  if (id && !/^[a-f0-9]{64}$/.test(id)) throw new ChangeReviewError("invalid_change_set", "Invalid change set identifier");
  if (id) {
    const file = safePath(directory, `${id}.json`);
    if (fs.existsSync(file)) {
      try { const record = validate(JSON.parse(fs.readFileSync(file, "utf8")), task); if (record.id !== id) throw new ChangeReviewError("corrupt_manifest", "Inspection identifier does not match its file", 409); return record; }
      catch (error) { if (error instanceof ChangeReviewError) throw error; throw new ChangeReviewError("corrupt_manifest", "Inspection record cannot be read", 409); }
    }
    if (task.handoff) { const record = fromHandoff(root, task); if (record.id === id) return validate(record, task); }
    throw new ChangeReviewError("change_set_missing", "Captured revision is unavailable for this task", 404);
  }
  const records = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => {
    const file = safePath(directory, name);
    try { return validate(JSON.parse(fs.readFileSync(file, "utf8")), task); }
    catch (error) { if (error instanceof ChangeReviewError) throw error; throw new ChangeReviewError("corrupt_manifest", "Inspection record cannot be read", 409); }
  }) : [];
  if (task.handoff) {
    try { records.push(validate(fromHandoff(root, task), task)); }
    catch (error) { throw new ChangeReviewError("handoff_unavailable", "Completed handoff is unavailable or failed validation. Select an earlier inspection explicitly if available.", 409); }
  }
  return records.sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0] || null;
}
export function listChangeReviews(root, task) {
  const directory = taskDirectory(root, task);
  const ids = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => name.slice(0, -5)) : [];
  const records = ids.map((id) => readChangeReview(root, task, id));
  if (task.handoff) { try { records.push(fromHandoff(root, task)); } catch { /* reported by main read when no inspection exists */ } }
  return [...new Map(records.map((record) => [record.id, record])).values()].sort((a, b) => b.captured_at.localeCompare(a.captured_at)).map(({ id, captured_at, source_kind, packet_revision, output }) => ({ id, captured_at, source_kind, packet_revision, output_revision: output.revision }));
}
export function captureChangeReview(root, task, { takeSnapshot = snapshot } = {}) {
  if (!task.handoff_baseline) throw new ChangeReviewError("baseline_missing", "No captured task baseline exists. The task diff cannot be reconstructed.", 409);
  if (!task.workspace || !fs.existsSync(task.workspace)) throw new ChangeReviewError("workspace_missing", "Task workspace is unavailable", 409);
  // Validate ownership and ancestry before walking or writing any source blobs.
  const directory = taskDirectory(root, task);
  safePath(task.workspace, ".atl-inspection-check");
  safePath(root, ".trust/manager/handoffs/blobs/inspection-check");
  compareSnapshots(task.handoff_baseline, task.handoff_baseline);
  const first = takeSnapshot(root, task.workspace), second = takeSnapshot(root, task.workspace);
  if (first.revision !== second.revision) throw new ChangeReviewError("source_changed", "Source changed during capture. Retry when the worker is idle.", 409);
  const packet = task.packet_revision || 1, id = changeSetId(task.id, packet, task.handoff_baseline, first);
  const existing = safePath(directory, `${id}.json`);
  if (fs.existsSync(existing)) return readChangeReview(root, task, id);
  const record = { version: 1, id, task_id: task.id, packet_revision: packet, baseline: task.handoff_baseline, output: first, input_revisions: task.input_revisions || {}, captured_at: new Date().toISOString(), captured_status: task.status, source_kind: "inspection", run_id: null };
  validate(record, task);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = safePath(directory, `${id}-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    // Publish without replacing a concurrently published capture of the same ID.
    try { fs.linkSync(temporary, existing); }
    catch (error) { if (error.code === "EEXIST") return readChangeReview(root, task, id); throw error; }
  }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return record;
}
export function unavailableReview(task) {
  return { version: 1, capability: "task-change-review-v1", task_id: task.id, status: task.status, availability: task.handoff_baseline ? "capture_required" : "baseline_missing", message: task.handoff_baseline ? "Capture the task workspace to inspect its current changes." : "No captured task baseline exists. The task diff cannot be reconstructed.", files: [], total_files: null, evidence: [], attention: [], revisions: [], decisions_availability: "unavailable" };
}
