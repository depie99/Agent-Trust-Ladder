import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { registerProject, removeProject } from '../runtime/lib/supervisor.mjs';
import { emptyState, loadState, saveState } from '../runtime/lib/state.mjs';
import { loadPlanDraft } from '../runtime/lib/plan-studio.mjs';
import { loadQueueBook } from '../runtime/lib/queue.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-import-revise-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-import-revise-home-'));
const oldEnv = Object.fromEntries(['USERPROFILE', 'HOME', 'AZDO_PAT'].map(key => [key, process.env[key]]));
Object.assign(process.env, { USERPROFILE: home, HOME: home, AZDO_PAT: 'synthetic' });
const evidence = path.resolve('.atl-evidence/import-plan-revision');
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(path.join(home, '.atl'), { recursive: true });
fs.writeFileSync(path.join(home, '.atl/providers.json'), JSON.stringify({ providers: { test: { id: 'test', worker: 'openai-http', protocol: 'openai', model: 'fixture', base_url: 'https://example.invalid/v1', api_key: 'synthetic' } } }));
fs.mkdirSync(path.join(root, 'config'));
fs.writeFileSync(path.join(root, 'config/manager.json'), JSON.stringify({ version: 1, intake: { azure: { enabled: true, org_url: 'https://example.invalid/Collection', project: 'Demo', token_env: 'AZDO_PAT' } } }));
fs.writeFileSync(path.join(root, 'app.js'), '// cart fixture');
saveState(root, emptyState());
execFileSync('git', ['init', '-q'], { cwd: root });
const repository = registerProject(root, { name: 'Cart fixture' });
const card = (id) => ({ id, title: `Cart task ${id}`, objective: `Repair cart ${id}`, instructions: `Repair cart behavior for ${id} within app.js and preserve existing interactions.`, requirement_ids: ['r1'], deliverables: [`Cart output ${id}`], completion_checks: ['Cart items remain visible'], selected_skills: ['atl-implement'], skill_reasons: { 'atl-implement': 'Implement the bounded cart repair.' }, proposed_worker: 'pip', depends_on: id === 'p2' ? ['p1'] : [], files: ['app.js'], verify: 'node --check app.js' });
const plan = intent => ({ plan_contract_version: 2, title: 'Imported cart repair', objective: intent, requirements: [{ id: 'r1', text: 'Cart items remain visible', source: 'imported request' }], constraints: [], observed_evidence: [{ path: 'app.js', description: 'Cart source exists' }], assumptions: [], open_questions: [], risks: [], completion_checks: ['Cart items remain visible'], acceptance_examples: [{ given: 'a cart', when: 'logging in', then: 'items remain visible' }], selected_skills: ['atl-implement'], proposed_worker: 'pip', implementation_steps: [{ step: 'Repair cart', files: ['app.js'], verify: 'node --check app.js' }], verifier_commands: ['node --check app.js'], task_proposals: [card('p1'), card('p2')] });
let browser, server, draftId, remoteReads = 0, remoteRevision = 3, failRegeneration = true;
const errors = [];
try {
  const running = await startControlPlaneServer(root, {
    intakeAdapters: { azure: async () => [{ title: 'Bug 741: سبد خرید پس از ورود', objective_hint: 'Cart items must remain visible after login.', completion_checks: [], priority: 'normal', risk: 'normal', labels: [], source: { type: 'azure', remote_id: 741, revision: 3, url: 'https://example.invalid/Collection/Demo/_workitems/edit/741' }, intake_key: 'azure:741:3' }] },
    publishFetch: async () => { remoteReads++; return { ok: true, status: 200, text: async () => JSON.stringify({ id: 741, rev: remoteRevision }) }; },
    planningInvoke: async ({ request }) => {
      if (request.current_proposal) {
        if (failRegeneration) return { code: 1, text: 'synthetic provider failure' };
        assert.match(JSON.stringify(request.feedback), /Preserve quantities/);
        return { code: 0, text: JSON.stringify({ ...request.current_proposal, title: 'Revised cart merge', instructions: 'Preserve quantities when merging guest cart lines into the authenticated cart in app.js.', deliverables: ['Quantity-preserving cart merge'], skill_reasons: { 'atl-implement': 'Implement the quantity-preserving merge rule.' } }) };
      }
      return { code: 0, text: JSON.stringify(request.review ? { verdict: 'passed', findings: [] } : plan(request.intent)) };
    },
  });
  server = running.server;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  const click = action => page.locator(`[data-action="${action}"]:visible`).first().click();
  await page.goto(running.url);
  await page.goto(new URL("?page=sources", page.url()).href);
  // The V2 sources page requires an access check before its Browse action is
  // available for a newly saved connection.
  const azureConnection = page.locator('.source-connection-card').first();
  await azureConnection.locator('[data-action^="sources-check:"]:visible').click();
  await azureConnection.locator('[data-action^="sources-browse:"]').waitFor();
  await azureConnection.locator('[data-action^="sources-browse:"]').click();
  await page.locator('[data-action="sources-preview-selected"]').click();
  await page.getByText('1 issue(s) found. No task was created.').waitFor();
  assert.equal(Object.keys(loadState(root).tasks).length, 0);
  await page.locator('details.source-import-options').evaluate(node => { node.open = true; });
  await page.locator('label.source-repo-pill').filter({ hasText: 'Cart fixture' }).click();
  assert.equal(await page.locator(`[data-import-repository][value="${repository.id}"]`).isChecked(), true);
  await click('sources-import');
  await page.getByRole('region', { name: 'Import result' }).getByText(/1 request created/).waitFor();
  await page.locator('[data-import-request="T-001"] [data-action^="plan:"]').click();
  assert.match(await page.locator('#goal').inputValue(), /Cart items must remain visible/);
  await page.locator('.studio-settings > summary').click();
  await page.getByRole('button', { name: 'Generate with model', exact: true }).click();
  const generated = page.waitForResponse(response => response.url().endsWith('/api/plan/generate'));
  await click('generate');
  draftId = (await (await generated).json()).draft.id;
  await page.getByText('Model plan ready', { exact: false }).waitFor();
  assert.equal(Object.keys(loadState(root).tasks).length, 1, 'planning creates no executable tasks');
  await page.locator('.planpane-tabs [data-action="studio-plantab:review"]').click();
  assert.equal(await page.locator(`[data-action="plan-queue:${draftId}"]`).isDisabled(), true);
  remoteRevision = 4;
  await click(`plan-review:${draftId}`);
  await page.locator('[data-stale-source]').waitFor();
  const recoveryPosition = await page.evaluate(() => {
    const notice = document.querySelector('[data-stale-source]')?.getBoundingClientRect();
    const pane = document.querySelector('.studio-conversation')?.getBoundingClientRect();
    const error = [...document.querySelectorAll('#content [role="status"]')].find(el => el.textContent.includes('changed since intake'))?.getBoundingClientRect();
    return { noticeTop: notice?.top, errorBottom: error?.bottom, pane, noticeInPane: notice && pane && notice.top >= pane.top && notice.bottom <= pane.bottom, errorInPane: error && pane && error.left >= pane.left && error.right <= pane.right };
  });
  assert.ok(recoveryPosition.noticeInPane && Boolean(recoveryPosition.errorBottom), `refresh action follows the error inside the conversation pane: ${JSON.stringify(recoveryPosition)}`);
  await page.screenshot({ path: path.join(evidence, 'stale-source-recovery.png'), fullPage: true });
  await click('plan-source-refresh-confirm:T-001');
  await page.getByText('Refresh imported Azure request?', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(loadState(root).tasks['T-001'].source.revision, 3, 'cancel does not alter imported evidence');
  remoteRevision = 3;
  await click(`plan-review:${draftId}`);
  await page.getByRole('region', { name: 'Plan review' }).getByText('Accuracy review passed', { exact: false }).waitFor();
  const sibling = structuredClone(loadPlanDraft(root, draftId).artifact.task_proposals[1]);
  await page.locator('.planpane-tabs [data-action="studio-plantab:tasks"]').click();
  // Task cards start collapsed in the 2026-11 redesign; expand p1 to edit it.
  await click('tc-toggle:p1');
  await click('card-edit:p1');
  await page.locator('[data-pfield="title"]').fill('Manual cart correction');
  await click('card-save:p1');
  await page.getByText(/Card p1 confirmed/).waitFor();
  assert.equal(loadPlanDraft(root, draftId).review?.verdict === 'passed', false, 'editing invalidates the old review');
  await page.locator('.planpane-tabs [data-action="studio-plantab:review"]').click();
  assert.equal(await page.locator(`[data-action="plan-queue:${draftId}"]`).isDisabled(), true);
  await page.locator('.planpane-tabs [data-action="studio-plantab:tasks"]').click();
  await click('card-edit:p1');
  await page.locator('[data-pfield="feedback"]').fill('Preserve quantities when merging carts.');
  await click('card-regen:p1');
  await page.getByText(/the card is unchanged and your form stays open/).waitFor();
  assert.equal(await page.locator('[data-pfield="feedback"]').inputValue(), 'Preserve quantities when merging carts.');
  assert.equal(loadPlanDraft(root, draftId).artifact.task_proposals[0].title, 'Manual cart correction');
  failRegeneration = false;
  await click('card-regen:p1');
  await page.getByText(/Card p1 regenerated/).waitFor();
  const revised = loadPlanDraft(root, draftId).artifact;
  assert.match(revised.task_proposals[0].instructions, /Preserve quantities/);
  assert.deepEqual(revised.task_proposals[0].deliverables, ['Quantity-preserving cart merge']);
  assert.match(revised.task_proposals[0].skill_reasons['atl-implement'], /quantity-preserving/);
  assert.deepEqual(revised.task_proposals[1], sibling, 'partial regeneration leaves the sibling unchanged');
  await page.reload();
  await page.locator('[data-page="studio"]:visible').first().click();
  await page.locator('[data-saved-plans] summary').click();
  await click(`plan-load:${draftId}`);
  await click('tc-toggle:p1');
  await page.getByText('Revised cart merge', { exact: true }).waitFor();
  await page.locator('.planpane-tabs [data-action="studio-plantab:review"]').click();
  await click(`plan-review:${draftId}`);
  await page.getByRole('region', { name: 'Plan review' }).getByText('Accuracy review passed', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'revised-plan-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('body').evaluate(node => node.scrollWidth <= node.clientWidth + 2), 'revised plan fits mobile');
  await page.screenshot({ path: path.join(evidence, 'revised-plan-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  remoteRevision = 4;
  // Approval runs from the studio review tab; the stale source must refuse it.
  await page.locator('.planpane-tabs [data-action="studio-plantab:review"]').click();
  await page.locator(`[data-action="plan-queue:${draftId}"]`).first().click();
  await page.getByText('Plan approval failed', { exact: true }).waitFor();
  assert.equal(Object.keys(loadState(root).tasks).length, 1, 'stale source approval creates no tasks');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  remoteRevision = 3;
  await page.locator(`[data-action="plan-queue:${draftId}"]`).first().click();
  await page.getByText('Plan approved — Plan Queue created', { exact: true }).waitFor();
  const approvedTasks = Object.values(loadState(root).tasks).filter(task => task.plan_draft_id === draftId);
  assert.equal(approvedTasks.length, 2);
  assert.ok(approvedTasks.every(task => task.source_task_id === 'T-001' && task.source_origin?.type === 'azure' && task.source_origin.remote_id === 741), 'executable tasks preserve their original Azure work item independently of the plan source');
  assert.match(approvedTasks.find(task => task.plan_proposal_id === 'p1').instructions || approvedTasks.find(task => task.plan_proposal_id === 'p1').dispatch_contract?.instructions || '', /Preserve quantities/);
  assert.equal(loadQueueBook(root).queues[approvedTasks[0].plan_queue_id].items.length, 2);
  assert.ok(approvedTasks.every(task => task.status !== 'in_progress'));
  assert.ok(remoteReads >= 4, 'review and source-page approval check remote revisions');
  assert.deepEqual(errors, []);
  console.log('PASS: browser Azure import → plan → review → manual edit → failed regenerate/retry → partial revision → reload → review → stale source refusal → studio review-tab approve → two queued tasks; desktop/mobile, no page errors');
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  removeProject(repository.id);
  for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
