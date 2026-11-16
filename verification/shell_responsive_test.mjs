import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';

// Shell-level responsive gate (2026-11-16 sweep): the overview task chain
// pinned the page at ~617px through a plain-1fr stacking trap plus a
// non-shrinkable queue pill, and the topbar squeezed its action buttons into
// vertical blobs below 720px. Every page must stay inside its viewport — in
// both directions, RTL included — at every sweep width.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-shell-responsive-'));
const scss = fs.readFileSync(new URL('../runtime/scss/_app.scss', import.meta.url), 'utf8');
assert.ok(scss.includes('.twocol{grid-template-columns:minmax(0,1fr)}'), 'twocol stacking must allow shrink below content (minmax(0,1fr))');
assert.ok(scss.includes('Narrow-viewport shell hardening'), 'topbar narrow-viewport hardening must be present');

const output = path.resolve('.atl-evidence/responsive-shell');
fs.mkdirSync(output, { recursive: true });
let browser, server;
const sizes = [[1920, 1080], [1366, 768], [1024, 768], [768, 900], [640, 900], [486, 860], [390, 844], [320, 700]];
const pages = ['overview', 'tasks', 'runs', 'queues', 'mytasks', 'usage'];
try {
  const running = await startControlPlaneServer(root);
  server = running.server;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'fa-IR', colorScheme: 'dark' });
  await context.addInitScript(() => { try { localStorage.setItem('atl-cp-lang', 'fa-IR'); } catch { /* private browsing */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(running.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  let checked = 0;
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    for (const id of pages) {
      const btn = page.locator(`[data-page="${id}"]:visible`).first();
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 6000, force: true });
      await page.waitForTimeout(400);
      const layout = await page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth - Math.max(document.documentElement.clientWidth, window.innerWidth),
        rtl: document.documentElement.dir === 'rtl',
        newBtn: (() => { const b = document.querySelector('#newBtn'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
      }));
      assert.ok(layout.overflowX <= 2, `${width}px ${id} has no horizontal overflow (delta ${layout.overflowX})`);
      if (layout.newBtn && width <= 486) assert.ok(layout.newBtn.h < 60, `${width}px keeps the New task button single-line (h=${layout.newBtn.h})`);
      checked++;
    }
  }
  assert.ok(checked >= 40, `sweep must cover the page/width matrix (${checked} checked)`);
  assert.deepEqual(errors, [], 'no client page errors during the sweep');
  if (sizes.some(([width]) => width <= 390)) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, 'shell-390.png'), fullPage: false });
  }
  console.log(`PASS: Shell responsive — ${checked} page/width combos, no overflow, RTL included, buttons whole`);
} finally {
  try { await browser?.close(); } catch { /* already closed */ }
  try { await server?.close(); } catch { /* fixture server exit */ }
}
