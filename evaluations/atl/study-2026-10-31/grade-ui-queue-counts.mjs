import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: node grade-ui-queue-counts.mjs <candidate-workspace>');
const importCandidate = relative => import(pathToFileURL(path.join(workspace, relative)).href);
const [{ emptyState, createTask, saveState }, { queueCreate, queueAdd }, { startControlPlaneServer }, { chromium }] = await Promise.all([
  importCandidate('runtime/lib/state.mjs'), importCandidate('runtime/lib/queue.mjs'),
  importCandidate('runtime/lib/control-plane-server.mjs'),
  import(pathToFileURL(path.resolve('D:/Projects/Agentic/Agent-Trust-Ladder/node_modules/playwright/index.mjs')).href),
]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-hidden-queue-grade-'));
let running, browser;
try {
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/manager.json'), JSON.stringify({ version: 1 }));
  const state = emptyState();
  saveState(root, state);
  queueCreate(root, 'alpha', { name: 'Alpha' });
  queueCreate(root, 'beta', { name: 'Beta' });
  const task = (title, status, queueId) => {
    const row = createTask(state, { title });
    row.status = status;
    queueAdd(root, row.id, { queueId });
    return row;
  };
  task('Alpha queued', 'triaged', 'alpha');
  task('Alpha blocked', 'blocked', 'alpha');
  task('Alpha archived', 'archived', 'alpha');
  task('Beta queued', 'triaged', 'beta');
  task('Beta done', 'done', 'beta');
  saveState(root, state);
  const statePath = path.join(root, '.trust/manager/state.json');
  const before = fs.readFileSync(statePath, 'utf8');
  running = await startControlPlaneServer(root);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(running.url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-page="tasks"]').first().click();
  const count = async status => {
    const label = await page.locator(`[data-action="filter:${status}"]`).first().textContent();
    const match = new RegExp(`${status}\\s+(\\d+)`).exec(label);
    assert.ok(match, `count is visible for ${status}: ${label}`);
    return Number(match[1]);
  };
  assert.equal(await count('Queued'), 2);
  assert.equal(await count('Blocked'), 1);
  assert.equal(await count('Done'), 1);
  await page.locator('#queueSelect').selectOption({ label: 'Alpha' });
  assert.equal(await count('Queued'), 1);
  assert.equal(await count('Blocked'), 1);
  assert.equal(await count('Done'), 0);
  await page.locator('#queueSelect').selectOption({ label: 'Beta' });
  assert.equal(await count('Queued'), 1);
  assert.equal(await count('Blocked'), 0);
  assert.equal(await count('Done'), 1);
  assert.equal(fs.readFileSync(statePath, 'utf8'), before, 'queue selection does not mutate persisted task state');
  console.log('PASS: global and selected-queue status counts; archived tasks excluded; selection is read-only');
} finally {
  await browser?.close();
  if (running) await new Promise(resolve => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
