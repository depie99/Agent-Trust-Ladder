import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
import { savePlanDraft, loadPlanDraft, archivePlanDraft } from '../runtime/lib/plan-studio.mjs';
import { loadQueueBook, saveQueueBook } from '../runtime/lib/queue.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-plan-archive-'));
let browser, server;
try {
  const first = savePlanDraft(root, { id: 'draft-one', intent: 'First cart plan', stage: 'repair' });
  const second = savePlanDraft(root, { id: 'draft-two', intent: 'Second cart plan', stage: 'repair' });
  const running = await startControlPlaneServer(root);
  server = running.server;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(running.url);
  await page.locator('[data-page="studio"]:visible').first().click();
  const saved = page.locator('[data-saved-plans]');
  await saved.locator('summary').click();
  assert.equal(await saved.locator('.plan-delete-icon').count(), 2);
  await saved.locator('[data-action="plan-archive-confirm:draft-one"]').click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok(fs.existsSync(first.dir), 'cancel preserves the draft');
  await saved.locator('[data-action="plan-archive-confirm:draft-one"]').click();
  await page.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await page.waitForTimeout(100);
  if (await saved.locator('.plan-delete-icon').count() !== 1) throw new Error(`Archive did not refresh: ${await page.locator('#modal').innerText()} / exists=${fs.existsSync(first.dir)}`);
  assert.equal(await saved.locator('.plan-delete-icon').count(), 1);
  assert.throws(() => loadPlanDraft(root, first.id), /Unknown plan draft/);
  assert.ok(fs.existsSync(path.join(path.dirname(path.dirname(first.dir)), 'plan-studio-archive')));
  assert.ok(fs.existsSync(second.dir), 'other draft remains');
  const book = loadQueueBook(root);
  book.queues.default.plan_draft_id = second.id;
  saveQueueBook(root, book);
  assert.throws(() => archivePlanDraft(root, second.id), /approved or queued plan/);
  assert.ok(fs.existsSync(second.dir), 'queued plan remains protected');
  assert.deepEqual(errors, []);
  console.log('PASS: draft delete icon, cancel, archive, saved list refresh, and sibling preservation');
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(root, { recursive: true, force: true });
}
