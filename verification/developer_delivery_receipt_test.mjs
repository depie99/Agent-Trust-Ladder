// Receipt parity across the portable helper and the task-change review surface.
// The UI assertion runs the real controller in a DOM double; it does not claim
// browser layout verification.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import {
  buildDeliveryReceipt,
  deliveryContentRevision,
  evaluateDeliveryReceipt,
  renderDeliveryReceipt,
} from "../skills/atl/scripts/developer-delivery.mjs";
import { recordChanges } from "../runtime/lib/delivery.mjs";

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const files = {
  "src/app.js": sha("export const value = 1;\n"),
  "verification/behavior.mjs": sha("assert.equal(value, 1);\n"),
};
const revision = deliveryContentRevision(files, {});
const changedRevision = deliveryContentRevision({ ...files, "src/app.js": sha("export const value = 2;\n") }, {});
const record = {
  baseline: { files: { "src/app.js": sha("export const value = 0;\n") }, modes: {} },
  output: { files, modes: {} },
};
const changes = recordChanges(record);
assert.deepEqual(changes.map((change) => change.path), ["src/app.js", "verification/behavior.mjs"], "record changes cover every changed path");
assert.equal(changes[0].status, "modified");
assert.equal(changes[1].status, "added");

const base = {
  task: { id: "T-018", source: { system: "azure-boards", id: "42", revision: 7 } },
  content: { files, modes: {} },
  checks: [{
    id: "the changed value is observed",
    result: "pass",
    coverage: "complete",
    content_revision: revision,
    command: "node verification/behavior.mjs",
    verified_by: "beacon",
  }],
  review: { result: "approve", content_revision: revision, reviewer: "spy", independent: true },
  changes,
  artifacts: [{
    id: "capture-018",
    kind: "visual-capture",
    path: "evidence/t-018/after.png",
    sha256: sha("png"),
    availability: "reference-only",
    attribution: "beacon",
    command: "node verification/browser-journey.mjs",
  }],
  host: { capabilities: { execution: true, independent_review: true, visual_observation: true, budget_enforcement: false } },
  visual_change: true,
  usage: { coverage: "unknown" },
  claimed_verdict: "verified-local",
};

const receipt = buildDeliveryReceipt(base);
const verdict = evaluateDeliveryReceipt(receipt);
assert.equal(verdict.status, "verified-local");
const markdown = renderDeliveryReceipt(receipt, verdict);
assert.match(markdown, /Verdict: \*\*verified-local\*\*/);
assert.match(markdown, /evidence\/t-018\/after\.png/);
assert.match(markdown, /beacon/);
assert.match(markdown, /Usage coverage: unknown/);
assert.match(markdown, /no PR, merge, deployment or remote write is implied/);
assert.doesNotMatch(markdown, /pr_url|deployment_url|merged_at/, "the receipt does not fabricate delivery-side facts");

const stale = evaluateDeliveryReceipt(receipt, { observedContentRevision: changedRevision });
assert.equal(stale.status, "incomplete");
assert.match(stale.reason, /content changed after verification/);

const backend = structuredClone(receipt);
backend.visual_change = false;
backend.artifacts = [];
assert.equal(evaluateDeliveryReceipt(backend).status, "verified-local", "a non-UI fixture needs no capture artifact");

const unverified = structuredClone(receipt);
unverified.review = null;
assert.equal(evaluateDeliveryReceipt(unverified).status, "review-required", "an absent independent review is reported, never fabricated");
assert.match(renderDeliveryReceipt(unverified), /independent approval is required/);

const noCapture = structuredClone(receipt);
noCapture.artifacts = [];
assert.equal(evaluateDeliveryReceipt(noCapture).status, "incomplete");
assert.match(evaluateDeliveryReceipt(noCapture).reason, /linked capture of the observed behavior/);

const openFinding = structuredClone(receipt);
openFinding.findings.push({ id: "F-018-1", severity: "major", status: "open", path: "src/app.js", requirement: "the changed value is observed" });
assert.equal(evaluateDeliveryReceipt(openFinding).status, "blocked");
assert.match(evaluateDeliveryReceipt(openFinding).reason, /F-018-1/);

const claimedFixed = structuredClone(openFinding);
claimedFixed.findings[0].status = "resolved";
assert.equal(evaluateDeliveryReceipt(claimedFixed).status, "blocked", "a resolved claim without a recheck is not closed");
assert.match(evaluateDeliveryReceipt(claimedFixed).reason, /without a passing recheck/);

const recheckedFix = structuredClone(claimedFixed);
recheckedFix.findings[0].recheck = { check: "the changed value is observed", content_revision: revision };
assert.equal(evaluateDeliveryReceipt(recheckedFix).status, "verified-local");

const staleRecheck = structuredClone(recheckedFix);
staleRecheck.findings[0].recheck.content_revision = changedRevision;
assert.equal(evaluateDeliveryReceipt(staleRecheck).status, "blocked");

const riskAccepted = structuredClone(openFinding);
riskAccepted.findings[0].status = "risk-accepted";
assert.equal(evaluateDeliveryReceipt(riskAccepted).status, "blocked", "risk acceptance without an authorized decision stays blocked");
assert.match(evaluateDeliveryReceipt(riskAccepted).reason, /needs a reason and an authorized decision/);
riskAccepted.decisions = [{ id: "D-018", finding_id: "F-018-1", outcome: "risk-accepted", reason: "accepted for the pilot window", authorized_by: "owner" }];
assert.equal(evaluateDeliveryReceipt(riskAccepted).status, "verified-local");

const missingCheck = structuredClone(receipt);
missingCheck.checks = [];
assert.equal(evaluateDeliveryReceipt(missingCheck).status, "incomplete");
assert.match(renderDeliveryReceipt(missingCheck), /Reason: no required acceptance checks/);

// Render the real controller against the same receipt and a stale projection.
const listeners = [];
const dialog = { classList: { add() {} }, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] };
const mount = { isConnected: true, innerHTML: "", addEventListener: (name, fn) => { listeners.push([name, fn]); }, querySelectorAll: () => [], querySelector: () => null, contains: () => false, closest: () => dialog };
const view = (delivery) => ({
  id: "capture-018",
  task_id: "T-018",
  status: "blocked",
  captured_at: "2026-11-04T08:00:00Z",
  baseline_revision: "base",
  output_revision: revision,
  source_kind: "inspection",
  packet_revision: 1,
  input_revisions: {},
  total_files: changes.length,
  next_cursor: null,
  files: changes.map((change, index) => ({ id: `file-${index}`, path: change.path, kind: change.status })),
  revisions: [{ id: "capture-018", captured_at: "2026-11-04T08:00:00Z", output_revision: revision }],
  evidence: [],
  attention: [],
  delivery,
});
let response = view({ contract_version: 1, verdict, receipt });
const context = vm.createContext({
  window: {},
  URLSearchParams,
  setTimeout,
  document: { documentElement: { lang: "en-US" }, activeElement: null, querySelector: (selector) => selector === "#taskChangeReview" ? mount : { content: "csrf" } },
  fetch: async () => ({ ok: true, json: async () => structuredClone(response) }),
});
vm.runInContext(fs.readFileSync(new URL("../runtime/control-plane-changes.js", import.meta.url), "utf8"), context);
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const click = async (action) => {
  const handler = listeners.find(([name]) => name === "click")[1];
  handler({ target: { closest: () => ({ dataset: { reviewAction: action } }) } });
  await flush();
};
await context.window.ATL_CHANGE_REVIEW.open({ id: "T-018" }, { popupWide() {}, btn: () => "" });
assert.match(mount.innerHTML, /data-delivery-verdict="verified-local"/);
assert.match(mount.innerHTML, /Delivery receipt/);
assert.match(mount.innerHTML, /capture-018/);
assert.match(mount.innerHTML, /after\.png/);
assert.match(mount.innerHTML, /beacon/);
assert.match(mount.innerHTML, /reference-only/);
assert.match(mount.innerHTML, /Token usage is not measured/);
assert.match(mount.innerHTML, /no PR, merge, deployment or remote write/);

response = view({ contract_version: 1, verdict: evaluateDeliveryReceipt(claimedFixed), receipt: claimedFixed });
await click("refresh");
assert.match(mount.innerHTML, /data-delivery-verdict="blocked"/);
assert.match(mount.innerHTML, /F-018-1/);
assert.match(mount.innerHTML, /without a passing recheck/);
assert.match(mount.innerHTML, />blocking</);

const staleDelivery = { contract_version: 1, verdict: stale, receipt };
response = view(staleDelivery);
await click("refresh");
assert.match(mount.innerHTML, /data-delivery-verdict="incomplete"/);
assert.match(mount.innerHTML, /content changed after verification/);

const escaping = structuredClone(receipt);
escaping.artifacts[0].id = "<img src=x onerror=attack()>";
escaping.findings = [{ id: "<script>attack</script>", severity: "minor", status: "open", blocking: false }];
response = view({ contract_version: 1, verdict: evaluateDeliveryReceipt(escaping), receipt: escaping });
await click("refresh");
assert.doesNotMatch(mount.innerHTML, /<img src=x/);
assert.doesNotMatch(mount.innerHTML, /<script>attack/);
assert.match(mount.innerHTML, /&lt;img src=x onerror=attack\(\)&gt;/);

response = view({ contract_version: 1, verdict: evaluateDeliveryReceipt(unverified), receipt: unverified });
await click("refresh");
assert.match(mount.innerHTML, /data-delivery-verdict="review-required"/);
assert.match(mount.innerHTML, /independent approval is required/);

const evidenceDir = process.env.ATL_RECEIPT_EVIDENCE_DIR;
if (evidenceDir) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(`${evidenceDir}/receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(`${evidenceDir}/receipt.md`, renderDeliveryReceipt(receipt, verdict));
  fs.writeFileSync(`${evidenceDir}/ui-overview-review-required.html`, `${mount.innerHTML}\n`);
  fs.writeFileSync(`${evidenceDir}/verdicts.json`, `${JSON.stringify({
    verified_local: verdict,
    stale_content: stale,
    resolved_without_recheck: evaluateDeliveryReceipt(claimedFixed),
    authorized_risk_decision: evaluateDeliveryReceipt(riskAccepted),
    review_required: evaluateDeliveryReceipt(unverified),
  }, null, 2)}\n`);
}

console.log("PASS: developer delivery receipt — portable/UI parity, stale content, missing capture, finding recheck, authorized risk decision and escaping");
