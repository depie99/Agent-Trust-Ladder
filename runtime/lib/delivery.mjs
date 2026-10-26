import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadState, saveState } from "./state.mjs";

const file = (root) => path.join(root, ".trust", "manager", "delivery-packets.json");
const load = (root) => { try { return JSON.parse(fs.readFileSync(file(root), "utf8")); } catch { return { version: 1, packets: [], approvals: [] }; } };
const save = (root, value) => { fs.mkdirSync(path.dirname(file(root)), { recursive: true }); const tmp = `${file(root)}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n"); fs.renameSync(tmp, file(root)); };
export function createDeliveryPacket(root, taskId, { branch = null, codeRevision = null, summary = "", acceptance = [], review = [], limitations = [], rollback = "" } = {}) { const state = loadState(root); const task = state.tasks?.[taskId]; if (!task) throw new Error(`unknown task ${taskId}`); const packet = { id: `DP-${crypto.randomUUID()}`, task_id: taskId, packet_revision: task.packet_revision || 1, code_revision: codeRevision || task.code_revision || null, branch, summary, acceptance, review, limitations, rollback, draft_pr: null, created_at: new Date().toISOString() }; const data = load(root); data.packets.push(packet); save(root, data); return packet; }
export function approveDraftPr(root, packetId, { base = "main", title, body } = {}) { const data = load(root); const packet = data.packets.find((p) => p.id === packetId); if (!packet) throw new Error("unknown delivery packet"); packet.draft_pr = { approved: true, base, title, body, approved_at: new Date().toISOString() }; save(root, data); return packet; }
export function listDeliveryPackets(root) { return load(root).packets; }
