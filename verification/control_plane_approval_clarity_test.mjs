import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../runtime/control-plane-client.js', import.meta.url), 'utf8');
const decisions = [];
const resumed = [];
const pending = { id: 'AP-task', status: 'pending', digest: 'fingerprint-task', created_at: '2026-10-27T06:00:00Z',
  action: { operation: 'run.queue', project: 'D:/Projects/ATL', target: 'selected', args: { taskIds: ['T-018'] } } };
const queueRequest = { ...pending, id: 'AP-queue', action: { ...pending.action, target: 'persian', args: {} } };
const scope = vm.createContext({
  pendingApprovalAction: null,
  snapshot: { state: { tasks: { 'T-018': { id: 'T-018', title: 'Build Persian catalog', status: 'blocked' },
    'T-019': { id: 'T-019', title: 'Wire <unsafe> client strings', status: 'assigned' } } },
    queues: { items: [{ id: 'persian', name: 'Persian localization', items: [{ id: 'T-018' }, { id: 'T-019' }] }] },
    approvals: { proposals: [pending, queueRequest], grants: [] } },
  btn: (label, action) => `<button data-action="${action}">${label}</button>`,
  head: (_eyebrow, title, description) => `<h1>${title}</h1><p>${description}</p>`,
  stat: (label, count, detail) => `<b>${label}: ${count}</b><span>${detail}</span>`,
  popup: (title, html) => { scope.dialog = { title, html }; },
  fetch: async (_url, init) => { decisions.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true }) }; },
  close: () => {}, refresh: async () => {}, render: () => {}, applyLocale: () => {}, action: async (command) => resumed.push(command),
});
const escapeLine = source.split('\n').find((line) => line.startsWith('  const escapeHtml ='));
vm.runInContext(escapeLine, scope);
for (const name of ['statusLabel', 'badge', 'approvalSummary', 'approvalCard', 'approvalCenter', 'showRunApproval', 'applyApprovalDecision']) {
  let start = source.indexOf(`  function ${name}(`);
  if (start < 0) start = source.indexOf(`  async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  vm.runInContext(source.slice(start, source.indexOf('\n  }', start) + 4), scope);
}

let card = scope.approvalCard(pending);
assert.match(card, /Build Persian catalog/);
assert.match(card, /D:\/Projects\/ATL/);
assert.match(card, /does not start a run from this page/);
assert.doesNotMatch(card.split('<details>')[0], /fingerprint-task|run\.queue/);
assert.match(card, /<summary>Technical details<\/summary>/);
assert.match(card, /Run result not recorded/);
scope.showRunApproval(pending, 'run-task-confirm:T-018');
card = scope.approvalCard(pending);
assert.match(card, /Approve and start this run/);
assert.match(card, /starts this waiting run immediately/);
assert.match(scope.approvalCard(queueRequest), /Approve once/);
assert.doesNotMatch(scope.approvalCard(queueRequest), /Approve and start this run/);
const queueCard = scope.approvalCard(queueRequest);
assert.match(queueCard, /Persian localization/);
assert.match(queueCard, /Current queue contents/);
assert.match(queueCard, /Wire &lt;unsafe&gt; client strings/);
assert.doesNotMatch(queueCard, /<unsafe>/);

// Approving another request must never start the currently waiting task.
await scope.applyApprovalDecision('AP-queue', true);
assert.equal(resumed.length, 0);
assert.equal(scope.pendingApprovalAction.proposalId, 'AP-task');
await scope.applyApprovalDecision('AP-task', false);
assert.equal(resumed.length, 0, 'denial never resumes execution');
assert.equal(scope.pendingApprovalAction, null);
assert.equal(decisions.at(-1).decision, 'deny');
scope.showRunApproval(pending, 'run-task-confirm:T-018');
await scope.applyApprovalDecision('AP-task', true);
assert.deepEqual(resumed, ['run-task-confirm:T-018']);
assert.equal(scope.pendingApprovalAction, null);

const approved = { ...pending, status: 'approved', execution: { status: 'unknown', reason: 'queue run complete' } };
const grant = { id: 'AG-one', proposal_id: approved.id, expires_at: new Date(Date.now() + 60000).toISOString() };
scope.snapshot.approvals = { proposals: [approved, queueRequest], grants: [grant] };
assert.equal(scope.approvalSummary(approved).permission, 'Available once');
assert.match(scope.approvalCard(approved), /Revoke unused permission/);
grant.used_at = new Date().toISOString();
assert.equal(scope.approvalSummary(approved).permission, 'Used');
card = scope.approvalCard(approved).split('<details>')[0];
assert.match(card, /does not confirm that the tasks finished/);
assert.match(card, /Run result not recorded/);
assert.doesNotMatch(card, /queue run complete|Revoke unused permission/);
delete grant.used_at;
grant.expires_at = new Date(Date.now() - 1000).toISOString();
assert.equal(scope.approvalSummary(approved).permission, 'Expired');
grant.expires_at = 'invalid';
assert.equal(scope.approvalSummary(approved).permission, 'Expired');
grant.revoked_at = new Date().toISOString();
assert.equal(scope.approvalSummary(approved).permission, 'Revoked');
assert.equal(scope.approvalSummary({ ...pending, status: 'denied' }).permission, 'Denied');
assert.equal(scope.approvalSummary({ ...pending, action: { operation: 'other' } }).unknownScope, true);
const center = scope.approvalCenter();
assert.ok(center.indexOf('data-approval="AP-queue"') < center.indexOf('data-approval="AP-task"'), 'pending requests appear before history');
assert.match(center, /Approval is permission/);

// The multi-queue branch must show the approval, not assume a run started.
const multiStart = source.indexOf('    if (value.startsWith("run-start-multi:"))');
const multiEnd = source.indexOf('\n    if (value.startsWith("task-budget:"))', multiStart);
assert.ok(multiStart >= 0 && multiEnd > multiStart, 'multi-queue action boundaries exist');
vm.runInContext(`async function testMulti(value) { ${source.slice(multiStart, multiEnd)} }`, scope);
scope.fetch = async () => ({ ok: true, json: async () => ({ approvalRequired: true, proposal: queueRequest }) });
await scope.testMulti(`run-start-multi:${encodeURIComponent(JSON.stringify(['persian']))}`);
assert.equal(scope.pendingApprovalAction.proposalId, 'AP-queue');
assert.match(scope.dialog.html, /Persian localization/);

const resumeCount = resumed.length;
scope.fetch = async () => ({ ok: false, json: async () => ({ error: 'request is no longer pending' }) });
await scope.applyApprovalDecision('AP-queue', true);
assert.equal(resumed.length, resumeCount, 'a rejected approval response cannot start a run');
assert.equal(scope.pendingApprovalAction.proposalId, 'AP-queue', 'failed decisions preserve the waiting request for inspection');
assert.match(scope.dialog.html, /request is no longer pending/);

const i18n = vm.createContext({ window: {}, TextDecoder, Uint8Array });
vm.runInContext(fs.readFileSync(new URL('../runtime/control-plane-i18n.js', import.meta.url), 'utf8'), i18n);
for (const label of ['Approve and start this run', 'Needs your decision', 'Run result not recorded', 'Expired', 'Used', 'How this works']) {
  assert.match(i18n.window.ATL_I18N.exact(label, 'fa-IR'), /[\u0600-\u06ff]/, `${label} is localized`);
}
console.log('PASS: approval scope, effects, permission/operation distinction, lifecycle, matching continuation, multi-queue gate, and Persian labels');
