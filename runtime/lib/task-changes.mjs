// Read-only, revision-pinned inspection. Content hashes are not Git commits.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const LIMITS = Object.freeze({ page: 100, text: 1024 * 1024, patch: 256 * 1024, cells: 2_000_000, milliseconds: 5000 });
export class ChangeReviewError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function safePath(base, relative) {
  if (typeof relative !== "string" || !relative || /[\\\x00-\x1f]/.test(relative) || path.posix.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) throw new ChangeReviewError("unsafe_path", "Unsafe record path");
  const resolved = path.resolve(base, ...relative.split("/"));
  // Check the entire ancestor chain, including the store itself (Windows junctions too).
  for (let cursor = resolved; ; cursor = path.dirname(cursor)) {
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new ChangeReviewError("unsafe_path", "Symlinked inspection path is unavailable");
    if (path.dirname(cursor) === cursor) break;
  }
  return resolved;
}
export function validateSnapshot(snapshot) {
  if (!snapshot || !snapshot.files || !snapshot.modes || Object.keys(snapshot.files).length > 100000 || digest(JSON.stringify({ files: snapshot.files, modes: snapshot.modes })) !== snapshot.revision) throw new ChangeReviewError("corrupt_manifest", "Snapshot manifest is corrupt", 409);
  for (const [name, hash] of Object.entries(snapshot.files)) {
    safePath(".", name);
    if (!/^[a-f0-9]{64}$/.test(hash) || !["100644", "100755"].includes(snapshot.modes[name])) throw new ChangeReviewError("corrupt_manifest", "Invalid snapshot entry", 409);
  }
  return snapshot;
}
export function changeSetId(taskId, packet, baseline, output) {
  return digest(JSON.stringify([taskId, packet, baseline.revision, output.revision]));
}
export function compareSnapshots(baseline, output) {
  validateSnapshot(baseline); validateSnapshot(output);
  return [...new Set([...Object.keys(baseline.files), ...Object.keys(output.files)])].sort().flatMap((name) => {
    const before = baseline.files[name] || null, after = output.files[name] || null;
    const beforeMode = baseline.modes[name] || null, afterMode = output.modes[name] || null;
    if (before === after && beforeMode === afterMode) return [];
    return [{ id: digest(name), path: name, kind: !before ? "added" : !after ? "deleted" : before !== after ? "modified" : "mode_changed", before, after, before_mode: beforeMode, after_mode: afterMode, additions: null, deletions: null }];
  });
}
export function readBlob(root, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new ChangeReviewError("corrupt_blob", "Invalid blob identifier", 409);
  const file = safePath(root, `.trust/manager/handoffs/blobs/${hash}`);
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new ChangeReviewError("blob_missing", "Captured source blob is unavailable", 409);
  if (stat.size > LIMITS.text) throw new ChangeReviewError("oversized", "Source exceeds the 1 MiB preview limit", 413);
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== hash) throw new ChangeReviewError("corrupt_blob", "Captured source blob failed its hash check", 409);
  return bytes;
}
const sensitivePath = (name) => /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)|owner-session\.json)$|\.(?:pem|key|p12|pfx)$/i.test(name);
const sensitiveText = (text) => /-----BEGIN [\w ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*["']?\s*[:=]\s*["']?[^\s"',;}{]{8,}|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})/.test(text);

// Bounded line LCS, after removing common prefix/suffix. Large unrelated edits
// return an explicit limit state rather than freezing the control plane.
export function unifiedDiff(before, after, name) {
  const started = performance.now();
  const lines = (text) => text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const a = lines(before), b = lines(after);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const x = a.slice(prefix, a.length - suffix), y = b.slice(prefix, b.length - suffix);
  if ((x.length + 1) * (y.length + 1) > LIMITS.cells) return { availability: "diff_limit", truncated: true, patch: "", additions: null, deletions: null };
  const width = y.length + 1, table = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--) {
    if (performance.now() - started > LIMITS.milliseconds) return { availability: "timeout", truncated: true, patch: "", additions: null, deletions: null };
    for (let j = y.length - 1; j >= 0; j--) table[i * width + j] = x[i] === y[j] ? 1 + table[(i + 1) * width + j + 1] : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const ops = a.slice(0, prefix).map((text) => [" ", text]);
  let i = 0, j = 0, additions = 0, deletions = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { ops.push([" ", x[i++]]); j++; }
    else if (j < y.length && (i === x.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) { ops.push(["+", y[j++]]); additions++; }
    else { ops.push(["-", x[i++]]); deletions++; }
  }
  for (const text of a.slice(a.length - suffix)) ops.push([" ", text]);
  // Final-newline-only differences must remain visible.
  if (!additions && !deletions && before !== after) return { availability: "available", truncated: false, patch: `--- a/${name}\n+++ b/${name}\nFinal newline changed: ${before.endsWith("\n") ? "present" : "absent"} -> ${after.endsWith("\n") ? "present" : "absent"}`, additions: 0, deletions: 0 };
  const ranges = [];
  ops.forEach(([sign], index) => {
    if (sign === " ") return;
    const start = Math.max(0, index - 3), end = Math.min(ops.length, index + 4), last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = end; else ranges.push([start, end]);
  });
  const oldAt = [1], newAt = [1];
  ops.forEach(([sign], index) => { oldAt.push(oldAt[index] + (sign !== "+" ? 1 : 0)); newAt.push(newAt[index] + (sign !== "-" ? 1 : 0)); });
  const chunks = [`--- a/${name}`, `+++ b/${name}`];
  for (const [start, end] of ranges) {
    const oldCount = oldAt[end] - oldAt[start], newCount = newAt[end] - newAt[start];
    chunks.push(`@@ -${oldCount ? oldAt[start] : oldAt[start] - 1},${oldCount} +${newCount ? newAt[start] : newAt[start] - 1},${newCount} @@`);
    for (let k = start; k < end; k++) {
      const [sign, text] = ops[k]; chunks.push(sign + text);
      if ((sign !== "+" && oldAt[k + 1] === a.length + 1 && !before.endsWith("\n")) || (sign !== "-" && newAt[k + 1] === b.length + 1 && !after.endsWith("\n"))) chunks.push("\\ No newline at end of file");
    }
  }
  const patch = chunks.join("\n") + "\n";
  if (Buffer.byteLength(patch) > LIMITS.patch) return { availability: "patch_limit", truncated: true, patch: "", additions, deletions };
  return { availability: "available", truncated: false, patch, additions, deletions };
}
export function fileDiff(root, record, fileId) {
  const file = compareSnapshots(record.baseline, record.output).find((entry) => entry.id === fileId);
  if (!file) throw new ChangeReviewError("file_not_found", "File does not belong to this change set", 404);
  if (sensitivePath(file.path)) return { file, availability: "redacted", patch: "", truncated: false, complete: false };
  try {
    const before = file.before ? readBlob(root, file.before) : Buffer.alloc(0), after = file.after ? readBlob(root, file.after) : Buffer.alloc(0);
    const decode = new TextDecoder("utf-8", { fatal: true });
    if (before.includes(0) || after.includes(0)) return { file, availability: "binary", patch: "", complete: false };
    let a, b;
    try { a = decode.decode(before); b = decode.decode(after); } catch { return { file, availability: "binary", patch: "", complete: false }; }
    if (sensitiveText(a) || sensitiveText(b)) return { file, availability: "redacted", patch: "", complete: false };
    const diff = unifiedDiff(a, b, file.path);
    return { file, ...diff, complete: diff.availability === "available", mode_change: file.before_mode !== file.after_mode };
  } catch (error) {
    if (!(error instanceof ChangeReviewError)) throw error;
    return { file, availability: error.code, message: error.message, patch: "", complete: false };
  }
}
export function evidenceFor(task, record) {
  return (task.evidence || []).map((entry, index) => ({ ...entry, id: `evidence-${digest(JSON.stringify([task.id, index, entry])).slice(0, 20)}`, freshness: entry.invalidated ? "invalidated" : !entry.code_revision || entry.packet_revision == null ? "unknown" : entry.code_revision !== record.output.revision || entry.packet_revision !== record.packet_revision ? "stale" : "current" }));
}
export function describeChanges(task, record, { cursor = 0, limit = LIMITS.page } = {}) {
  const files = compareSnapshots(record.baseline, record.output), evidence = evidenceFor(task, record), attention = [];
  const artifacts = evidence.filter((entry) => entry.artifact_hash).map((entry) => ({ id: `artifact-${digest(String(entry.artifact_hash)).slice(0, 20)}`, hash: entry.artifact_hash, evidence_id: entry.id, code_revision: entry.code_revision || null, packet_revision: entry.packet_revision ?? null, availability: "reference_only" }));
  const add = (code, reason) => attention.push({ id: code, code, reason });
  if (["blocked", "escalated"].includes(task.status)) add("blocked", task.blocker?.reason || `Task is ${task.status}`);
  if (evidence.some((entry) => entry.freshness !== "current")) add("stale_evidence", "Some evidence is stale, invalidated or has no exact revision link");
  const current = evidence.filter((entry) => entry.freshness === "current");
  for (const check of task.completion_checks || []) if (!current.some((entry) => entry.kind === "check" && entry.check === check && entry.result === "pass" && entry.coverage === "complete")) add(`check-${digest(check).slice(0, 12)}`, `Missing complete verification: ${check}`);
  if (current.some((entry) => entry.result === "fail" || entry.coverage === "partial")) add("failed_evidence", "Current evidence includes failed or incomplete observations");
  if (!current.some((entry) => entry.kind === "review" && entry.result === "approve")) add("review_missing", "No approval review for this exact revision");
  const offset = Math.max(0, Number.isSafeInteger(Number(cursor)) ? Number(cursor) : 0), size = Math.max(1, Math.min(LIMITS.page, Math.floor(Number(limit)) || LIMITS.page));
  return { version: 1, capability: "task-change-review-v1", availability: "available", id: record.id, task_id: task.id, title: task.title || "", objective: task.objective || "", summary: task.last_checkpoint?.note || task.evidence?.at(-1)?.detail || null, status: task.status, captured_status: record.captured_status || null, packet_revision: record.packet_revision, captured_at: record.captured_at, source_kind: record.source_kind, run_id: record.run_id || null, baseline_revision: record.baseline.revision, output_revision: record.output.revision, input_revisions: record.input_revisions || {}, evidence, artifacts, attention, decisions: [], decisions_availability: "unavailable", total_files: files.length, additions: null, deletions: null, files: files.slice(offset, offset + size), next_cursor: offset + size < files.length ? offset + size : null, preview_complete: false };
}
