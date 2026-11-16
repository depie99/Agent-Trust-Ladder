import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { emptyState, createTask, loadState, saveState } from '../runtime/lib/state.mjs';
import { refreshImportedAzureSource } from '../runtime/lib/plan-publish.mjs';
import { savePlanDraft, loadPlanDraft } from '../runtime/lib/plan-studio.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-source-refresh-'));
let browser, server;
try {
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/manager.json'), JSON.stringify({ version: 1, intake: { azure: { org_url: 'https://example.invalid/Collection', project: 'Demo', token_env: 'AZDO_PAT' } } }));
  const state = emptyState();
  const task = createTask(state, { title: 'Old cart issue', source: { type: 'azure', remote_id: 6376, revision: '1' }, plan_review_required: true });
  task.objective_hint = 'Old description';
  saveState(root, state);
  const oldDraft = savePlanDraft(root, { id: 'old-azure-draft', intent: 'Old description', stage: 'repair', sourceTaskId: task.id });
  assert.equal(loadPlanDraft(root, oldDraft.id).source_revision_at_creation, '1');
  const fetchImpl = async () => ({ ok: true, text: async () => JSON.stringify({ id: 6376, rev: 2, fields: { 'System.Title': 'Updated cart issue', 'System.Description': 'Guest cart must merge after login' } }) });
  const result = await refreshImportedAzureSource(root, task.id, { fetchImpl, azureToken: 'synthetic' });
  assert.equal(result.previousRevision, '1');
  assert.equal(result.revision, '2');
  const updated = loadState(root).tasks[task.id];
  assert.equal(updated.source.revision, '2');
  assert.equal(updated.objective_hint, 'Guest cart must merge after login');
  assert.equal(updated.intake_snapshot.objective, updated.objective_hint);
  updated.objective_hint = '<p>Guest cart must merge after login</p><p>Preserve quantities.</p>';
  const htmlState = loadState(root);
  htmlState.tasks[task.id] = updated;
  saveState(root, htmlState);
  const running = await startControlPlaneServer(root);
  server = running.server;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(running.url);
  await page.locator('[data-page="studio"]:visible').first().click();
  await page.locator('[data-saved-plans] summary').click();
  await page.locator('[data-action="plan-load:old-azure-draft"]').click();
  await page.getByRole('button', { name: 'Use updated request' }).waitFor();
  await page.getByRole('button', { name: 'Use updated request' }).click();
  assert.equal(await page.locator('#goal').inputValue(), 'Guest cart must merge after login\nPreserve quantities.');
  assert.ok(fs.existsSync(oldDraft.dir), 'old draft is preserved when using updated request');
  updated.plan_review_required = false;
  const finalState = loadState(root);
  finalState.tasks[task.id] = updated;
  saveState(root, finalState);
  await assert.rejects(refreshImportedAzureSource(root, task.id, { fetchImpl, azureToken: 'synthetic' }), /Only an unapproved/);
  console.log('PASS: Azure source refresh captures current content and revision; approved request remains protected');
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(root, { recursive: true, force: true });
}
