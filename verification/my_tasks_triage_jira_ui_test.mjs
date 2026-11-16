import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
import { writeMyTasksStore, emptyMyTasksStore } from '../runtime/lib/my-tasks.mjs';
import { createTaskTriage } from '../runtime/lib/task-triage.mjs';
import { ensureOwnerSession } from '../runtime/lib/session-auth.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-mixed-triage-ui-'));
const oldHome = process.env.ATL_HOME; process.env.ATL_HOME = path.join(root, 'home');
fs.mkdirSync(path.join(root, 'config'), { recursive: true }); fs.writeFileSync(path.join(root, 'config/manager.json'), '{}');
const azure = { key: 'azure|fixture|1', source: 'azure', connection: 'https://azure.invalid/collection', project: 'AzureProject', id: 1, rev: 1, title: 'Azure checkout outage', priority: 1, source_priority: { rank: 1, label: 'P1' }, state: 'Active', state_category: 'inprogress', description_text: 'Checkout unavailable', changed_at: '2026-11-13T10:00:00Z', url: 'https://azure.invalid/collection/_workitems/edit/1', tags: [] };
const store = emptyMyTasksStore(); store.records[azure.key] = azure; writeMyTasksStore(root, store);
let revision = '2026-11-13T10:00:00Z', writes = 0;
const site = { id: 'fixture-cloud', name: 'Fixture Jira', url: 'https://fixture.atlassian.net' };
const issues = Array.from({ length: 205 }, (_, i) => ({ id: String(i + 1), key: `APP-${i + 1}`, fields: { project: { key: 'APP' }, summary: `Jira task ${i + 1}`, description: { content: [{ text: i % 2 ? 'Ordinary requested change' : 'Checkout unavailable' }] }, updated: revision, status: { name: ['Open', 'Doing', 'Done'][i % 3], statusCategory: { key: ['new', 'indeterminate', 'done'][i % 3] } }, priority: { name: 'Medium' }, labels: [] } }));
const transport = async (op, args) => {
  if (op === 'sites') return [site];
  if (op === 'projects') return { values: [{ key: 'APP', name: 'Application' }] };
  if (op === 'search') { const start = args.startAt || 0; return { issues: issues.slice(start, start + 100), total: issues.length }; }
  if (op === 'issue') return { ...issues[0], fields: { ...issues[0].fields, updated: revision } };
  writes++; return { ok: true };
};
let calls = 0;
const invoke = async ({ input }) => { calls++; return { factors: { impact: input.description.includes('Checkout unavailable') ? { score: 95, evidence: 'Checkout unavailable' } : null, timing: null, blocking: null, priority: null }, confidence: 'medium', explanations: { 'en-US': { reason: 'A reported checkout disruption needs attention.', missing: ['Deadline'] }, 'fa-IR': { reason: 'اختلال گزارش‌شده نیازمند بررسی است.', missing: ['مهلت انجام'] } } }; };
const review = async packet => ({ result: { brief: `Understand ${packet.item.title}`, summary: 'Understand the requested change.', expected: 'Deliver the requested behavior.', ambiguity: 'Repository is not connected.', findings: [{ text: 'Inspect the requirements.', evidence_ids: [] }], checks: ['Compare behavior to acceptance criteria.'], diagram: { nodes: [{ label: 'Current', kind: 'unknown', evidence_ids: [] }, { label: 'Change', kind: 'proposed', evidence_ids: [] }, { label: 'Outcome', kind: 'proposed', evidence_ids: [] }], edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }] } } });
let running, browser;
const evidence = path.resolve('.trust/specs/022-my-tasks-triage-jira/evidence'); fs.mkdirSync(evidence, { recursive: true });
try {
  running = await startControlPlaneServer(root, { taskTriageInvoke: invoke, jiraTransportCall: transport, myTasksReviewInvoke: review });
  const get = async url => (await fetch(new URL(url, running.url), { headers: { Connection: 'close' } } )).json();
  const post = async (url, body, browserOrigin = false) => {
    const session = ensureOwnerSession(root);
    return (await fetch(new URL(url, running.url), { method: 'POST', headers: { Connection: 'close', 'Content-Type': 'application/json', ...(browserOrigin ? { Origin: new URL(running.url).origin, Cookie: `atl_owner=${session.token}`, 'x-atl-csrf': session.csrf } : {}) }, body: JSON.stringify(body) })).json();
  };
  assert.ok((await post('/api/my-tasks/jira/settings', { site_id: site.id, projects: ['APP'] })).ok);
  await post('/api/my-tasks/jira/sync', {});
  let data = await get('/api/my-tasks/items'); assert.equal(data.items.length, 206);
  const engine = createTaskTriage(root, { items: () => data.items, invoke });
  engine.saveSettings({ enabled: true, provider: 'fixture', model: 'glm-5.3-flash', daily_limit: 250 });
  for (let i = 0; i < 145; i++) await engine.tick();
  assert.equal(engine.status().queued, 0);
  const callsBefore = calls;
  for (let i = 0; i < 300; i++) { if ((await get('/api/my-tasks/reviews/status')).ready === 206) break; await new Promise(r => setTimeout(r, 50)); }
  browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(running.url); await page.locator('[data-page=mytasks]').first().click(); await page.waitForSelector('.mtr-card');
  await page.locator('[data-mtr-action="view:kanban"]').click();
  await page.locator('.mtr-more-filters > summary').click();
  await page.waitForFunction(() => document.querySelector('.mtr-more-filters')?.open);
  await page.selectOption('[data-mtr-filter=source]', 'azure'); assert.equal(await page.locator('.mtr-card').count(), 1);
  await page.locator('.mtr-urgency').click(); await page.waitForSelector('.mtr-detail-dialog'); assert.match(await page.locator('.mtr-detail-dialog').innerText(), /95\/100/);
  await page.locator('[data-action=close]').last().click();
  await page.selectOption('[data-mtr-filter=source]', 'jira');
  assert.ok((await page.locator('.mtr-card').allTextContents()).every(text => text.includes('Jira')));
  await page.selectOption('[data-mtr-filter=urgency]', 'urgent');
  assert.ok(await page.locator('.mtr-card').count() > 0);
  await page.locator('.mtr-card-open').first().click(); await page.waitForSelector('.mtr-summary');
  assert.ok(await page.getByRole('link', { name: 'Open in Jira' }).count());
  await page.locator('[data-mtr-action="tab:review"]').click(); assert.match(await page.locator('.mtr-tabpanel').innerText(), /Inspect the requirements/);
  await page.locator('[data-action=close]').last().click();
  await page.locator('.mtr-card-open').nth(1).click(); await page.waitForSelector('.mtr-summary'); await page.locator('[data-action=close]').last().click();
  assert.equal(calls, callsBefore, 'opening reviews and urgency details never invokes a model');
  await page.selectOption('[data-mtr-filter=source]', ''); await page.selectOption('[data-mtr-filter=urgency]', '');
  for (const width of [390, 820, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page fits ${width}`);
    assert.equal(await page.locator('.mtr-card').evaluateAll(cards => cards.filter(c => c.scrollWidth > c.clientWidth + 1).length), 0);
    await page.screenshot({ path: path.join(evidence, `kanban-${width}.png`) });
  }
  await page.locator('[data-mtr-action=analysis-settings]').click(); await page.waitForSelector('#mtrTriageLimit');
  assert.equal(await page.locator('#mtrTriageLimit').inputValue(), '250');
  await page.locator('[data-action=close]').last().click();
  const preview = await post('/api/my-tasks/jira/preview', { operation: 'comment', issueKey: 'APP-1', changes: { commentBody: 'Reviewed request' } });
  assert.equal(writes, 0);
  assert.equal((await post('/api/my-tasks/jira/commit', { id: preview.result.id, approved: true })).ok, false, 'non-browser agent cannot approve a Jira write');
  await page.locator('[data-mtr-action=analysis-settings]').click(); await page.locator('[data-mtr-action=jira-proposals]').click();
  await page.locator('[data-mtr-action^="jira-approve:"]').click(); await page.waitForFunction(() => !document.querySelector('[data-mtr-action^="jira-approve:"]'));
  assert.equal(writes, 1);
  await page.locator('[data-action=close]').last().click();
  await page.click('#localeBtn'); await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(evidence, 'kanban-fa-mobile.png') });
  await page.click('#themeBtn'); await page.screenshot({ path: path.join(evidence, 'kanban-fa-mobile-dark.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: 206 mixed-source tasks, urgency/source filters, cached details, two reviews, Jira link, settings, browser-approved write, five widths, Persian and alternate theme');
} finally { await browser?.close(); if (running) { running.server.closeAllConnections?.(); running.server.close(); } if (oldHome === undefined) delete process.env.ATL_HOME; else process.env.ATL_HOME = oldHome; }
