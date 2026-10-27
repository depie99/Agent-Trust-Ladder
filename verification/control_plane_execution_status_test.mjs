import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
import { emptyState, saveState } from '../runtime/lib/state.mjs';

// Exercise the real client projection and markup without starting providers.
const source = fs.readFileSync(new URL('../runtime/control-plane-client.js', import.meta.url), 'utf8');
const functions = ['statusLabel', 'badge', 'taskProgress', 'taskProgressMarkup', 'taskExecution', 'liveRunState', 'taskOutcome', 'taskDetail', 'syncRunSnapshot', 'refreshTaskDetail'];
const scope = vm.createContext({ currentRun: {}, snapshot: { queues: { items: [] } }, selectedTasks: new Set(),
  escapeHtml: (v) => String(v ?? ''), btn: (text) => text, meter: (value) => `<div class="track" data-value="${value}"></div>`, taskRowActions: () => '', lifecycleDiagram: () => '', popup: (_title, html) => { scope.detail = html; },
});
for (const name of functions) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  }', start) + 4;
  assert.ok(start >= 0 && end > start, `${name} exists`);
  vm.runInContext(source.slice(start, end), scope);
}
const rowStart = source.indexOf('  const taskRow =');
vm.runInContext(source.slice(rowStart, source.indexOf('\n', rowStart)) + '\nglobalThis.renderRow = taskRow;', scope);

// Acceptance percentages come from unique, current-revision gates. A retry
// is not additional completed work, and a stopped worker retains its proof.
const progressTask = { id: 'T-PROGRESS', status: 'in_progress', packet_revision: 2, review_required: true,
  completion_checks: ['syntax', 'behavior', 'syntax'], evidence: [] };
const check = (name, result, revision = 2) => ({ kind: 'check', check: name, result, packet_revision: revision });
const review = (result) => ({ kind: 'review', result, packet_revision: 2 });
assert.equal(scope.taskProgress(progressTask).percent, 0);
progressTask.evidence = [check('syntax', 'pass'), check('syntax', 'pass'), check('obsolete requirement', 'pass')];
let proof = scope.taskProgress(progressTask);
assert.equal(proof.percent, 25);
assert.equal(proof.total, 4, 'two unique checks plus required review and final completion');
assert.equal(proof.completed, 1, 'duplicate and unrelated evidence cannot inflate the numerator');
progressTask.evidence.push(check('behavior', 'pass'));
assert.equal(scope.taskProgress(progressTask).percent, 50);
progressTask.evidence.push(check('behavior', 'fail'));
assert.equal(scope.taskProgress(progressTask).percent, 25, 'the latest failure replaces an earlier pass');
progressTask.evidence.push(check('behavior', 'pass', 1));
assert.equal(scope.taskProgress(progressTask).percent, 25, 'old revision results cannot override the current revision');
progressTask.evidence.push(review('changes-requested'));
assert.equal(scope.taskProgress(progressTask).percent, 0, 'rejected evidence is no longer counted');
progressTask.evidence.push(check('syntax', 'pass'), check('behavior', 'pass'), review('approve'));
assert.equal(scope.taskProgress(progressTask).percent, 75, 'verification remains incomplete until Done');
progressTask.status = 'done';
assert.equal(scope.taskProgress(progressTask).percent, 100);
progressTask.packet_revision = 3;
assert.equal(scope.taskProgress(progressTask).percent, 25, 'a new revision invalidates check/review evidence; only the recorded Done gate remains');
assert.equal(scope.taskProgress({ status: 'new' }).percent, null, 'undefined criteria produce unknown, not invented progress');
assert.equal(scope.taskProgress({ ...progressTask, packet_revision: 2, status: 'blocked' }).percent, 75, 'a stopped or blocked worker does not erase accepted work');
assert.equal(scope.taskProgress({ status: 'in_progress', completion_checks: ['syntax'], evidence: [check('syntax', 'pass', 1)] }).percent, 50, 'review is counted only when required');
assert.match(scope.taskProgressMarkup({ ...progressTask, packet_revision: 2 }), /aria-valuenow="100"/);
assert.doesNotMatch(scope.taskProgressMarkup({ id: 'T-NEW', status: 'new' }), /aria-valuenow=/);

const task = { id: 'T-018', rawStatus: 'in_progress', status: 'Stopped', title: 'Catalog', logs: [], evidence: [], stage: 'Session budget exhausted. Resume to continue.' };
scope.currentRun = { status: 'stopped', taskIds: ['T-018'], results: [{ id: 'T-018', resumable: true, reason: 'task session budget reached; next role: rowan' }] };
assert.equal(scope.taskExecution(task).label, 'Stopped');
assert.match(scope.taskExecution(task).reason, /Session budget exhausted/);
assert.doesNotMatch(scope.renderRow(task), /running-mark|55%/);
scope.taskDetail(task);
assert.doesNotMatch(scope.detail, /Running now|running-mark|55%/);
assert.match(scope.detail, /Session budget exhausted/);
assert.match(scope.detail, /role="progressbar"/, 'the indicator remains visible even when execution is stopped');
scope.currentRun = { status: 'running', taskIds: ['T-018', 'T-019'], currentTaskId: 'T-018', results: [] };
assert.equal(scope.taskExecution(task).label, 'Running');
assert.equal(scope.taskExecution({ id: 'T-019', status: 'assigned' }).label, 'Queued');
assert.match(scope.renderRow(task), /running-mark/);
assert.equal(scope.liveRunState({ id: 'T-999' }), null);
scope.snapshot.leases = { sessions: [{ task: 'T-018', status: 'active', expires_at: Date.now() + 30000 }] };
assert.equal(scope.liveRunState(task), 'running');
scope.snapshot.leases.sessions[0].expires_at = Date.now() - 1;
assert.equal(scope.liveRunState(task), null, 'an expired worker lease cannot animate as running');
delete scope.snapshot.leases;
assert.equal(scope.taskExecution({ id: 'T-026', status: 'done' }).label, 'Done');
scope.currentRun = { status: 'interrupted', taskIds: ['T-018'], reason: 'runner interrupted' };
assert.equal(scope.taskExecution(task).label, 'Stopped');

scope.currentRun = { status: 'running', startedAt: '2026-10-27T05:00:00Z' };
scope.snapshot.overnight = { status: 'finished', startedAt: '2026-10-27T05:00:01Z', taskOrder: ['T-018'], resumableTaskIds: ['T-018'], results: [{ id: 'T-018', reason: 'task session budget reached' }] };
scope.syncRunSnapshot();
assert.equal(scope.currentRun.status, 'stopped', 'the current snapshot overrides an older server run cache');
assert.equal(scope.taskExecution(task).label, 'Stopped');
scope.currentRun = { status: 'running', startedAt: '2026-10-27T06:00:00Z', currentTaskId: 'T-019' };
scope.syncRunSnapshot();
assert.equal(scope.currentRun.currentTaskId, 'T-019', 'a previous-run snapshot cannot replace a new launch');

// An already-open detail view must settle when its worker stops too.
delete scope.snapshot.overnight;
scope.dialogOpen = true;
scope.currentRun = { status: 'running', currentTaskId: 'T-018', taskIds: ['T-018'], results: [] };
scope.derived = () => ({ tasks: [{ ...task, status: 'Running', stage: 'Worker is executing this task.' }] });
scope.$ = () => ({ scrollTop: 20 });
scope.document = { activeElement: null, querySelectorAll: () => [] };
scope.applyLocale = () => {};
scope.refreshTaskDetail();
assert.match(scope.detail, /Running now/);
scope.currentRun = { status: 'stopped', taskIds: ['T-018'], results: [] };
scope.derived = () => ({ tasks: [task] });
scope.refreshTaskDetail();
assert.doesNotMatch(scope.detail, /Running now|running-mark/);
assert.match(scope.detail, /Session budget exhausted/);
const evidenceTask = { ...task, completion_checks: ['syntax'], review_required: false, packet_revision: 1, evidence: [] };
scope.derived = () => ({ tasks: [evidenceTask] });
scope.refreshTaskDetail();
assert.match(scope.detail, /aria-valuenow="0"/);
evidenceTask.evidence.push(check('syntax', 'pass', 1));
scope.refreshTaskDetail();
assert.match(scope.detail, /aria-valuenow="50"/, 'new evidence refreshes the open details without a status change');
evidenceTask.block = 'Worker execution policy mismatch: effective read-only sandbox';
scope.refreshTaskDetail();
assert.match(scope.detail, /BLOCKER.*effective read-only sandbox/s, 'a changed blocker refreshes even when status, stage and percentage stay unchanged');
evidenceTask.logs = [{ event: 'execution-policy-diagnosis', detail: 'Specific cause replaces generic worker stall' }];
scope.refreshTaskDetail();
assert.match(scope.detail, /Specific cause replaces generic worker stall/, 'new task activity refreshes without a lifecycle change');
scope.currentRun = { status: 'idle' };
assert.equal(scope.taskExecution(task).label, 'Stopped');

const i18n = vm.createContext({ window: {}, TextDecoder, Uint8Array });
vm.runInContext(fs.readFileSync(new URL('../runtime/control-plane-i18n.js', import.meta.url), 'utf8'), i18n);
assert.equal(i18n.window.ATL_I18N.exact('Stopped', 'fa-IR'), 'متوقف شده');
assert.match(i18n.window.ATL_I18N.translateText('Stage: In progress · Stopped', 'fa-IR'), /متوقف شده/);
assert.equal(i18n.window.ATL_I18N.translateText('Acceptance progress · 1/4 gates', 'fa-IR'), 'پیشرفت معیارهای پذیرش · 1 از 4 معیار');

if (process.env.ATL_UI_URL) {
  const liveUrl = new URL(process.env.ATL_UI_URL);
  const live = await fetch(new URL('api/snapshot', liveUrl)).then((response) => response.json());
  const served = await fetch(new URL('control-plane-client.js', liveUrl)).then((response) => response.text());
  assert.equal(served, source, 'the live server serves the tested progress implementation');
  for (const id of ['T-018', 'T-026']) {
    const actual = live.state.tasks[id];
    if (!actual) continue;
    const progress = scope.taskProgress(actual);
    const markup = scope.taskProgressMarkup(actual, true);
    if (progress.percent !== null) assert.match(markup, new RegExp(`aria-valuenow="${progress.percent}"`));
    console.log(`${id}: status=${actual.status}; acceptance=${progress.percent ?? 'unknown'}%; gates=${progress.completed}/${progress.total}; checks=${progress.passed}/${progress.checks.length}; review=${progress.reviewPassed ? 'approved' : 'pending'}`);
  }
}

// A server already open must observe later CLI runs, not its startup cache.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-execution-status-'));
saveState(root, emptyState());
const running = await startControlPlaneServer(root);
const ledger = path.join(root, '.trust/manager/overnight/run.json');
fs.mkdirSync(path.dirname(ledger), { recursive: true });
try {
  const write = (data) => fs.writeFileSync(ledger, JSON.stringify(data));
  write({ status: 'running', runnerPid: process.pid, taskOrder: ['T-018', 'T-019'], currentTaskId: 'T-018', results: [] });
  let run = await fetch(`${running.url}api/run`).then((r) => r.json());
  assert.equal(run.status, 'running');
  assert.equal(run.currentTaskId, 'T-018');
  write({ status: 'finished', taskOrder: ['T-018', 'T-019'], resumableTaskIds: ['T-018'], results: [{ id: 'T-018', resumable: true, reason: 'task session budget reached' }] });
  run = await fetch(`${running.url}api/run`).then((r) => r.json());
  assert.equal(run.status, 'stopped');
  assert.equal(run.currentTaskId, null);
  assert.equal(run.results[0].reason, 'task session budget reached');
  write({ status: 'running', runnerPid: 2147483647, taskOrder: ['T-018'], currentTaskId: 'T-018', cursor: 0 });
  run = await fetch(`${running.url}api/run`).then((r) => r.json());
  assert.equal(run.status, 'interrupted');
  assert.equal(run.currentTaskId, null);
} finally {
  await new Promise((resolve) => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('PASS: execution status, stopped rendering, Persian labels, live task identity, and durable run polling');
