import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
import { registerProject } from '../runtime/lib/supervisor.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-review-large-ui-'));
const saved = { ATL_HOME: process.env.ATL_HOME, AZDO_PAT: process.env.AZDO_PAT };
process.env.ATL_HOME = path.join(root, 'home'); process.env.AZDO_PAT = 'synthetic-ui-token';
fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.writeFileSync(path.join(root, 'config/manager.json'), JSON.stringify({ intake: { azure: { org_url: 'https://azure.invalid/collection', project: 'Alpha', token_env: 'AZDO_PAT' } } }));
const code = path.join(root, 'cart'); fs.mkdirSync(code);
execFileSync('git', ['init'], { cwd: code, stdio: 'pipe' });
fs.writeFileSync(path.join(code, 'cart.js'), 'export function cart() { return []; }\n');
execFileSync('git', ['add', '.'], { cwd: code });
execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'], { cwd: code, stdio: 'pipe' });
const repository = registerProject(code, { name: 'Cart code' });
const me = { id: 'fixture-owner', displayName: 'Fixture Owner' };
const work = Array.from({ length: 205 }, (_, i) => ({ id: i + 1, fields: { 'System.Id': i + 1, 'System.Rev': 1, 'System.Title': `Cart item ${i + 1}`, 'System.State': ['New', 'Doing', 'Done'][i % 3], 'System.WorkItemType': 'Task', 'System.AssignedTo': me, 'Microsoft.VSTS.Common.Priority': 2, 'System.AreaPath': 'Alpha\\Cart', 'System.Description': '<p>Persist cart contents after login.</p>', 'Microsoft.VSTS.Common.AcceptanceCriteria': 'Items remain in the cart.', 'System.ChangedDate': '2026-11-13T09:00:00Z' } }));
const transport = async url => {
  if (url.includes('ConnectionData')) return { data: { authenticatedUser: me } };
  if (url.includes('/projects')) return { data: { value: [{ name: 'Alpha', id: 'alpha' }] } };
  if (url.includes('/wiql')) return { data: { workItems: work.map(({ id }) => ({ id })) } };
  if (url.includes('/workitemsbatch')) return { data: { value: work } }; // one batch seam returns the complete fixture
  if (url.includes('/states')) return { data: { value: [{ name: 'New', category: 'Proposed' }, { name: 'Doing', category: 'InProgress' }, { name: 'Done', category: 'Complete' }] } };
  throw new Error('Unexpected fixture request');
};
// Respect the Azure batch seam, including the final 5-item batch.
const fetcher = async (url, options) => url.includes('/workitemsbatch') ? { data: { value: work.filter(item => options.body.ids.includes(item.id)) } } : transport(url);
let calls = 0;
const invoke = async packet => {
  calls++;
  const refs = packet.evidence.slice(0, 1).map(e => e.id), persian = packet.locale === 'fa-IR';
  return { provider: 'fixture', model: 'fixture', result: { brief: persian ? 'حفظ سبد خرید پس از ورود' : 'Keep cart contents after login', summary: persian ? 'اقلام سبد خرید باید پس از ورود باقی بمانند.' : 'Keep the customer’s cart intact when they sign in.', expected: persian ? 'سبد پس از ورود خالی نشود.' : 'Signing in preserves the existing cart.', ambiguity: persian ? 'رفتار فعلی بدون اتصال مخزن مشخص نیست.' : 'Connect code to establish current behavior.', findings: [{ text: persian ? 'مسیر ورود و بازیابی سبد را بررسی کنید.' : 'Inspect the sign-in and cart restoration path.', evidence_ids: refs }], checks: [persian ? 'سبد قبل و بعد از ورود یکسان باشد.' : 'Compare cart items before and after sign-in.'], diagram: { nodes: [{ label: persian ? 'سبد پیش از ورود' : 'Cart before sign-in', kind: refs.length ? 'observed' : 'unknown', evidence_ids: refs }, { label: persian ? 'حفظ اقلام هنگام ورود' : 'Preserve items at sign-in', kind: 'proposed', evidence_ids: [] }, { label: persian ? 'سبد پایدار' : 'Intact customer cart', kind: 'proposed', evidence_ids: [] }], edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }] } } };
};
const evidenceDir = path.resolve('.trust/specs/021-azure-my-tasks/evidence/review-ui'); fs.mkdirSync(evidenceDir, { recursive: true });
let running, browser;
try {
  running = await startControlPlaneServer(root, { myTasksFetch: fetcher, myTasksReviewInvoke: invoke });
  const get = async route => (await fetch(new URL(route, running.url))).json();
  for (let i = 0; i < 300; i++) { if ((await get('/api/my-tasks/reviews/status')).ready === 205) break; await new Promise(r => setTimeout(r, 50)); }
  assert.equal((await get('/api/my-tasks/reviews/status')).ready, 205, 'all 205 reviews are pre-generated');
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { if (!localStorage.getItem('atl-cp-theme')) localStorage.setItem('atl-cp-theme', 'dark'); });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(running.url); await page.locator('[data-page=mytasks]').first().click(); await page.waitForSelector('.mtr-card');
  assert.equal(await page.locator('.mtr-count').first().innerText(), '69');
  assert.equal(await page.locator('.mtr-card').count(), 18, 'large sections render bounded batches rather than 205 cards at once');
  await page.locator('[data-mtr-action="more:proposed"]').click(); assert.equal(await page.locator('[data-mtr-group=proposed] .mtr-card').count(), 36);
  const before = calls, started = performance.now(); await page.fill('#mtrSearch', 'Cart item 205');
  assert.ok(performance.now() - started < 1500, 'search stays responsive with 205 tasks');
  assert.equal(await page.locator('.mtr-card').count(), 1);
  await page.fill('#mtrSearch', '');
  await page.screenshot({ path: path.join(evidenceDir, 'desktop-dark.png'), fullPage: true });
  await page.click('#themeBtn'); await page.screenshot({ path: path.join(evidenceDir, 'desktop-light.png'), fullPage: true });
  // Pending reviews show the live loading mark; failed reviews keep it off.
  await page.route('**/api/my-tasks/review?*', route => route.abort());
  await page.locator('.mtr-card').first().click();
  await page.waitForSelector('.mtr-pending [data-mtr-action=retry]');
  assert.equal(await page.locator('.mtr-pending .running-mark').count(), 0, 'failed reviews do not show the loading mark');
  await page.keyboard.press('Escape'); await page.unroute('**/api/my-tasks/review?*');
  await page.route('**/api/my-tasks/review?*', async route => { await new Promise(r => setTimeout(r, 1200)); await route.continue(); });
  await page.locator('.mtr-card').first().click();
  await page.waitForSelector('.mtr-pending .running-mark');
  await page.waitForSelector('.mtr-diagram-render svg', { timeout: 15000 });
  await page.keyboard.press('Escape'); await page.unroute('**/api/my-tasks/review?*');
  await page.locator('.mtr-card').first().click(); await page.waitForSelector('.mtr-diagram-render svg');
  assert.ok(await page.locator('.mtr-diagram-render').evaluate(root => [...root.querySelectorAll('foreignObject')].every(el => el.firstElementChild.getBoundingClientRect().height <= el.getBoundingClientRect().height + 1)), 'diagram labels are not clipped by modal typography');
  await page.screenshot({ path: path.join(evidenceDir, 'overview-light.png') });
  assert.equal(calls, before, 'opening a pre-generated review does not invoke the agent');
  await page.locator('[data-mtr-action="tab:review"]').click(); await page.locator('[data-mtr-action=item-binding]').click();
  await page.locator(`[data-mtr-repo="${repository.id}"]`).check(); await page.locator('[data-mtr-action=binding-save]').click();
  for (let i = 0; i < 50; i++) { if (calls > before) break; await new Promise(r => setTimeout(r, 50)); }
  // Binding changes enqueue automatically; opening the modal remains a pure read.
  await page.keyboard.press('Escape'); await page.locator('.mtr-card').first().click(); await page.waitForSelector('.mtr-summary');
  await page.locator('[data-mtr-action="tab:review"]').click(); await page.locator('.mtr-evidence > summary').click();
  await page.waitForSelector('.mtr-evidence code'); assert.match(await page.locator('.mtr-evidence').innerText(), /cart\.js/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.mermaid.render = async () => { throw new Error('Synthetic render failure'); }; });
  await page.locator('.mtr-card').nth(1).click(); await page.waitForSelector('.mtr-diagram[aria-busy=false]');
  assert.ok(await page.locator('.mtr-flow').isVisible(), 'text flow remains usable when Mermaid fails');
  await page.keyboard.press('Escape');
  await page.click('#localeBtn'); await page.waitForFunction(() => document.documentElement.dir === 'rtl'); await page.waitForSelector('.mtr-card');
  await page.waitForFunction(() => [...document.querySelectorAll('.mtr-brief')].some(n => n.textContent.includes('سبد')));
  await page.locator('[data-mtr-action="view:kanban"]').click();
  await page.locator('[data-mtr-group=complete] > summary').click();
  const longBrief = page.locator('[data-mtr-group=inprogress] .mtr-brief').first();
  const savedBrief = await longBrief.textContent();
  await longBrief.evaluate(el => { el.textContent = 'Review guest-cart preservation across login with evidence limited to connected repositories. '.repeat(8); });
  for (const width of [1920, 1280, 1024, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.locator('.mtr-status-group[open]').evaluateAll(groups => groups.flatMap(group => [...group.querySelectorAll('.mtr-card')].filter(card => {
      const bounds = card.getBoundingClientRect(), column = group.getBoundingClientRect();
      return bounds.left < column.left - 1 || bounds.right > column.right + 1 || card.scrollWidth > card.clientWidth + 1;
    })).length);
    assert.equal(overflow, 0, `Kanban cards and long briefs fit their columns at ${width}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Kanban page fits at ${width}px`);
  }
  await longBrief.evaluate((el, text) => { el.textContent = text; }, savedBrief);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const doneStyle = await page.locator('.mtr-card.is-done').first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderColor, strike: getComputedStyle(el.querySelector('b')).textDecorationLine }));
  const todoStyle = await page.locator('[data-mtr-group=proposed] .mtr-card').first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderColor }));
  assert.notEqual(doneStyle.background, todoStyle.background, 'Done has its own soft green surface');
  assert.notEqual(doneStyle.border, todoStyle.border, 'Done has a distinct green border');
  assert.notEqual(doneStyle.background, 'rgba(0, 0, 0, 0)', 'Done surface must resolve to a real theme color');
  const borderChannels = doneStyle.border.match(/[\d.]+/g).map(Number);
  assert.ok(borderChannels[1] > borderChannels[0], 'Done border must have a green hue');
  assert.equal(doneStyle.strike, 'none', 'completed titles remain legible');
  await page.screenshot({ path: path.join(evidenceDir, 'kanban-persian.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile RTL page fits without horizontal overflow');
  await page.screenshot({ path: path.join(evidenceDir, 'mobile-persian.png'), fullPage: true });
  await page.locator('.mtr-card').first().click(); await page.waitForSelector('.mtr-summary');
  await page.screenshot({ path: path.join(evidenceDir, 'mobile-modal-persian.png') });
  assert.ok(await page.locator('.mtr-detail-dialog').evaluate(el => el.getBoundingClientRect().height <= innerHeight), 'mobile modal fits viewport');
  assert.deepEqual(errors, []);
  console.log('PASS: 205 pre-generated reviews, bounded rendering, fast search, cached modal reads, repository override UI + code evidence, Mermaid rendering/fallback, theme/RTL/mobile screenshots');
} finally {
  running?.server.close(); running?.server.closeAllConnections?.(); if (browser) await browser.close();
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
