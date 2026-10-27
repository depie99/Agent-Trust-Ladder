import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadState, saveState } from "./state.mjs";
import { deliveryGate } from "./handoffs.mjs";

const file = (root) => path.join(root, ".trust", "manager", "delivery-packets.json");
const load = (root) => { try { return JSON.parse(fs.readFileSync(file(root), "utf8")); } catch { return { version: 1, packets: [], approvals: [] }; } };
const save = (root, value) => { fs.mkdirSync(path.dirname(file(root)), { recursive: true }); const tmp = `${file(root)}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n"); fs.renameSync(tmp, file(root)); };
export function createDeliveryPacket(root, taskId, { branch = null, codeRevision = null, summary = "", acceptance = [], review = [], limitations = [], rollback = "" } = {}) { const state = loadState(root); const task = state.tasks?.[taskId]; if (!task) throw new Error(`unknown task ${taskId}`); const revision = codeRevision || task.code_revision || null; const currentPacket = task.packet_revision || 1; const evidence = task.evidence || []; const reviewCurrent = evidence.some((e) => e.kind === "review" && e.result === "approve" && (e.packet_revision || 1) === currentPacket && (!revision || !e.code_revision || e.code_revision === revision)); const checksCurrent = (task.completion_checks || []).every((check) => evidence.some((e) => e.kind === "check" && e.check === check && e.result === "pass" && (e.packet_revision || 1) === currentPacket && (!revision || !e.code_revision || e.code_revision === revision))); if (!reviewCurrent || !checksCurrent) throw new Error("delivery requires current review and verification evidence"); const packet = { id: `DP-${crypto.randomUUID()}`, task_id: taskId, packet_revision: currentPacket, code_revision: revision, branch, summary, acceptance, review, limitations, rollback, draft_pr: null, created_at: new Date().toISOString() }; const data = load(root); data.packets.push(packet); save(root, data); return packet; }
export function approveDraftPr(root, packetId, { base = "main", title, body } = {}) { const data = load(root); const packet = data.packets.find((p) => p.id === packetId); if (!packet) throw new Error("unknown delivery packet"); packet.draft_pr = { approved: true, base, title, body, approved_at: new Date().toISOString() }; save(root, data); return packet; }
export function listDeliveryPackets(root) { return load(root).packets; }

export function recordIntegratedDelivery(root, taskId, delivery) {
  const state = loadState(root); const task = state.tasks[taskId];
  const gate = deliveryGate(root, [task], task);
  if (!gate.ready || gate.revision !== delivery.revision || !delivery.branch || !delivery.commit) throw new Error("integrated delivery requires composed review, predecessor checks and browser journey for the exact revision");
  const data = load(root);
  const existing = data.packets.find((packet) => packet.integrated && packet.task_id === taskId && packet.code_revision === delivery.revision && packet.packet_revision === (task.packet_revision || 1));
  if (existing) return existing;
  const packet = { version: 1, id: `DP-${crypto.randomUUID()}`, integrated: true, task_id: taskId, packet_revision: task.packet_revision || 1, code_revision: delivery.revision, branch: delivery.branch, commit: delivery.commit, summary: "Composed output verified with predecessor behavior and integrated browser journey", acceptance: [...new Set([...(task.completion_checks || []), ...(task.integrated_checks || [])])], review: task.evidence.filter((entry) => entry.kind === "review" && entry.code_revision === delivery.revision && !entry.invalidated), evidence: task.evidence.filter((entry) => entry.code_revision === delivery.revision && !entry.invalidated), rollback: "Discard the local delivery branch; the active branch was not changed", limitations: [], draft_pr: null, created_at: new Date().toISOString() };
  data.packets.push(packet); save(root, data); return packet;
}
