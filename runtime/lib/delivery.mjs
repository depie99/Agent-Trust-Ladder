import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadState, saveState } from "./state.mjs";
import { deliveryGate, snapshot } from "./handoffs.mjs";
import { buildDeliveryReceipt, evaluateDeliveryReceipt } from "../../skills/atl/scripts/developer-delivery.mjs";

const file = (root) => path.join(root, ".trust", "manager", "delivery-packets.json");
const load = (root) => { try { return JSON.parse(fs.readFileSync(file(root), "utf8")); } catch { return { version: 1, packets: [], approvals: [] }; } };
const save = (root, value) => { fs.mkdirSync(path.dirname(file(root)), { recursive: true }); const tmp = `${file(root)}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n"); fs.renameSync(tmp, file(root)); };

function latestCurrent(evidence, currentPacket, predicates) {
  return [...evidence].reverse().find((entry) => (entry.packet_revision || 1) === currentPacket && !entry.invalidated && predicates(entry)) || null;
}

export function recordChanges(record) {
  const base = record?.baseline?.files || {};
  const out = record?.output?.files || {};
  const baseModes = record?.baseline?.modes || {};
  const outModes = record?.output?.modes || {};
  return [...new Set([...Object.keys(base), ...Object.keys(out)])]
    .filter((name) => base[name] !== out[name] || baseModes[name] !== outModes[name])
    .map((name) => ({
      path: name,
      status: !(name in base) ? "added" : !(name in out) ? "deleted" : base[name] !== out[name] ? "modified" : "mode_changed",
      before: base[name] ? base[name].slice(0, 12) : null,
      after: out[name] ? out[name].slice(0, 12) : null,
    }));
}

function receiptForTask(task, output, { capabilities = {}, changedFiles = [], changes = null } = {}) {
  const currentPacket = task.packet_revision || 1;
  const evidence = (task.evidence || []).filter((entry) => (entry.packet_revision || 1) === currentPacket && !entry.invalidated);
  const checks = (task.completion_checks || []).map((check) => {
    const entry = latestCurrent(evidence, currentPacket, (item) => item.kind === "check" && item.check === check);
    return {
      id: check,
      required: true,
      result: entry?.result || null,
      coverage: entry?.coverage || null,
      content_revision: entry?.code_revision || null,
      command: entry?.command || null,
      verified_by: entry?.actor || null,
    };
  });
  const reviewEntry = latestCurrent(evidence, currentPacket, (item) => item.kind === "review");
  const review = reviewEntry ? {
    result: reviewEntry.result,
    content_revision: reviewEntry.code_revision || null,
    reviewer: reviewEntry.actor,
    independent: reviewEntry.actor === "sage" || reviewEntry.independent === true,
  } : null;
  const receipt = buildDeliveryReceipt({
    task: { id: task.id, source: task.source || null },
    content: { files: output.files, modes: output.modes },
    checks,
    review,
    findings: task.findings || [],
    decisions: task.decisions || [],
    changes: Array.isArray(changes) ? changes : changedFiles.map((name) => ({ path: name, status: "changed" })),
    artifacts: evidence.filter((entry) => entry.artifact_hash).map((entry) => ({
      id: entry.artifact_hash,
      path: entry.artifact_path || null,
      sha256: entry.artifact_hash,
      kind: entry.kind === "browser-journey" ? "visual-capture" : "evidence",
      availability: "reference-only",
      command: entry.command || null,
      attribution: entry.actor || null,
      created_at: entry.at || null,
    })),
    host: { capabilities: {
      execution: capabilities.execution !== false,
      independent_review: Boolean(review?.independent),
      visual_observation: capabilities.visual_observation === true,
      budget_enforcement: capabilities.budget_enforcement === true,
    } },
    visual_change: task.visual_change === true || capabilities.visual_change === true,
    usage: task.usage || { coverage: "unknown" },
  });
  return { receipt, verdict: evaluateDeliveryReceipt(receipt, { observedContentRevision: output.revision }), output };
}

export function taskDeliveryReceipt(root, taskId, { capabilities = {} } = {}) {
  const state = loadState(root);
  const task = state.tasks?.[taskId];
  if (!task) throw new Error(`unknown task ${taskId}`);
  if (!task.workspace || !fs.existsSync(task.workspace)) throw new Error(`${taskId}: a workspace is required for content-bound delivery`);
  const output = snapshot(root, task.workspace);
  const changedFiles = task.handoff_baseline
    ? [...new Set([...Object.keys(task.handoff_baseline.files || {}), ...Object.keys(output.files || {})])].filter((name) => task.handoff_baseline.files?.[name] !== output.files[name] || task.handoff_baseline.modes?.[name] !== output.modes[name])
    : [];
  return receiptForTask(task, output, { capabilities, changedFiles });
}

export function taskDeliveryReceiptFromRecord(task, record, { capabilities = {} } = {}) {
  if (!task?.id || !record?.output?.revision) throw new Error("task and pinned output record are required");
  return receiptForTask(task, record.output, { capabilities, changedFiles: record.changed_files || [], changes: recordChanges(record) });
}

export function createDeliveryPacket(root, taskId, { branch = null, codeRevision = null, summary = "", acceptance = [], review = [], limitations = [], rollback = "", capabilities = {} } = {}) {
  const state = loadState(root);
  const task = state.tasks?.[taskId];
  if (!task) throw new Error(`unknown task ${taskId}`);
  const currentPacket = task.packet_revision || 1;
  let receipt = null;
  let verdict = null;
  let revision = codeRevision || task.code_revision || null;
  if (task.workspace && fs.existsSync(task.workspace)) {
    const adapted = taskDeliveryReceipt(root, taskId, { capabilities });
    receipt = adapted.receipt;
    verdict = adapted.verdict;
    revision = adapted.output.revision;
    if (verdict.status !== "verified-local") throw new Error(`delivery requires verified-local evidence: ${verdict.reason}`);
  } else {
    const evidence = task.evidence || [];
    const reviewCurrent = evidence.some((entry) => entry.kind === "review" && entry.result === "approve" && (entry.packet_revision || 1) === currentPacket && (!revision || !entry.code_revision || entry.code_revision === revision));
    const checksCurrent = (task.completion_checks || []).every((check) => evidence.some((entry) => entry.kind === "check" && entry.check === check && entry.result === "pass" && (entry.packet_revision || 1) === currentPacket && (!revision || !entry.code_revision || entry.code_revision === revision)));
    if (!reviewCurrent || !checksCurrent) throw new Error("delivery requires current review and verification evidence");
    limitations = [...limitations, "Legacy packet without a content-bound receipt; publish only after fresh verification."];
  }
  const packet = { id: `DP-${crypto.randomUUID()}`, contract_version: receipt ? receipt.version : null, task_id: taskId, packet_revision: currentPacket, code_revision: revision, receipt, verdict: verdict?.status || "legacy-unverified", branch, summary, acceptance, review, limitations, rollback, draft_pr: null, created_at: new Date().toISOString() };
  const data = load(root);
  data.packets.push(packet);
  save(root, data);
  return packet;
}
export function approveDraftPr(root, packetId, { base = "main", title, body } = {}) { const data = load(root); const packet = data.packets.find((p) => p.id === packetId); if (!packet) throw new Error("unknown delivery packet"); if (packet.receipt && evaluateDeliveryReceipt(packet.receipt, { observedContentRevision: packet.code_revision }).status !== "verified-local") throw new Error("draft PR approval requires a verified-local receipt"); packet.draft_pr = { approved: true, base, title, body, approved_at: new Date().toISOString() }; save(root, data); return packet; }
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
