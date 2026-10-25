// Durable human feedback for bounded provider sessions.
// Feedback is deliberately separate from state.json: it is advisory input
// until a provider session starts, while state.json remains authoritative.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function file(root) {
  return path.join(root, ".trust", "manager", "feedback.jsonl");
}

function readAll(root) {
  const p = file(root);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function append(root, record) {
  const p = file(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(record) + "\n");
}

export function submitFeedback(root, { taskId, prompt, mode = "checkpoint", role = null, session = null, actor = "manager" }) {
  const text = String(prompt || "").trim();
  if (!taskId) throw new Error("feedback requires a task id");
  if (!text) throw new Error("feedback cannot be empty");
  if (!["checkpoint", "interrupt"].includes(mode)) throw new Error(`unknown feedback mode: ${mode}`);
  const now = new Date().toISOString();
  const record = {
    id: `FB-${crypto.randomUUID()}`,
    taskId: String(taskId), role: role || null, session: session == null ? null : Number(session),
    prompt: text, mode, status: "pending", actor, createdAt: now, updatedAt: now,
  };
  append(root, record);
  return record;
}

export function listFeedback(root, { taskId = null, status = null } = {}) {
  return readAll(root).filter((r) => (!taskId || r.taskId === taskId) && (!status || r.status === status));
}

export function pendingFeedback(root, { taskId, role = null } = {}) {
  return listFeedback(root, { taskId, status: "pending" }).filter((r) => !r.role || !role || r.role === role);
}

export function markFeedback(root, id, status, detail = "") {
  const records = readAll(root);
  const index = records.findIndex((r) => r.id === id);
  if (index < 0) throw new Error(`unknown feedback ${id}`);
  records[index] = { ...records[index], status, detail: String(detail || ""), updatedAt: new Date().toISOString() };
  const p = file(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return records[index];
}

export function feedbackPrompt(records) {
  if (!records?.length) return "";
  return [
    "## Human feedback to apply before acting",
    ...records.map((r) => `- [${r.id}] ${r.prompt}`),
    "Treat this as a new manager instruction for this bounded stage. Explain how it changed your approach and record the result in your checkpoint or handoff.",
  ].join("\n");
}

export function feedbackPath(root) { return file(root); }
