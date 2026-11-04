import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as portable from "../skills/atl/scripts/operational-memory.mjs";
import * as runtime from "../runtime/lib/operational-memory.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-operational-memory-"));
const recoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-operational-memory-recovery-"));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
};

try {
  // ---------- held-out retrieval bank: English and Persian ----------
  const sources = [
    { source_id: "s-en-queue", title: "Overnight queue recovery", text: "The queue resumes from the checkpoint after a restart and never repeats a settled item.", observed_at: "2026-10-01T00:00:00.000Z", revision: "r1" },
    { source_id: "s-en-azure", title: "Azure Boards intake", text: "Read-only work item intake keeps the remote revision so an unchanged item does not create a duplicate task.", observed_at: "2026-10-02T00:00:00.000Z", revision: "r2" },
    { source_id: "s-en-long", title: "Verifier contract", text: "A".repeat(900), observed_at: "2026-10-03T00:00:00.000Z", revision: "r3" },
    { source_id: "s-fa-checkpoint", title: "بازیابی صف شبانه", text: "صف شبانه بعد از راه‌اندازی مجدد از نقطه بازرسی ادامه می‌دهد و کار تمام‌شده را تکرار نمی‌کند.", observed_at: "2026-10-04T00:00:00.000Z", revision: "r4" },
    { source_id: "s-fa-azure", title: "ورود از آزور", text: "خواندن فقط‌خواندنی آیتم آزور نسخهٔ مبدأ را نگه می‌دارد.", observed_at: "2026-10-05T00:00:00.000Z", revision: "r5" },
    { source_id: "s-stale", title: "Retired queue policy", text: "The old queue policy allowed repeats.", observed_at: "2026-01-01T00:00:00.000Z", valid_until: "2026-02-01T00:00:00.000Z", revision: "r6" },
  ];
  write(portable.memoryPaths(root).sources, { version: portable.MEMORY_VERSION, sources });

  const bank = [
    { query: "queue resume checkpoint restart", expect: "s-en-queue" },
    { query: "azure work item duplicate revision", expect: "s-en-azure" },
    { query: "verifier contract", expect: "s-en-long" },
    { query: "صف شبانه نقطه بازرسی", expect: "s-fa-checkpoint" },
    { query: "خواندن آیتم آزور نسخه", expect: "s-fa-azure" },
    { query: "کار تمام‌شده تکرار", expect: "s-fa-checkpoint" },
  ];
  let recalled = 0;
  for (const entry of bank) {
    const selection = portable.selectContext(root, { query: entry.query, budgetChars: 400, now: Date.parse("2026-11-01T00:00:00.000Z") });
    const ids = selection.items.map((item) => item.source_id);
    assert.ok(ids.includes(entry.expect), `held-out query "${entry.query}" must recall ${entry.expect}, got ${ids.join(",")}`);
    assert.ok(selection.used_chars <= 400, "the context budget is respected");
    assert.ok(selection.items.every((item) => item.revision && item.selected_because), "every selected item carries provenance");
    if (ids.includes(entry.expect)) recalled++;
  }
  assert.equal(recalled, bank.length, "held-out recall covers every case");

  const truncated = portable.selectContext(root, { query: "verifier contract", budgetChars: 120, now: Date.parse("2026-11-01T00:00:00.000Z") });
  assert.equal(truncated.items[0].truncated, true, "a long source is truncated inside the budget");
  assert.equal(truncated.coverage.stale, 1, "the expired source is excluded and counted, not silently used");
  assert.ok(!truncated.items.some((item) => item.source_id === "s-stale"));

  const empty = portable.selectContext(root, { query: "kubernetes helm chart", budgetChars: 400 });
  assert.equal(empty.status, "no-evidence");
  assert.equal(empty.coverage.missing_evidence, true);
  assert.deepEqual(empty.items, []);

  const persianTokens = portable.tokenize("نیم‌فاصله و بازرسی");
  assert.ok(persianTokens.includes("نیمفاصله") && persianTokens.includes("بازرسی"), "ZWNJ text is tokenized without breaking words");
  assert.ok(portable.tokenize("Queue: resume(checkpoint)").includes("checkpoint"));

  // ---------- claim state ----------
  const claims = [
    { claim_id: "c1", subject: "queue", predicate: "max_sessions", value: "8", source_id: "s1", source_revision: "r1", status: "VERIFIED" },
    { claim_id: "c2", subject: "queue", predicate: "max_sessions", value: "20", source_id: "s2", source_revision: "r2", status: "VERIFIED" },
    { claim_id: "c3", subject: "queue", predicate: "retry_policy", value: "bounded", source_id: "s3", source_revision: "r3", status: "PARTIAL" },
    { claim_id: "c4", subject: "queue", predicate: "max_sessions", value: "8", source_id: "s1", source_revision: "r1", status: "VERIFIED" },
    { claim_id: "c5", subject: "queue", predicate: "max_sessions", value: "20", source_id: "s2", source_revision: "r2", status: "VERIFIED" },
    { claim_id: "c6", subject: "queue", predicate: "max_sessions", value: "8", source_id: "s1", source_revision: "r1", status: "SUPERSEDED", superseded_by: "c7" },
    { claim_id: "c7", subject: "queue", predicate: "max_sessions", value: "12", source_id: "s4", source_revision: "r4", status: "VERIFIED" },
    { claim_id: "c8", subject: "queue", predicate: "max_sessions", value: "8", source_id: "s5", source_revision: "r5", status: "VERIFIED", valid_until: "2000-01-01T00:00:00.000Z" },
    { claim_id: "c9", subject: "queue", predicate: "owner", value: "pip", source_id: "s6", status: "VERIFIED" },
  ];
  const state = portable.claimStates(claims, { now: Date.parse("2026-11-01T00:00:00.000Z") });
  assert.deepEqual(state.counts, { active: 1, conflicted: 5, unknown: 1, expired: 1, superseded: 1 });
  const byClaim = new Map(state.items.map((item) => [item.claim_id, item.state]));
  assert.equal(byClaim.get("c3"), "active", "a different predicate on the same subject is not a contradiction");
  assert.equal(byClaim.get("c4"), "conflicted", "two independent sources disagreeing makes the shared value conflicted");
  assert.equal(byClaim.get("c6"), "superseded");
  assert.equal(byClaim.get("c7"), "conflicted", "the successor still disagrees with the other independent value for the same predicate");
  const successor = portable.claimStates([
    { claim_id: "c10", subject: "queue", predicate: "owner", value: "mira", source_id: "s1", source_revision: "r1", status: "SUPERSEDED", superseded_by: "c11" },
    { claim_id: "c11", subject: "queue", predicate: "owner", value: "pip", source_id: "s1", source_revision: "r2", status: "VERIFIED" },
  ]);
  assert.deepEqual(successor.counts, { active: 1, conflicted: 0, unknown: 0, expired: 0, superseded: 1 }, "the successor of a superseded claim is the current one");
  assert.equal(byClaim.get("c8"), "expired");
  assert.equal(byClaim.get("c9"), "unknown", "a claim without a source revision is never verified");

  const copiesOnly = portable.claimStates([
    { claim_id: "k1", subject: "queue", predicate: "max_sessions", value: "8", source_id: "s1", source_revision: "r1", status: "VERIFIED" },
    { claim_id: "k2", subject: "queue", predicate: "max_sessions", value: "8", source_id: "s1", source_revision: "r1", status: "VERIFIED" },
  ]);
  assert.deepEqual(copiesOnly.counts, { active: 2, conflicted: 0, unknown: 0, expired: 0, superseded: 0 });

  // ---------- recurring failure to tested preventer ----------
  assert.throws(() => portable.proposePrevention(root, { signature_id: "x", preventer: "y" }), /one anecdote is not a recurring failure/);
  portable.recordFailure(root, { blocker: "stale-plan-review", reason: "approved plan became stale at revision 4", task_id: "T-1", at: "2026-10-30T00:00:00.000Z" });
  assert.throws(() => portable.proposePrevention(root, { signature_id: "x", preventer: "y" }), /one anecdote/);
  portable.recordFailure(root, { blocker: "stale-plan-review", reason: "approved plan became stale at revision 6", task_id: "T-2", at: "2026-10-31T00:00:00.000Z" });
  const signature = portable.failureSignature({ blocker: "stale-plan-review", reason: "approved plan became stale at revision 9" });
  assert.equal(signature.signature_id, portable.failureSignature({ blocker: "stale-plan-review", reason: "approved plan became stale at revision 4" }).signature_id, "volatile numbers and paths do not split one signature");
  const proposal = portable.proposePrevention(root, { signature_id: signature.signature_id, preventer: "hash only declared plan evidence", rollback: "revert planFingerprint", author: "agent" });
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.before_occurrences, 2);
  assert.throws(() => portable.authorizePrevention(root, proposal.candidate_id, { actor: "owner" }), /passing regression command/);
  assert.throws(() => portable.authorizePrevention(root, proposal.candidate_id, { actor: "owner", evidence: { command: "node x.mjs", result: "failed" } }), /passing regression command/);
  const authorized = portable.authorizePrevention(root, proposal.candidate_id, { actor: "owner", evidence: { command: "node verification/task_dependency_contract_test.mjs", result: "passed", at: "2026-11-02T00:00:00.000Z" } });
  assert.equal(authorized.status, "authorized");
  assert.equal(authorized.authorized_at, "2026-11-02T00:00:00.000Z");
  portable.recordFailure(root, { blocker: "stale-plan-review", reason: "approved plan became stale at revision 8", at: "2026-11-03T00:00:00.000Z" });
  const status = portable.preventionStatus(root, { signature_id: signature.signature_id });
  assert.equal(status.enforced.length, 1);
  assert.equal(status.enforced[0].before_occurrences, 2);
  assert.equal(status.enforced[0].after_occurrences, 1, "the report measures recurrences after authorization instead of claiming savings");
  const rolledBack = portable.rollbackPrevention(root, proposal.candidate_id, { actor: "owner", reason: "regression" });
  assert.equal(rolledBack.status, "rolled-back");
  assert.equal(portable.preventionStatus(root).enforced.length, 0, "a rolled-back preventer is not reported as enforced");
  assert.ok(rolledBack.history.length >= 3, "the prevention history is retained after rollback");
  assert.equal(runtime.latestFailureSignatures(root)[0].count, 3, "the runtime view reports the recurring signature");
  const receiptRecording = runtime.recordFailureFromReceipt(root, { verdict: "blocked", findings: [{ id: "F-1", severity: "blocker", message: "verifier did not run" }] }, { taskId: "T-9" });
  assert.equal(receiptRecording.recorded, true);
  assert.equal(runtime.recordFailureFromReceipt(root, { verdict: "verified-local", findings: [] }).recorded, false);

  // ---------- interrupted writes and corruption ----------
  const clean = portable.recoverMemory(recoveryRoot);
  assert.equal(clean.status, "clean");
  assert.equal(clean.verified, true);
  portable.writeJournaled(recoveryRoot, "sources.json", { version: 1, sources: [] });
  assert.equal(portable.recoverMemory(recoveryRoot).status, "clean");
  write(path.join(portable.memoryPaths(recoveryRoot).journal, "intent-only.json"), { name: "claims.json", phase: "intent" });
  write(path.join(portable.memoryPaths(recoveryRoot).temporary, "claims.json.999.tmp"), "partial");
  const interrupted = portable.recoverMemory(recoveryRoot);
  assert.equal(interrupted.status, "inconsistent");
  assert.equal(interrupted.verified, false, "an interrupted write never reports verified knowledge");
  assert.ok(interrupted.problems.some((problem) => problem.cause === "interrupted-write"));
  assert.ok(interrupted.problems.some((problem) => problem.cause === "partial-temporary-file"));
  write(portable.memoryPaths(recoveryRoot).sources, "{ this is not json");
  assert.ok(portable.recoverMemory(recoveryRoot).problems.some((problem) => problem.cause === "corrupt-store"));
  const refused = portable.selectContext(recoveryRoot, { query: "anything" });
  assert.equal(refused.status, "inconsistent");
  assert.deepEqual(refused.items, [], "no context is served from a corrupt store");
  assert.throws(() => portable.proposePrevention(recoveryRoot, { signature_id: "s", preventer: "p" }), /one anecdote/);

  // ---------- both surfaces decide identically ----------
  assert.deepEqual(runtime.claimStates(claims, { now: Date.parse("2026-11-01T00:00:00.000Z") }), portable.claimStates(claims, { now: Date.parse("2026-11-01T00:00:00.000Z") }));
  const parityQuery = { query: "صف شبانه نقطه بازرسی", budgetChars: 300, now: Date.parse("2026-11-01T00:00:00.000Z") };
  assert.deepEqual(runtime.selectContext(root, parityQuery), portable.selectContext(root, parityQuery));
  assert.deepEqual(runtime.preventionStatus(root), portable.preventionStatus(root));
  assert.deepEqual(runtime.operationalMemoryView(root, { query: "azure", budgetChars: 200 }).context, portable.selectContext(root, { query: "azure", budgetChars: 200 }));
  const taskView = runtime.taskContext(root, { id: "T-77", title: "Azure intake", objective: "Read the work item revision", completion_checks: ["no duplicate task"] });
  assert.equal(taskView.task_id, "T-77");
  assert.match(taskView.selection_reason, /selected \d+ of \d+ matching sources|no project source matched/);
  console.log("operational memory parity tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.rmSync(recoveryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
