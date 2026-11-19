import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { emptyState, loadState, saveState } from '../runtime/lib/state.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-saved-sources-'));
fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.writeFileSync(path.join(root, 'config', 'manager.json'), JSON.stringify({ version: 1 }));
saveState(root, emptyState());
const ghToken = process.env.GITHUB_TOKEN;delete process.env.GITHUB_TOKEN; // deterministic GitHub credential readiness
let server, browser;
let azureTokenSeen = null;
let azureMode = 'ok';
let githubUiCredential = null;
try {
  const running = await startControlPlaneServer(root, { intakeAdapters: {
    github: async (cfg, options = {}) => { githubUiCredential = options?.token ?? null; return [{ title: `Issue in ${cfg.repos[0]}`, objective_hint: 'Fix the issue', completion_checks: [], priority: 'normal', risk: 'normal', labels: [], source: { type: 'github', repo: cfg.repos[0], remote_id: 17, revision: 'g1' }, intake_key: `github:${cfg.repos[0]}:17` }]; },
    jira: async cfg => [{ title: 'Jira intake bug', objective_hint: 'Fix the intake flow', completion_checks: [], priority: 'high', risk: 'normal', labels: [], source: { type: 'jira', remote_id: 'IT-42', revision: 'j1' }, intake_key: `jira:${(cfg.projects || []).join('+')}:IT-42` }],
    azure: async (_cfg, options = {}) => { azureTokenSeen = options.token || null; if (azureMode === 'auth') throw new Error(`401 Unauthorized: provider rejected token ${options.token || '(none)'}`); if (azureMode === 'net') throw new Error('socket hang up'); return []; },
  } });
  server = running.server;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(10000);
  await page.goto(running.url);
  await page.locator('[data-page="sources"]:visible').first().click();
  assert.equal(await page.evaluate(async () => (await fetch('/api/intake/connections')).status), 403, 'connection inventory requires owner CSRF');
  await page.locator('[data-action="sources-add"]').click();
  assert.equal(await page.locator('#sourceFormName').inputValue(), '');
  assert.equal(await page.locator('#sourceFormRepo').inputValue(), '');
  await page.locator('#sourceFormName').fill('Main repository');
  await page.locator('#sourceFormRepo').fill('example/demo');
  await page.locator('[data-action^="sources-form-save:"]').click();
  await page.getByText(/Main repository.*saved successfully/).waitFor();
  await page.locator('.source-connection-card').getByText('Main repository').waitFor();
  await page.locator('[data-action="sources-add"]').click();
  assert.equal(await page.locator('#sourceFormName').inputValue(), '', 'a new form never inherits saved values');
  assert.equal(await page.locator('#sourceFormRepo').inputValue(), '');
  await page.locator('#sourceFormName').fill('Second repository');
  await page.locator('#sourceFormRepo').fill('example/other');
  await page.locator('[data-action^="sources-form-save:"]').click();
  await page.getByText(/Second repository.*saved successfully/).waitFor();
  assert.equal(await page.locator('.source-connection-card').count(), 2);
  await page.locator('[data-action="sources-add"]').click();
  await page.locator('#sourceFormName').fill('Duplicate');
  await page.locator('#sourceFormRepo').fill('example/demo');
  await page.locator('[data-action^="sources-form-save:"]').click();
  await page.getByText('This location is already connected.').waitFor();
  assert.equal(await page.locator('#sourceFormRepo').inputValue(), 'example/demo', 'failed save keeps entered values');
  await page.locator('[data-action="close"]').last().click();
  await page.locator('[data-action="sources-add"]').click();
  await page.locator('[data-action="sources-form-provider:azure"]').click();
  await page.locator('#sourceFormName').fill('Sprint 74');
  await page.locator('#sourceFormUrl').fill('https://devops.example.com/Collection');
  await page.locator('#sourceFormProject').fill('Example');
  await page.locator('[data-action^="sources-form-save:"]').click();
  await page.getByText(/Sprint 74.*saved successfully/).waitFor();
  const azureCard = page.locator('.source-connection-card').filter({ hasText: 'Sprint 74' });
  await azureCard.locator('[data-action^="sources-credential:"]').click();
  await page.locator('#sourceConnectionPat').fill('synthetic-azure-pat');
  await page.locator('[data-action^="sources-credential-save:"]').click();
  // With "remember" checked, the server encrypts through a PowerShell DPAPI
  // roundtrip; on a cold CI runner that spawn can outlast the 10s default.
  await page.getByText('Azure credential saved. Check access to verify it.').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.source-connection-card').count(), 3);
  const azureBrowse = page.locator('.source-connection-card').filter({ hasText: 'Sprint 74' }).locator('[data-action^="sources-browse:"]');
  await azureBrowse.click();
  await page.locator('[data-action="sources-preview-selected"]').click();
  await page.getByText('0 issue(s) found. No task was created.').waitFor();
  assert.equal(azureTokenSeen, 'synthetic-azure-pat', 'connection-specific Azure credential reaches adapter');
  await page.locator('[data-action^="sources-browse:"]').first().click();
  await page.locator('[data-action="sources-preview-selected"]').click();
  await page.getByText('1 issue(s) found. No task was created.').waitFor();
  await page.locator('[data-action="sources-import"]').click();
  await page.getByText(/1 request\(s\) imported for planning/).waitFor();
  const task = Object.values(loadState(root).tasks).find(item => item.title === 'Issue in example/demo');
  assert.ok(task?.source?.connection_id, 'import retains connection provenance');
  // GitHub session token (bug: the UI had no token entry, so private-repo 404s
  // were a dead end): connect on the card → session-memory only → check and
  // browse use it → disconnect returns to anonymous.
  await page.reload();
  await page.locator('.source-connection-card').first().waitFor();
  assert.equal(await page.locator('.source-connection-card').count(), 3, 'connections survive reload');
  const githubCard = page.locator('.source-connection-card').filter({ hasText: 'Main repository' });
  assert.equal(await githubCard.locator('[data-action^="sources-credential:"]').innerText(), 'Connect token', 'a github connection without credentials offers token entry');
  await githubCard.locator('[data-action^="sources-credential:"]').click();
  await page.locator('#sourceConnectionPat').fill('gh-session-token');
  await page.locator('[data-action^="sources-credential-save:"]').click();
  await page.getByText('GitHub token connected for this session only').waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(sessionStorage).includes('gh-session-token')), false, 'browser storage contains no GitHub token');
  await githubCard.locator('[data-action^="sources-check:"]').click();
  await page.getByText('Access check complete.').waitFor();
  assert.equal(githubUiCredential, 'gh-session-token', 'the session GitHub token authenticates the connection access check');
  await githubCard.getByText('Access verified').waitFor();
  await githubCard.locator('[data-action^="sources-credential:"]').click();
  assert.equal(await githubCard.locator('[data-action^="sources-credential:"]').innerText(), 'Replace token', 'a session-connected github connection offers replacement');
  await page.locator('[data-action="close"]').last().click();
  await githubCard.locator('[data-action^="sources-browse:"]').click();
  await page.locator('[data-action="sources-preview-selected"]').click();
  await page.getByText('1 issue(s) found. No task was created.').waitFor();
  assert.equal(githubUiCredential, 'gh-session-token', 'the session GitHub token reaches the github browse preview');
  await githubCard.locator('[data-action^="sources-credential:"]').click();
  await page.locator('[data-action^="sources-credential-disconnect:"]').click();
  await page.getByText('GitHub token disconnected; anonymous public-repository access only.').waitFor();
  await githubCard.getByText('Connect token').waitFor();
  await page.locator('[data-action="sources-preview-selected"]').click();
  await page.getByText('1 issue(s) found. No task was created.').waitFor();
  assert.equal(githubUiCredential, null, 'browse runs anonymously after the session token is disconnected');
  // Background repaint mid-typing must keep focus, value and caret (bug: focus
  // fell to <body> and keystrokes fired global shortcuts — "n" opened a modal).
  await page.locator('[data-page="queues"]:visible').first().click();
  let releaseMap; const mapGate = new Promise((resolve) => { releaseMap = resolve; });
  await page.route('**/api/projects/map', async (route) => { await mapGate; await route.continue(); });
  await page.locator('[data-page="sources"]:visible').first().click();
  const search = page.locator('#sourceSearch');
  await search.click();
  await page.keyboard.type('Issue');
  await search.evaluate((node) => { node.dataset.preRepaint = 'yes'; });
  releaseMap();
  await page.waitForFunction(() => !document.querySelector('#sourceSearch')?.dataset.preRepaint, undefined, { timeout: 9000 });
  await page.unroute('**/api/projects/map');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'sourceSearch', 'loadProjectMap repaint keeps the caret in the search field');
  assert.equal(await search.inputValue(), 'Issue', 'loadProjectMap repaint keeps in-progress typing');
  await page.keyboard.type(' in example');
  assert.equal(await search.inputValue(), 'Issue in example', 'typing continues after the project map repaint');
  assert.equal(await page.locator('#modal .dialog').count(), 0, 'no global-shortcut dialog opened after the project map repaint');
  await page.locator('[data-action="sources-add"]').click();
  assert.equal(await page.locator('#sourceFormRepo').inputValue(), '');
  await page.locator('[data-action="close"]').last().click();
  const evidenceDir = path.join(process.cwd(), '.atl-evidence', 'issue-sources');
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, 'saved-connections-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('body').evaluate(node => node.scrollWidth <= node.clientWidth + 2), 'sources fit mobile viewport');
  await page.screenshot({ path: path.join(evidenceDir, 'saved-connections-mobile.png'), fullPage: true });
  // Jira lifecycle: provider-specific form → card → browse → import provenance.
  await page.locator('[data-action="sources-add"]').click();
  await page.locator('[data-action="sources-form-provider:jira"]').click();
  await page.locator('#sourceFormName').fill('Ops Jira');
  await page.locator('#sourceFormUrl').fill('https://jira.example.com');
  await page.locator('#sourceFormProjects').fill('it');
  await page.locator('[data-action^="sources-form-save:"]').click();
  await page.getByText(/Ops Jira.*saved successfully/).waitFor();
  assert.equal(await page.locator('.source-connection-card').count(), 4);
  await page.locator('.source-connection-card').filter({ hasText: 'Ops Jira' }).locator('[data-action^="sources-browse:"]').click();
  await page.locator('[data-action="sources-preview-selected"]').click();
  await page.getByText('1 issue(s) found. No task was created.').waitFor();
  await page.locator('[data-action="sources-import"]').click();
  await page.getByText(/1 request\(s\) imported for planning/).waitFor();
  assert.ok(Object.values(loadState(root).tasks).find(item => item.title === 'Jira intake bug')?.source?.connection_id, 'jira import retains connection provenance');
  // Access status is observed through the provider, never implied by a saved
  // credential — and adapter errors never echo the token back.
  await page.locator('.source-connection-card').filter({ hasText: 'Main repository' }).locator('[data-action^="sources-check:"]').click();
  await page.getByText('Access check complete.').waitFor();
  await page.locator('.source-connection-card').filter({ hasText: 'Main repository' }).getByText('Access verified').waitFor();
  azureMode = 'auth';
  await page.locator('.source-connection-card').filter({ hasText: 'Sprint 74' }).locator('[data-action^="sources-check:"]').click();
  await azureCard.getByText('Needs authentication').waitFor();
  const azureCardText = await azureCard.innerText();
  assert.ok(azureCardText.includes('[redacted]'), 'adapter errors are redacted before display');
  assert.ok(!azureCardText.includes('synthetic-azure-pat'), 'saved token never reaches the page');
  azureMode = 'ok';
  // Pause and resume through the overflow menu.
  await page.locator('.source-connection-card').filter({ hasText: 'Ops Jira' }).locator('.source-card-menu summary').click();
  await page.locator('.source-connection-card').filter({ hasText: 'Ops Jira' }).locator('.source-card-menu [data-action^="sources-toggle:"]').click();
  // textContent concatenates adjacent nodes without separators, so match the
  // status word directly instead of with word-boundary regexes.
  await page.waitForFunction(() => [...document.querySelectorAll('.source-connection-card')].some(c => c.textContent.includes('Ops Jira') && c.textContent.includes('Paused')));
  await page.locator('.source-connection-card').filter({ hasText: 'Ops Jira' }).locator('.source-card-menu summary').click();
  await page.locator('.source-connection-card').filter({ hasText: 'Ops Jira' }).locator('.source-card-menu [data-action^="sources-toggle:"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.source-connection-card')].some(c => c.textContent.includes('Ops Jira') && c.textContent.includes('Enabled')));
  // Double submission is guarded: two clicks in one tick create one connection.
  await page.locator('[data-action="sources-add"]').click();
  await page.locator('#sourceFormName').fill('Race Repo');
  await page.locator('#sourceFormRepo').fill('example/race');
  await page.evaluate(() => { const button = document.querySelector('[data-action^="sources-form-save:"]'); button.click(); button.click(); });
  await page.getByText(/Race Repo.*saved successfully/).waitFor();
  assert.equal(await page.locator('.source-connection-card').count(), 5, 'double submit creates exactly one connection');
  // Remove through the kebab menu — and the menu must not be clipped: .panel's
  // overflow:hidden sliced the dropdown mid-item, leaving the last row's
  // "Remove connection" unreachable. The override is pinned here so a future
  // token/cleanup pass cannot silently re-clip it.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.source-workbench:has(.source-connection-grid)')).overflow), 'visible', 'the connections panel never clips the card kebab menu');
  const raceCard = page.locator('.source-connection-card').filter({ hasText: 'Race Repo' });
  page.once('dialog', dialog => dialog.accept());
  await raceCard.locator('.source-card-menu summary').click();
  await raceCard.locator('.source-card-menu [data-action^="sources-delete:"]').click();
  await page.getByText('Connection removed.').waitFor();
  assert.equal(await page.locator('.source-connection-card').count(), 4, 'remove deletes the connection card');
  assert.ok(!JSON.parse(fs.readFileSync(path.join(root, '.trust', 'manager', 'issue-connections.json'), 'utf8')).connections.some(c => c.name === 'Race Repo'), 'remove deletes the saved connection record');
  // Theme tokens: cards follow dark and light instead of a fixed light palette.
  // The first card is selected (accent border) after reload, so sample another.
  const themeProbe = () => page.locator('.source-connection-card').filter({ hasText: 'Second repository' }).evaluate(node => { const s = getComputedStyle(node); return { bg: s.backgroundColor, border: s.borderColor }; });
  await page.evaluate(() => localStorage.setItem('atl-cp-theme', 'dark'));
  await page.reload();
  await page.locator('.source-connection-card').first().waitFor();
  assert.deepEqual(await themeProbe(), { bg: 'rgb(23, 23, 34)', border: 'rgb(38, 38, 58)' }, 'cards render with dark theme tokens');
  await page.evaluate(() => localStorage.setItem('atl-cp-theme', 'light'));
  await page.reload();
  await page.locator('.source-connection-card').first().waitFor();
  assert.deepEqual(await themeProbe(), { bg: 'rgb(255, 255, 255)', border: 'rgb(222, 221, 235)' }, 'cards render with light theme tokens');
  // RTL: the Persian locale flips direction and the layout still fits.
  await page.locator('#localeBtn').click();
  await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  assert.equal(await page.locator('.source-connection-grid').evaluate(node => getComputedStyle(node).direction), 'rtl', 'connection grid flips direction');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('body').evaluate(node => node.scrollWidth <= node.clientWidth + 2), 'sources fit mobile viewport in RTL');
  await page.screenshot({ path: path.join(evidenceDir, 'saved-connections-rtl-mobile.png'), fullPage: true });
  console.log('PASS: saved cards, blank add form, GitHub+Jira lifecycles, session GitHub token connect/check/browse/disconnect, focus-preserving repaint, verified/needs-auth states with redaction, pause/resume, double-submit guard, kebab-menu remove, dark/light/RTL rendering, reload and mobile');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
  if (ghToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = ghToken;
}
