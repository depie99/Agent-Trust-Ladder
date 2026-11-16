import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EGM_REQUIRED_REPORTS, parseEgmReports } from "../runtime/lib/egm-review.mjs";
// Both fixtures are REAL EGM outputs captured from live runs, committed so
// the parser regression runs on any OS without the evidence directory.
// Shape A: `#### A1 — title` sections (codex EGM plugin run).
const a = parseEgmReports(new URL("./fixtures/egm/shape-a", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
assert.deepEqual(a.missingReports, [], "all shape-A reports found");
assert.equal(a.findings.length, 10);
assert.deepEqual(a.findings.map((item) => item.severity), ["blocker", "blocker", "blocker", "blocker", "major", "major", "major", "major", "major", "minor"]);
assert.equal(a.verdictHint, "blocked");
// Shape B: numbered bold items (glm-goldfish real run).
const b = parseEgmReports(new URL("./fixtures/egm/shape-b", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
assert.deepEqual(b.missingReports, [], "all shape-B reports found");
assert.ok(b.findings.length >= 8, `shape B parsed ${b.findings.length} findings`);
assert.equal(b.verdictHint, "blocked");
assert.equal(b.findings[0].severity, "blocker");
assert.ok(b.findings[0].correction.length > 20);
// Codex/plugin runs can persist the consolidated response as a JSON envelope
// instead of plain markdown. Exercise that real-run format as a parser case.
const wrappedDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-egm-wrapped-report-"));
try {
  const shapeAPath = new URL("./fixtures/egm/shape-a", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  for (const name of EGM_REQUIRED_REPORTS) fs.writeFileSync(path.join(wrappedDir, name), name === "consolidated_review_report.md"
    ? JSON.stringify({ "consolidated markdown": fs.readFileSync(path.join(shapeAPath, name), "utf8") })
    : `# ${name}\n`);
  const wrapped = parseEgmReports(wrappedDir);
  assert.deepEqual(wrapped.missingReports, []);
  assert.equal(wrapped.findings.length, a.findings.length);
  assert.equal(wrapped.verdictHint, "blocked");
} finally {
  fs.rmSync(wrappedDir, { recursive: true, force: true });
}
console.log("PASS: parser handles both real EGM report shapes —", a.findings.length, "+", b.findings.length, "findings");
