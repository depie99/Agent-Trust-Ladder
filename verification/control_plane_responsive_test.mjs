import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-responsive-'));
const output = path.resolve('.atl-evidence/responsive');
fs.mkdirSync(output, { recursive: true });
let browser, server;
try {
  const running = await startControlPlaneServer(root);
  server = running.server;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(running.url);
  await page.locator('[data-page="studio"]:visible').first().click();
  await page.locator('#goal').fill('Task 6376: Cart item lost after login. Guest items must survive login and merge without duplicates. '.repeat(12));
  await page.getByRole('button', { name: 'Generate with model', exact: true }).click();
  const sizes = [[1920,1080], [1728,900], [1600,900], [1440,900], [1366,768], [1280,800], [1024,768], [768,900], [600,900], [390,844], [320,700]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
      const button = rect('.studio-mode-switch [data-action="mode:model"]');
      const label = rect('.studio-mode-switch [data-action="mode:model"] > span:first-child');
      const badge = rect('.studio-mode-switch [data-action="mode:model"] > .pill');
      const cards = [...document.querySelectorAll('.studio-layout > .studio-step-card')].map(el => el.getBoundingClientRect());
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, buttonWidth: button?.width, labelWidth: label?.width, badgeWidth: badge?.width, labelBottom: label?.bottom, badgeTop: badge?.top, columns: cards.length > 1 && Math.abs(cards[0].top - cards[1].top) < 2 ? 2 : 1, cardRight: Math.max(...cards.map(card => card.right)), cardWidths: cards.map(card => card.width), previewTop: rect('.studio-layout + .space')?.top };
    });
    assert.ok(layout.scrollWidth <= width + 2, `${width}px has no page overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.buttonWidth >= 120, `${width}px keeps planning choices operable: ${JSON.stringify(layout)}`);
    assert.ok(layout.labelWidth <= layout.buttonWidth && layout.badgeWidth <= layout.buttonWidth, `${width}px mode content fits its button`);
    assert.ok(layout.labelBottom <= layout.badgeTop + 2, `${width}px session badge does not collide with the label`);
    assert.ok(layout.cardRight <= width + 2, `${width}px keeps plan cards in the viewport`);
    assert.equal(layout.columns, width > 980 ? 2 : 1, `${width}px preserves laptop side-by-side layout and stacks only on narrow screens`);
    if (width >= 1024) assert.ok(layout.cardWidths[0] >= 380 && layout.cardWidths[1] >= 360, `${width}px keeps both planning panels usable: ${JSON.stringify(layout)}`);
    if (width === 1366) assert.ok(layout.previewTop < 1300, `laptop plan preview follows the parallel cards, not a stacked engine card: ${JSON.stringify(layout)}`);
    if ([1920,1366,1024,390].includes(width)) await page.screenshot({ path: path.join(output, `plan-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: 'Local skeleton', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Local skeleton', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Generate with model', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Generate with model', exact: true }).getAttribute('aria-pressed'), 'true');
  // Snapshot polling redraws both views every two seconds. Scrolling must
  // survive that redraw without jumping back to the top.
  for (const destination of ['studio', 'tasks']) {
    await page.locator(`[data-page="${destination}"]:visible`).first().click();
    await page.setViewportSize({ width: 390, height: 500 });
    const position = await page.evaluate(() => {
      window.scrollTo(0, Math.min(350, document.documentElement.scrollHeight - innerHeight));
      return window.scrollY;
    });
    assert.ok(position > 0, `${destination} has scrollable content`);
    await page.waitForTimeout(2600);
    assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - position) < 3, `${destination} keeps its position after polling`);
  }
  for (const destination of ['overview', 'tasks', 'sources', 'queues', 'team', 'projects', 'settings']) {
    await page.locator(`[data-page="${destination}"]:visible`).first().click();
    for (const width of [1366, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(scrollWidth <= width + 2, `${destination} at ${width}px has no page overflow (scroll width ${scrollWidth})`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Plan Studio responsive layout at 11 widths; laptop columns and preview position preserved; mode controls work; seven adjacent routes fit');
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(root, { recursive: true, force: true });
}
