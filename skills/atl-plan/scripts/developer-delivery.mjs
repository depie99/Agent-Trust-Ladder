#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DELIVERY_CONTRACT_VERSION = 1;
export const DELIVERY_KIND = "atl-delivery-receipt";
export const DELIVERY_VERDICTS = Object.freeze([
  "verified-local",
  "review-required",
  "blocked",
  "incomplete",
]);

const CLOSED_FINDINGS = new Set(["resolved", "disproved"]);
const BLOCKING_SEVERITIES = new Set(["blocker", "critical", "major"]);
const SAFE_FILE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function validFileMap(files, modes) {
  if (!files || typeof files !== "object" || Array.isArray(files)) return false;
  if (!modes || typeof modes !== "object" || Array.isArray(modes)) return false;
  const names = Object.keys(files);
  if (names.some((name) => !SAFE_FILE.test(name) || typeof files[name] !== "string" || !/^[a-f0-9]{64}$/.test(files[name]))) return false;
  return names.every((name) => modes[name] === undefined || /^[0-7]{6}$/.test(modes[name]));
}

export function deliveryContentRevision(files, modes = {}) {
  if (!validFileMap(files, modes)) throw new Error("content manifest requires safe file names, SHA-256 digests and optional Git modes");
  return sha256(JSON.stringify({ files: sortedObject(files), modes: sortedObject(modes) }));
}

function normalizeCheck(check, index) {
  return {
    id: String(check?.id || check?.check || `check-${index + 1}`),
    required: check?.required !== false,
    result: check?.result || null,
    coverage: check?.coverage || null,
    content_revision: check?.content_revision || null,
    command: check?.command || null,
    verified_by: check?.verified_by || null,
  };
}

function normalizeFinding(finding, index) {
  const severity = String(finding?.severity || "minor").toLowerCase();
  const recheck = finding?.recheck && typeof finding.recheck === "object" ? {
    check: finding.recheck.check || finding.recheck.check_id || null,
    content_revision: finding.recheck.content_revision || null,
    observed: finding.recheck.observed || null,
  } : null;
  return {
    id: String(finding?.id || `finding-${index + 1}`),
    severity,
    status: String(finding?.status || "open").toLowerCase(),
    blocking: finding?.blocking === true || BLOCKING_SEVERITIES.has(severity),
    requirement: finding?.requirement || null,
    path: finding?.path || null,
    content_revision: finding?.content_revision || null,
    evidence: finding?.evidence || null,
    disposition: finding?.disposition || null,
    reason: finding?.reason || null,
    decided_by: finding?.decided_by || null,
    recheck,
  };
}

function normalizeArtifact(artifact) {
  return {
    id: String(artifact?.id || artifact?.path || ""),
    path: artifact?.path || null,
    sha256: artifact?.sha256 || null,
    kind: artifact?.kind || "file",
    availability: artifact?.availability || "unknown",
    command: artifact?.command || null,
    attribution: artifact?.attribution || artifact?.actor || null,
    created_at: artifact?.created_at || null,
  };
}

function closedFindingStatus(status) {
  return CLOSED_FINDINGS.has(String(status || "").toLowerCase());
}

function riskAcceptedStatus(status) {
  return ["risk-accepted", "accepted-risk"].includes(String(status || "").toLowerCase());
}

function authorizedRiskDecision(decisions, findingId) {
  return (Array.isArray(decisions) ? decisions : []).find((decision) => {
    if (!decision || typeof decision !== "object") return false;
    const target = decision.finding_id || decision.finding || decision.id;
    const outcome = String(decision.outcome || decision.status || "").toLowerCase();
    return target === findingId && /accept/.test(outcome) && Boolean(decision.reason) && Boolean(decision.authorized_by);
  }) || null;
}

export function buildDeliveryReceipt(input = {}) {
  const files = input.content?.files || input.files || {};
  const modes = input.content?.modes || input.modes || {};
  return {
    version: DELIVERY_CONTRACT_VERSION,
    kind: DELIVERY_KIND,
    task: {
      id: String(input.task?.id || input.taskId || ""),
      source: input.task?.source || input.source || null,
    },
    content: {
      revision: deliveryContentRevision(files, modes),
      files: sortedObject(files),
      modes: sortedObject(modes),
    },
    checks: Array.isArray(input.checks) ? input.checks.map(normalizeCheck) : [],
    review: input.review ? {
      result: input.review.result || null,
      content_revision: input.review.content_revision || null,
      reviewer: input.review.reviewer || null,
      independent: input.review.independent === true,
    } : null,
    findings: Array.isArray(input.findings) ? input.findings.map(normalizeFinding) : [],
    decisions: Array.isArray(input.decisions) ? input.decisions : [],
    changes: Array.isArray(input.changes) ? input.changes.map((change) => ({
      path: String(change.path || ""),
      status: change.status || null,
      before: change.before || null,
      after: change.after || null,
    })).filter((change) => change.path) : [],
    artifacts: Array.isArray(input.artifacts) ? input.artifacts.map(normalizeArtifact).filter((artifact) => artifact.id) : [],
    host: {
      capabilities: {
        execution: input.host?.capabilities?.execution === true,
        independent_review: input.host?.capabilities?.independent_review === true,
        visual_observation: input.host?.capabilities?.visual_observation === true,
        budget_enforcement: input.host?.capabilities?.budget_enforcement === true,
      },
    },
    visual_change: input.visual_change === true,
    usage: {
      coverage: input.usage?.coverage || "unknown",
      input_tokens: Number.isFinite(input.usage?.input_tokens) ? input.usage.input_tokens : null,
      output_tokens: Number.isFinite(input.usage?.output_tokens) ? input.usage.output_tokens : null,
    },
    claimed_verdict: input.claimed_verdict || input.verdict || null,
    created_at: input.created_at || new Date().toISOString(),
  };
}

export function evaluateDeliveryReceipt(receipt, { observedContentRevision = null } = {}) {
  const problems = [];
  const blockingFindings = [];
  if (!receipt || typeof receipt !== "object") {
    return { version: DELIVERY_CONTRACT_VERSION, status: "incomplete", reason: "receipt missing", problems: ["receipt missing"], missing_checks: [], blocking_findings: [] };
  }
  if (receipt.kind !== DELIVERY_KIND || receipt.version !== DELIVERY_CONTRACT_VERSION) {
    problems.push(`unsupported receipt schema: ${receipt.kind || "unknown"} v${receipt.version ?? "unknown"}`);
  }
  const files = receipt.content?.files;
  const modes = receipt.content?.modes || {};
  let contentRevision = receipt.content?.revision || null;
  if (!validFileMap(files, modes)) {
    problems.push("content manifest is missing or malformed");
    contentRevision = null;
  } else {
    const computed = deliveryContentRevision(files, modes);
    if (contentRevision !== computed) problems.push("content revision does not match the manifest");
    contentRevision = computed;
  }
  if (observedContentRevision && contentRevision !== observedContentRevision) {
    problems.push(`content changed after verification: expected ${observedContentRevision}, receipt has ${contentRevision || "none"}`);
  }
  const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
  const required = checks.filter((check) => check?.required !== false);
  const missingChecks = required
    .filter((check) => check.result !== "pass" || check.coverage !== "complete" || !check.content_revision || check.content_revision !== contentRevision)
    .map((check) => check.id || check.check || "unnamed-check");
  if (!required.length) problems.push("no required acceptance checks");
  if (missingChecks.length) problems.push(`current complete evidence missing for: ${missingChecks.join(", ")}`);
  const passingCheckIds = new Set(required.filter((check) => check.result === "pass" && check.coverage === "complete" && check.content_revision === contentRevision).map((check) => check.id || check.check));
  for (const finding of Array.isArray(receipt.findings) ? receipt.findings : []) {
    const id = finding?.id || "unnamed-finding";
    const blocking = finding?.blocking === true || BLOCKING_SEVERITIES.has(String(finding?.severity || "").toLowerCase());
    if (!blocking) continue;
    if (closedFindingStatus(finding?.status)) {
      // A resolved fix is only closed when a recheck passed on the current revision.
      if (String(finding?.status).toLowerCase() === "resolved") {
        const recheck = finding?.recheck;
        const rechecked = Boolean(recheck?.check) && recheck.content_revision === contentRevision && passingCheckIds.has(recheck.check);
        if (!rechecked) blockingFindings.push(`${id} (marked resolved without a passing recheck on the current content revision)`);
      }
      continue;
    }
    if (riskAcceptedStatus(finding?.status)) {
      const decision = authorizedRiskDecision(receipt.decisions, id);
      if (!decision) blockingFindings.push(`${id} (risk acceptance needs a reason and an authorized decision)`);
      continue;
    }
    blockingFindings.push(id);
  }
  const visualArtifacts = (receipt.artifacts || []).filter((artifact) => artifact.kind === "visual-capture" && !["unavailable", "missing", "unknown"].includes(artifact.availability));
  if (receipt.visual_change === true) {
    if (receipt.host?.capabilities?.visual_observation !== true) problems.push("visual change requires declared visual observation");
    if (!visualArtifacts.length) problems.push("visual change needs a linked capture of the observed behavior, not a contract diagram");
  }

  const common = {
    version: DELIVERY_CONTRACT_VERSION,
    content_revision: contentRevision,
    missing_checks: missingChecks,
    blocking_findings: blockingFindings,
  };
  if (blockingFindings.length) {
    return { ...common, status: "blocked", reason: `blocking findings are not closed with current evidence: ${blockingFindings.join(", ")}`, problems };
  }
  if (problems.length) {
    return { ...common, status: "incomplete", reason: problems.join("; "), problems };
  }
  const review = receipt.review;
  if (!review || review.result !== "approve" || review.independent !== true || review.content_revision !== contentRevision) {
    const reason = review?.result === "changes-requested"
      ? "independent review requested changes"
      : "independent approval is required for the final content revision";
    return { ...common, status: "review-required", reason, problems: [reason] };
  }
  if (receipt.host?.capabilities?.independent_review !== true) {
    const reason = "host does not record an independent review capability";
    return { ...common, status: "review-required", reason, problems: [reason] };
  }
  return { ...common, status: "verified-local", reason: null, problems: [] };
}

export function renderDeliveryReceipt(receipt, verdict = evaluateDeliveryReceipt(receipt)) {
  const missing = verdict.missing_checks?.length ? verdict.missing_checks.join(", ") : "none";
  const rechecked = (finding) => finding?.recheck?.check
    ? `${finding.recheck.check} @ ${finding.recheck.content_revision || "unversioned"}`
    : "none";
  const findings = receipt.findings?.length
    ? receipt.findings.map((finding) => `| ${finding.id} | ${finding.severity} | ${finding.status} | ${finding.blocking ? "yes" : "no"} | ${finding.path || "none"} | ${rechecked(finding)} | ${finding.reason || finding.disposition || "none"} |`).join("\n")
    : "| none | - | - | - | - | - | - |";
  const changes = receipt.changes?.length
    ? receipt.changes.map((change) => `| ${change.path} | ${change.status || "unknown"} | ${change.before || "none"} | ${change.after || "none"} |`).join("\n")
    : "| none recorded | - | - | - |";
  const artifacts = receipt.artifacts?.length
    ? receipt.artifacts.map((artifact) => `| ${artifact.id} | ${artifact.kind} | ${artifact.path || "none"} | ${artifact.availability} | ${artifact.attribution || "unattributed"} | ${artifact.command || "not recorded"} |`).join("\n")
    : "| none | - | - | unavailable | - | - |";
  const checks = receipt.checks?.length
    ? receipt.checks.map((check) => `| ${check.id} | ${check.result || "missing"} | ${check.coverage || "missing"} | ${check.verified_by || "unknown"} | ${check.command || "not recorded"} |`).join("\n")
    : "| none | missing | missing | unknown | not recorded |";
  const decisions = receipt.decisions?.length
    ? receipt.decisions.map((decision) => typeof decision === "string"
      ? `- ${decision}`
      : `- ${decision.id || decision.finding_id || "decision"} · ${decision.outcome || decision.status || "recorded"} × ${decision.authorized_by || "unauthorized"} · ${decision.reason || "no reason"}`).join("\n")
    : "- none recorded";
  const claimed = receipt.claimed_verdict
    ? `Claimed verdict: ${receipt.claimed_verdict}${receipt.claimed_verdict === verdict.status ? "" : " (does not match the evaluated verdict)"}`
    : "Claimed verdict: none";
  return `# Delivery receipt

Task: ${receipt.task?.id || "unknown"}
Source: ${receipt.task?.source ? `${receipt.task.source.system || receipt.task.source.type || "unknown"} ${receipt.task.source.id || receipt.task.source.remote_id || ""} revision ${receipt.task.source.revision ?? "unknown"}` : "not recorded"}
Verdict: **${verdict.status}**
Reason: ${verdict.reason || "none"}
${claimed}
Content revision: ${verdict.content_revision || "unavailable"}
Missing checks: ${missing}
Unresolved blocking findings: ${verdict.blocking_findings?.join(", ") || "none"}
Host capabilities: execution=${receipt.host?.capabilities?.execution === true}, independent_review=${receipt.host?.capabilities?.independent_review === true}, visual_observation=${receipt.host?.capabilities?.visual_observation === true}, budget_enforcement=${receipt.host?.capabilities?.budget_enforcement === true}
Usage coverage: ${receipt.usage?.coverage || "unknown"}
Boundary: local verification only; no PR, merge, deployment or remote write is implied.

## Acceptance evidence

| Check | Result | Coverage | Verified by | Command |
|---|---|---|---|---|
${checks}

## Changes

| Path | Status | Before | After |
|---|---|---|---|
${changes}

## Findings

| ID | Severity | Status | Blocking | Affected path | Recheck | Disposition |
|---|---|---|---|---|---|---|
${findings}

## Artifacts

| ID | Kind | Path | Availability | Attribution | Command |
|---|---|---|---|---|---|
${artifacts}

## Decisions

${decisions}
`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function main(args) {
  const command = args[0];
  if (command === "revision") {
    const manifest = readJson(args[1]);
    process.stdout.write(`${deliveryContentRevision(manifest.files, manifest.modes)}\n`);
    return 0;
  }
  if (command === "validate") {
    const receipt = readJson(args[1]);
    const observedIndex = args.indexOf("--content-revision");
    const observedContentRevision = observedIndex >= 0 ? args[observedIndex + 1] : null;
    const verdict = evaluateDeliveryReceipt(receipt, { observedContentRevision });
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
    return verdict.status === "verified-local" ? 0 : 2;
  }
  if (command === "render") {
    const receipt = readJson(args[1]);
    const verdict = evaluateDeliveryReceipt(receipt);
    const markdown = renderDeliveryReceipt(receipt, verdict);
    const outputIndex = args.indexOf("--output");
    if (outputIndex >= 0) {
      const output = path.resolve(args[outputIndex + 1]);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, markdown);
    } else {
      process.stdout.write(markdown);
    }
    return verdict.status === "verified-local" ? 0 : 2;
  }
  process.stderr.write("Usage: developer-delivery.mjs revision <manifest.json> | validate <receipt.json> [--content-revision <sha256>] | render <receipt.json> [--output file]\n");
  return 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
