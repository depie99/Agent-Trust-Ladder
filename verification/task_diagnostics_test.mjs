import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, createTask, transition, saveState, loadState } from "../runtime/lib/state.mjs";
import { taskRecoveryReport, taskLogTails, stalledTaskFailure, workerStallFailure, taskBlockerDetail, packageFailureGuidance } from "../runtime/lib/task-diagnostics.mjs";
import { renderTask } from "../runtime/lib/render.mjs";
import { buildInvocation } from "../runtime/lib/worker.mjs";
import { recoverPreparedTasks, stalledHandoffFailure, executeLaunchQueue } from "../runtime/lib/launch.mjs";
import { recordBlocker } from "../runtime/lib/queue-recovery.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-diagnostics-"));
try {
  const state = emptyState();
  const task = createTask(state, { title: "Rendered mixed-direction regression" });
  task.completion_checks = ["CSS and rendered Farsi path order"];
  task.status = "verifying";
  task.evidence = [{ kind: "check", check: task.completion_checks[0], result: "pass" }, { kind: "check", check: task.completion_checks[0], result: "fail" }];
  assert.match(renderTask(task), /\[FAIL\]/);
  assert.doesNotMatch(renderTask(task), /\[PASS\]/);
  assert.throws(() => transition(state, task.id, "done", { actor: "beacon" }), /no passing evidence/);
  task.evidence.push({ kind: "check", check: task.completion_checks[0], result: "pass", invalidated: true });
  assert.match(renderTask(task), /\[FAIL\]/);
  task.evidence.push({ kind: "review", result: "approve" }, { kind: "review", result: "changes-requested", detail: "Rendered Farsi evidence NOT OBSERVED; /api/snapshot HTTP 500 because state.json is missing. Scope includes unrelated files. T-024 owns rendered review." });
  task.status = "in_review";
  assert.throws(() => transition(state, task.id, "verifying", { actor: "sage" }), /approved review/);
  task.status = "blocked";
  task.assigned_worker = "rowan";
  task.workspace = root;
  task.execution_budget = { used: 12, max_sessions: 23 };
  task.recovery = { status: "exhausted" };
  const report = taskRecoveryReport(task, { "T-024": { id: "T-024", plan_depends_on: [task.id], objective: "Final UI review" } });
  for (const cause of ["verification-failed", "rendered-evidence", "preview-environment", "review-changes", "contract-ownership", "repair-exhausted"]) assert.ok(report.issues.some((issue) => issue.cause === cause), cause);
  assert.equal(report.neighbors[0].id, "T-024");
  const ownership = report.issues.find((issue) => issue.cause === "contract-ownership");
  assert.equal(ownership.owner, "rowan", "missing predecessor behavior is routed to the builder");
  assert.match(ownership.next_action, /Restore missing required behavior in this task workspace/);
  const dependencyReport = taskRecoveryReport({ id: "T-099", completion_checks: [], blocker: { cause: "local-dependencies", reason: "Missing matching dependency receipt" } });
  assert.equal(dependencyReport.issues[0].cause, "local-dependencies");
  assert.match(dependencyReport.next_action, /runtime's offline dependency preparation/);
  assert.equal(taskRecoveryReport({ id: "T-099", completion_checks: [], blocker: { cause: "local-dependencies" }, recovery: { status: "resolved" } }).issues.length, 0, "resolved dependency blockers are not revived by diagnosis");
  const before = { ...task, evidence: [] };
  const failure = stalledTaskFailure(before, task);
  assert.equal(failure.cause, "verification-required");
  assert.equal(failure.recovery_owner, "rowan", "verification gaps stay assigned to the builder rather than an owner approval queue");
  assert.equal(stalledTaskFailure(task, task), null, "old evidence does not impersonate a new session result");
  recordBlocker(task, failure);
  recordBlocker(task, { ...failure, reason: "same missing observation, different wording" });
  assert.equal(task.recovery_records.length, 1, "wording changes do not reset this failure's identity");
  saveState(root, state);
  await recoverPreparedTasks(root, [task.id]);
  assert.equal(loadState(root).tasks[task.id].status, "blocked");
  assert.equal(loadState(root).tasks[task.id].recovery.attempts.length, 0, "input readiness is not a verification repair");
  assert.equal(loadState(root).tasks[task.id].execution_budget.used, 12);
  recordBlocker(task, { cause: "execution", reason: "worker did not advance" });
  // recoverPreparedTasks saved while this object was held; a stale writer must
  // reload instead of overwriting (issue #31 revision discipline).
  const resumed = loadState(root);
  Object.assign(resumed.tasks[task.id], task);
  saveState(root, resumed);
  await recoverPreparedTasks(root, [task.id]);
  assert.equal(loadState(root).tasks[task.id].recovery.attempts.length, 0, "unknown execution stalls need diagnosis, not generic preparation");
  task.pip_repair_request = { objective: "Repair metadata" };
  const rowanPrompt = buildInvocation("codex", { root, role: "rowan", task }).prompt;
  assert.doesNotMatch(rowanPrompt, /Mira requests one Pip contract repair/);
  assert.match(rowanPrompt, /If the input itself lacks the required behavior, implement the minimum missing behavior here/);
  assert.match(rowanPrompt, /Block only after a bounded repair attempt/);
  assert.match(buildInvocation("codex", { root, role: "pip", task }).prompt, /Mira requests one Pip contract repair/);
  assert.equal(stalledHandoffFailure("error: Worker channel cannot impersonate another actor.\n").cause, "worker-credential");
  const logs = path.join(root, ".trust/manager/overnight", task.id); fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, "session-01-rowan-123.log"), "x".repeat(10000) + "\napi_key=private-value\nactual failure");
  const tails = taskLogTails(root, task.id);
  assert.equal(tails[0].truncated, true);
  assert.ok(tails[0].tail.length <= 6000);
  assert.match(tails[0].tail, /actual failure/);
  assert.doesNotMatch(tails[0].tail, /private-value/);
  assert.deepEqual(taskLogTails(root, "../escape"), []);
  // Re-base the held state on the current revision before mutating again:
  // external saves advanced the disk while this object was held (#31).
  const rebased = loadState(root);
  state.tasks = rebased.tasks; state.seq = rebased.seq; state.revision = rebased.revision; state.log = rebased.log;
  const stalled = createTask(state, { title: "Actual worker records failure without advancing" });
  stalled.status = "assigned"; stalled.assigned_worker = "rowan"; stalled.workspace = root;
  stalled.completion_checks = ["Required observation"];
  saveState(root, state);
  const fixture = path.join(root, "stalled-worker.mjs");
  fs.writeFileSync(fixture, `import {spawnSync} from 'node:child_process'; const r=spawnSync(process.execPath,[process.env.ATL_BIN,'update',process.argv[2],'--actor','rowan','--evidence-fail','Required observation','--note','Rendered Farsi evidence NOT OBSERVED; isolated preview state.json missing'],{env:process.env,encoding:'utf8'}); process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); process.exit(r.status ?? 1);`);
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config/manager.json"), JSON.stringify({ providers: { default: "fixture", catalog: { fixture: { command: process.execPath, args: [fixture, "{task}"] } } } }));
  const run = await executeLaunchQueue(root, { taskIds: [stalled.id], confirm: true, maxSessions: 3, maxMinutes: 1, onProgress: () => {} });
  assert.equal(run.budget.sessions, 1, `an actual recorded verification failure consumes only one session: ${JSON.stringify(run.results)}`);
  const persisted = loadState(root).tasks[stalled.id];
  assert.equal(persisted.recovery.cause, "verification-required");
  assert.equal(persisted.recovery.attempts.length, 0);
  assert.match(persisted.blocker.reason, /rendered-evidence/);
  // A worker that exits without advancing must not reduce its diagnosis to
  // "inspect the log and feed": the session record already holds the cause.
  const diagnosisRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-stall-diagnosis-"));
  try {
    const sessionDir = path.join(diagnosisRoot, ".trust/manager/overnight/T-090");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "session-01-rowan-123.json"), JSON.stringify({
      provider: "codex", model: "gpt-6.2-sol", statusBefore: "assigned", statusAfter: "assigned",
      providerFailure: { kind: "provider-model-unavailable", scope: "model", reason: "The selected model is not available to this provider CLI or login. Re-run with a model the installed CLI supports (for a Codex ChatGPT sign-in: gpt-5.6-terra), or update the provider CLI." },
    }));
    fs.writeFileSync(path.join(sessionDir, "session-01-rowan-123.log"), "ERROR: model_not_found\napi_key=secret-should-not-persist\n");
    const diagnosed = workerStallFailure(diagnosisRoot, "T-090", "", "assigned");
    assert.equal(diagnosed.cause, "provider-model-unavailable");
    assert.equal(diagnosed.recovery_owner, "owner");
    assert.match(diagnosed.detail, /gpt-5\.6-terra/);
    assert.equal(diagnosed.next_actions.find((action) => action.kind === "provider-model").model, "gpt-5.6-terra");
    assert.equal(diagnosed.next_actions.find((action) => action.kind === "provider-install").command, "npm install --global @openai/codex@0.169.0");
    assert.doesNotMatch(JSON.stringify(diagnosed), /secret-should-not-persist/);
    const blockedTask = { id: "T-090", status: "blocked", cause: "execution", reason: "worker did not advance T-090 from assigned; inspect the log and feed", blocker: { cause: "execution", reason: "worker did not advance T-090 from assigned; inspect the log and feed" } };
    assert.equal(taskBlockerDetail(diagnosisRoot, blockedTask).source, "session-log");
    const record = recordBlocker(blockedTask, diagnosed);
    assert.equal(blockedTask.blocker.detail, diagnosed.detail);
    assert.equal(blockedTask.blocker.next_actions[0].kind, "provider-model");
    assert.equal(taskBlockerDetail(diagnosisRoot, blockedTask).source, "blocker");
    recordBlocker(blockedTask, { ...diagnosed, reason: "different wording, same cause" });
    assert.equal(blockedTask.recovery_records.length, 1, "diagnosis detail does not change blocker identity");
    fs.writeFileSync(path.join(sessionDir, "session-02-rowan-456.json"), JSON.stringify({ statusBefore: "assigned", statusAfter: "assigned", providerFailure: null }));
    fs.writeFileSync(path.join(sessionDir, "session-02-rowan-456.log"), "every command execution is auto-denied (\"no approval surface\")\n");
    const denied = workerStallFailure(diagnosisRoot, "T-090", "no approval surface", "assigned");
    assert.equal(denied.cause, "runner-tool-policy");
    assert.match(denied.detail, /stayed assigned/);
    assert.ok(denied.next_actions.some((action) => action.kind === "inspect-log"));
    assert.match(packageFailureGuidance("Locked dependencies are not prepared", diagnosisRoot).next_actions[0].command, /^npm ci --offline/);
  } finally { fs.rmSync(diagnosisRoot, { recursive: true, force: true }); }
  console.log("PASS: recorded blocker diagnosis, no false repairs, scoped roles, latest evidence, bounded logs and structured stall detail");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
