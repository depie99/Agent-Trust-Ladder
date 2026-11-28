import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildExecutionProjection } from "../runtime/lib/execution-projection.mjs";
import { emptyState, saveState, loadState, logEvent, addEvidence } from "../runtime/lib/state.mjs";
import { acquireLease, releaseLease } from "../runtime/lib/leases.mjs";
import { recordExecution } from "../runtime/lib/execution-report.mjs";
import { fixture } from "./fixtures/task-changes/project.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// ---- Unit: pure join over injected records --------------------------------
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-execution-projection-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
state.tasks["T-100"] = {
  id: "T-100", title: "Projected task", status: "in_progress", packet_revision: 2,
  repository_id: "repo-1", repository_name: "example-org-base", repository_ids: ["repo-1", "repo-2"],
  workspace: "D:/worktrees/T-100",
  evidence: [],
};
saveState(root, state);

// Unknown task stays honest.
assert.equal(buildExecutionProjection(root, "T-NOPE").availability, "unknown_task");

// A session appears once, and only its matching active lease can mark it running.
{
  const lease = acquireLease(root, { project: root, task: "T-100", role: "rowan", run: "test" });
  const start = { id: "active", taskId: "T-100", role: "rowan", leaseId: lease.id, startedAt: "2026-11-16T08:00:00Z", logPath: "active.log" };
  const legacy = { ...start, id: "legacy", leaseId: null, logPath: "legacy.log" };
  const exit = { task: "T-100", event: "worker_exit", at: "2026-11-16T08:01:00Z", detail: "codex/rowan; code=1; timed_out=false; log=active.log" };
  const attempts = (records, events = []) => buildExecutionProjection(root, "T-100", { state, records, events, revisions: [], files: [] }).stages[0].attempts;
  assert.deepEqual(attempts([start, legacy]).map((a) => a.outcome), ["running", "unknown"]);
  const fromExit = attempts([legacy, start], [exit]);
  assert.deepEqual(fromExit.map((a) => a.outcome), ["unknown", "failed"]);
  assert.equal(fromExit[0].events.length, 0, "historical open records cannot claim another session's exit");
  assert.equal(fromExit[1].events[0].event, "worker_exit");
  assert.equal(attempts([start, { ...start, finishedAt: exit.at, exitCode: 1 }]).length, 1);
  releaseLease(root, lease);
  assert.equal(attempts([start])[0].outcome, "unknown");
}

// A planned task (no sessions, intake state) is labeled planned.
{
  const planned = emptyState();
  planned.tasks["T-200"] = { id: "T-200", title: "Planned task", status: "triaged" };
  const p = buildExecutionProjection(root, "T-200", { state: planned, records: [], events: [], revisions: [], files: [] });
  assert.equal(p.planned, true, "intake task without sessions is planned");
  assert.equal(p.unrun, true);
  assert.equal(p.stages.length, 0, "no stages are invented for unrun work");
}

// Sessions join by role into stages; evidence joins by session_id; windowed
// log events attach to the session attempt; outcomes come from exit codes.
{
  const records = [
    { id: "S1", taskId: "T-100", role: "rowan", provider: "codex", model: "gpt-5.3", startedAt: "2026-11-16T08:00:00Z", finishedAt: "2026-11-16T08:20:00Z", exitCode: 0, timedOut: false, statusBefore: "assigned", statusAfter: "in_progress", packetRevision: 2, logPath: ".trust/manager/logs/s1.log" },
    { id: "S2", taskId: "T-100", role: "planning", provider: "gapgpt", model: "glm-5.3", startedAt: "2026-11-16T07:00:00Z", finishedAt: "2026-11-16T07:10:00Z", exitCode: 1, timedOut: true, statusBefore: "triaged", statusAfter: "triaged", packetRevision: 1 },
    { id: "S3", taskId: "T-OTHER", role: "rowan", startedAt: "2026-11-16T06:00:00Z" },
  ];
  const events = [
    { at: "2026-11-16T06:30:00Z", task: "T-100", actor: "manager", event: "task_created", detail: "imported" },
    { at: "2026-11-16T06:31:00Z", task: "T-100", actor: "manager", event: "new -> triaged", detail: "triage note" },
    { at: "2026-11-16T08:05:00Z", task: "T-100", actor: "rowan", event: "worker_start", detail: "lease acquired" },
    { at: "2026-11-16T08:04:00Z", task: "T-100", actor: "manager", event: "assigned -> in_progress", detail: "run started" },
    { at: "2026-11-16T09:05:00Z", task: "T-100", actor: "manager", event: "resource_route", detail: "run config" },
    { at: "2026-11-16T10:00:00Z", task: "T-100", actor: "manager", event: "provider_quota_failover", detail: "route change" },
  ];
  const withEvidence = buildExecutionProjection(root, "T-100", {
    state: { ...state, tasks: { ...state.tasks, "T-100": { ...state.tasks["T-100"], evidence: [
      { kind: "check", check: "tests-pass", result: "pass", at: "2026-11-16T08:10:00Z", session_id: "S1", command: "npm test", exit_code: 0, coverage: "complete", code_revision: "abc", packet_revision: 2 },
      { kind: "note", detail: "operator note", at: "2026-11-16T08:30:00Z" },
    ] } } },
    records, events, revisions: [], files: [],
  });
  const byKey = new Map(withEvidence.stages.map((stage) => [stage.key, stage]));
  assert.deepEqual(Object.keys(Object.fromEntries(byKey)).sort(), ["implementation", "intake", "planning", "verification"], "only recorded stages appear");
  const planning = byKey.get("planning");
  assert.equal(planning.attempts.length, 1);
  assert.equal(planning.attempts[0].outcome, "failed", "timed-out session fails");
  const implementation = byKey.get("implementation");
  assert.equal(implementation.attempts.length, 1);
  const sessionAttempt = implementation.attempts[0];
  assert.equal(sessionAttempt.outcome, "complete");
  assert.equal(sessionAttempt.provider, "codex");
  assert.deepEqual(sessionAttempt.commands.map((command) => command.command), ["npm test"], "session evidence commands join");
  assert.equal(sessionAttempt.events.some((entry) => entry.event === "worker_start"), true, "in-window event joined to session");
  assert.equal(sessionAttempt.evidence.length, 1);
  assert.equal(sessionAttempt.log_path, ".trust/manager/logs/s1.log");
  // Unlinked note lands on verification; the transition event groups into a
  // recorded-events attempt; run configuration events stay out entirely.
  const verification = byKey.get("verification");
  assert.ok(verification, "unlinked evidence creates its stage");
  const groupedNames = implementation.attempts.filter((attempt) => attempt.kind === "events").flatMap((attempt) => attempt.events.map((entry) => entry.event));
  assert.equal(groupedNames.includes("resource_route"), false, "run configuration is not execution work");
  assert.equal(withEvidence.repository.name, "example-org-base");
  assert.deepEqual(withEvidence.repository.repositories, ["repo-1", "repo-2"]);
  assert.equal(withEvidence.checks.items[0].check, "tests-pass");
  assert.ok(withEvidence.graph.nodes.some((node) => node.kind === "check" && node.label.includes("tests-pass")));
  assert.ok(withEvidence.graph.edges.some((edge) => edge.provenance === "recorded" && edge.label === "session-linked evidence"), "check links only through its recorded session id");
}

// A zero exit code is not progress. When the worker starts and ends at the
// same status without recording session-linked evidence, the attempt must be
// labeled honestly instead of showing a green check.
{
  const records = [
    { id: "S4", taskId: "T-100", role: "rowan", provider: "codex", model: "gpt-6.2-sol", startedAt: "2026-11-18T08:00:00Z", finishedAt: "2026-11-18T08:01:00Z", exitCode: 0, statusBefore: "assigned", statusAfter: "assigned" },
  ];
  const projected = buildExecutionProjection(root, "T-100", { state, records, events: [], revisions: [], files: [] });
  const attempt = projected.stages.find((stage) => stage.key === "implementation")?.attempts[0];
  assert.equal(attempt?.outcome, "no-state-change", "exit 0 without a transition is not Complete");
  assert.equal(attempt?.status_before, "assigned");
  assert.equal(attempt?.status_after, "assigned");
}

// Failure summaries must never string lapse into "[object Object]": provider
// failures arrive as {kind, reason}, thrown errors as {message}, some records
// carry {summary} or a bare string. (Issue #87.)
{
  const records = [
    { id: "F1", taskId: "T-100", role: "rowan", startedAt: "2026-11-17T08:00:00Z", finishedAt: "2026-11-17T08:01:00Z", exitCode: 1, failure: { kind: "provider-quota", scope: "provider", retryAfterSeconds: 60, reason: "Provider reported a rate limit; ATL will try an eligible configured alternative." } },
    { id: "F2", taskId: "T-100", role: "mira", startedAt: "2026-11-17T09:00:00Z", finishedAt: "2026-11-17T09:01:00Z", exitCode: 1, failure: { summary: "Sage reviewed a stale revision" } },
    { id: "F3", taskId: "T-100", role: "sage", startedAt: "2026-11-17T10:00:00Z", finishedAt: "2026-11-17T10:01:00Z", failure: "Worker channel closed before handoff" },
    { id: "F4", taskId: "T-100", role: "beacon", startedAt: "2026-11-17T11:00:00Z", finishedAt: "2026-11-17T11:01:00Z", exitCode: 1, failure: { kind: "provider-crash", detail: { code: -9 } } },
  ];
  const projected = buildExecutionProjection(root, "T-100", { state, records, events: [], revisions: [], files: [] });
  const implementation = projected.stages.find((stage) => stage.key === "implementation");
  const bySession = new Map(implementation.attempts.filter((attempt) => attempt.kind === "session").map((attempt) => [attempt.session_id, attempt]));
  assert.equal(bySession.get("F1").failure.summary, "Provider reported a rate limit; ATL will try an eligible configured alternative.", "provider reason renders as the failure summary");
  assert.equal(bySession.get("F2").failure.summary, "Sage reviewed a stale revision", "summary-shaped failures keep their summary");
  assert.equal(bySession.get("F3").failure.summary, "Worker channel closed before handoff", "string failures pass through");
  assert.doesNotMatch(bySession.get("F4").failure.summary, /\[object Object\]/, "unknown object shape JSON-serializes instead of [object Object]");
  assert.match(bySession.get("F4").failure.summary, /provider-crash/);
  assert.equal(bySession.get("F1").summary, bySession.get("F1").failure.summary, "attempt summary mirrors the failure summary");
  for (const attempt of implementation.attempts) {
    assert.doesNotMatch(JSON.stringify(attempt.failure), /\[object Object\]/, "no failure field renders as [object Object]");
  }
}

// Repeated events collapse (first + last kept) to keep history scannable.
{
  const events = [];
  for (let index = 0; index < 8; index++) events.push({ at: `2026-11-16T0${index}:00:00Z`, task: "T-100", actor: "manager", event: "workspace", detail: `prep ${index}` });
  const collapsed = buildExecutionProjection(root, "T-100", { state, records: [], events, revisions: [], files: [] });
  const preparation = collapsed.stages.find((stage) => stage.key === "preparation");
  assert.ok(preparation, "workspace events group under preparation");
  assert.equal(preparation.attempts.length, 1);
  assert.equal(preparation.attempts[0].events.length, 2, "run of identical events keeps first and last");
  assert.match(preparation.attempts[0].events[0].detail, /8× workspace/);
}

// Capture files stay grouped under their capture; stage links are explicit
// packet-revision matches only.
{
  const revisions = [
    { id: "cap-2", captured_at: "2026-11-16T09:00:00Z", source_kind: "inspection", packet_revision: 2, output_revision: "rev-2" },
    { id: "cap-1", captured_at: "2026-11-16T07:00:00Z", source_kind: "handoff", packet_revision: 1, output_revision: "rev-1" },
  ];
  const files = [
    { id: "f1", path: "src/a.js", kind: "modified", capture_id: "cap-2" },
    { id: "f2", path: "src/b.js", kind: "added", capture_id: "cap-2" },
  ];
  const records = [{ id: "S1", taskId: "T-100", role: "rowan", packetRevision: 2, startedAt: "2026-11-16T08:00:00Z" }];
  const linkedState = { ...state, tasks: { ...state.tasks, "T-100": { ...state.tasks["T-100"], evidence: [{ kind: "check", check: "task-level", result: "pass", at: "2026-11-16T09:00:00Z" }] } } };
  const linked = buildExecutionProjection(root, "T-100", { state: linkedState, records, events: [], revisions, files });
  assert.equal(linked.files.length, 2);
  assert.equal(linked.captures.length, 2);
  const implementation = linked.stages.find((stage) => stage.key === "implementation");
  assert.deepEqual(implementation.capture_ids, ["cap-2"], "capture links to the stage whose session shares the packet revision");
  assert.ok(linked.graph.edges.some((edge) => edge.provenance === "inferred" && edge.label === "same packet revision"));
  assert.ok(linked.graph.edges.some((edge) => edge.provenance === "unknown" && edge.label === "file coverage not recorded"));
  const planningStage = linked.stages.find((stage) => stage.key === "planning");
  assert.equal(planningStage, undefined, "no session in planning, no invented link");
}

// ---- Unit: truncation flags ------------------------------------------------
{
  const events = [];
  const names = ["task_created", "task_repository_assigned", "task_repository_changed", "intake_repository_changed"];
  for (let index = 0; index < 80; index++) events.push({ at: `2026-11-16T00:${String(index % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`, task: "T-100", actor: "m", event: names[index % names.length], detail: `e${index}` });
  const big = buildExecutionProjection(root, "T-100", { state, records: [], events, revisions: [], files: [] });
  const intake = big.stages.find((stage) => stage.key === "intake");
  assert.equal(intake.attempts[0].events_truncated, true);
  assert.equal(intake.attempts[0].events.length, 60);
}

// ---- Endpoint: owner-session gate + live join ------------------------------
{
  const f = fixture(); f.edit();
  const live = loadState(f.root);
  const task = live.tasks["T-001"];
  logEvent(live, { task: "T-001", actor: "manager", event: "task_created", detail: "fixture" });
  logEvent(live, { task: "T-001", actor: "rowan", event: "worker_start", detail: "run" });
  addEvidence(live, "T-001", { kind: "check", check: "behavior", result: "pass", actor: "rowan", detail: "verified", command: "npm test", exit_code: 0, coverage: "complete", code_revision: "abc", packet_revision: 1 });
  recordExecution(f.root, { id: "SESS-1", taskId: "T-001", role: "rowan", provider: "codex", model: "x", startedAt: "2026-11-16T08:00:00Z", finishedAt: "2026-11-16T08:05:00Z", exitCode: 0, timedOut: false, statusBefore: "assigned", statusAfter: "in_progress", packetRevision: 1 });
  saveState(f.root, live);
  const running = await startControlPlaneServer(f.root);
  try {
    const page = await fetch(running.url), html = await page.text();
    const cookie = page.headers.get("set-cookie").split(";")[0], csrf = html.match(/name="atl-csrf" content="([^"]+)"/)[1];
    const headers = { cookie, "x-atl-csrf": csrf };
    const before = fs.readFileSync(path.join(f.root, ".trust/manager/state.json"), "utf8");
    assert.equal((await fetch(`${running.url}api/task-execution?taskId=T-001`)).status, 403, "projection requires the owner session even on GET");
    const projection = await (await fetch(`${running.url}api/task-execution?taskId=T-001`, { headers })).json();
    assert.equal(projection.availability, "available");
    assert.equal(projection.capability, "task-execution-projection-v1");
    assert.equal(projection.counts.sessions, 1);
    const implementation = projection.stages.find((stage) => stage.key === "implementation");
    assert.ok(implementation, "ledger session lands on implementation");
    assert.equal(implementation.attempts[0].session_id, "SESS-1");
    assert.equal(implementation.attempts[0].outcome, "complete");
    assert.equal((await fetch(`${running.url}api/task-execution?taskId=T-999`, { headers })).status, 404);
    assert.equal(fs.readFileSync(path.join(f.root, ".trust/manager/state.json"), "utf8"), before, "projection is read-only");
  } finally { await new Promise((resolve) => running.server.close(resolve)); f.cleanup(); }
}

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: execution projection — honest joins, stage mapping, truncation, owner-gated read-only endpoint");
