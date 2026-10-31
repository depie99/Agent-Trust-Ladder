import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: node grade-simple-v2.mjs <candidate-workspace>');

// Part 1 — the regression test must assert the approved exact Persian heading…
const testPath = path.join(workspace, 'verification/control_plane_fa_queue_test.mjs');
const rawTestSource = fs.readFileSync(testPath, 'utf8');
// Accept both literal Persian text and \uXXXX escapes; decode escapes before matching.
const testSource = rawTestSource.replaceAll(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
assert.ok(testSource.includes('مدیریت چند صف'), 'regression test asserts the exact approved Persian heading');
assert.ok(testSource.includes('Multi-queue manager'), 'regression test keeps the English heading covered');

// Part 2 — the runtime must still render both exact headings, live, with RTL in fa.
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
  console.log('PASS: test asserts exact approved Persian heading; live queue page renders both exact headings with RTL');
} finally {
  await browser?.close();
  server.kill();
}
