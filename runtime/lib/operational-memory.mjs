// Control Plane surface for operational memory. The decisions live in the
// portable helper so the UI and a skills-only host cannot drift apart.
import fs from "node:fs";
import path from "node:path";
export * from "../../skills/atl/scripts/operational-memory.mjs";
import { recordFailure, selectContext, preventionStatus, failureSignature } from "../../skills/atl/scripts/operational-memory.mjs";

export function recordFailureFromReceipt(root, receipt = {}, { taskId = null } = {}) {
  const findings = Array.isArray(receipt.findings) ? receipt.findings : [];
  const blocking = findings.filter((finding) => ["blocker", "major"].includes(finding.severity || finding.severity_hint));
  const verdict = receipt.verdict || "unknown";
  if (!blocking.length && verdict !== "failed") return { recorded: false, reason: "no blocking finding in this receipt" };
  const recorded = [];
  for (const finding of blocking) {
    recorded.push(recordFailure(root, {
      blocker: finding.blocker || finding.id || "finding",
      reason: finding.message || finding.summary || receipt.reason || verdict,
      task_id: taskId,
      receipt: receipt.receipt_id || null,
      symptom: finding.message || null,
    }));
  }
  return { recorded: true, signatures: recorded };
}

export function operationalMemoryView(root, { query = "", budgetChars = 1200, signatureId = null } = {}) {
  return {
    preventions: preventionStatus(root, { signature_id: signatureId }),
    context: selectContext(root, { query, budgetChars }),
  };
}

export function taskContext(root, task = {}, { budgetChars = 1200 } = {}) {
  const query = [task.title, task.objective, ...(task.completion_checks || [])].filter(Boolean).join(" ");
  const selection = selectContext(root, { query, budgetChars });
  return {
    ...selection,
    task_id: task.id || null,
    selection_reason: selection.items.length
      ? `selected ${selection.items.length} of ${selection.coverage.considered} matching sources inside ${budgetChars} characters`
      : "no project source matched this task; the run must not invent prior knowledge",
  };
}

export function latestFailureSignatures(root, { limit = 5 } = {}) {
  const file = path.join(root, ".atl", "memory", "failures.jsonl");
  if (!fs.existsSync(file)) return [];
  const counts = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const current = counts.get(item.signature_id) || { signature_id: item.signature_id, cause_class: item.cause_class, count: 0, last_at: item.at, reason: item.normalized_reason };
    current.count += 1;
    if (String(item.at) > String(current.last_at)) { current.last_at = item.at; current.reason = item.normalized_reason; }
    counts.set(item.signature_id, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || String(b.last_at).localeCompare(String(a.last_at))).slice(0, limit);
}

export { failureSignature };
