import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: node grade-simple-queue.mjs <candidate-workspace>');
const { chromium } = await import(pathToFileURL(path.resolve('D:/Projects/Agentic/Agent-Trust-Ladder/node_modules/playwright/index.mjs')).href);
const port = 55784;
const server = spawn(process.execPath, [path.join(workspace, 'runtime/atl-manager.mjs'), 'control-plane', '--port', String(port), '--no-open'], { cwd: workspace, stdio: 'ignore', windowsHide: true });
let browser;
try {
  const url = `http://127.0.0.1:${port}/`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(url); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'candidate Control Plane starts and serves HTTP');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.locator('[data-page="queues"]').first().click();
  assert.equal(await page.locator('h1').textContent(), 'Multi-queue manager');
  await page.locator('#localeBtn').click();
  await page.locator('[data-page="queues"]').first().click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'fa-IR');
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await page.locator('h1').textContent(), 'مدیریت چند صف');
  console.log('PASS: live queue page renders exact English and Persian headings with RTL');
} finally {
  await browser?.close();
  server.kill();
}
