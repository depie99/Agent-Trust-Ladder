import assert from "node:assert/strict";
import { parseEgmReports } from "../runtime/lib/egm-review.mjs";
const evidence = "D:/Projects/Agentic/.atl-evidence/egm-compatibility-20261103";
// Shape A: A1-heading style (run 2)
const a = parseEgmReports(evidence + "/fixture/reports-run2");
assert.equal(a.findings.length, 10);
assert.deepEqual(a.findings.map((item) => item.severity), ["blocker", "blocker", "blocker", "blocker", "major", "major", "major", "major", "major", "minor"]);
assert.equal(a.verdictHint, "blocked");
// Shape B: numbered bold style (real E2E run 2)
const b = parseEgmReports(evidence + "/e2e-root/.trust/manager/plan-studio/2026-11-03T10-50-54-306Z-add-a-durable-delivery-queue/egm/" + (await import("node:fs")).readdirSync(evidence + "/e2e-root/.trust/manager/plan-studio/2026-11-03T10-50-54-306Z-add-a-durable-delivery-queue/egm")[0]);
assert.ok(b.findings.length >= 8, `shape B parsed ${b.findings.length} findings`);
assert.equal(b.verdictHint, "blocked");
assert.equal(b.findings[0].severity, "blocker");
assert.match(b.findings[0].message, /delivery guarantee/i);
assert.ok(b.findings[0].correction.length > 20);
console.log("PASS: parser handles both real EGM report shapes —", a.findings.length, "+", b.findings.length, "findings");
