import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
import { emptyState, saveState } from '../runtime/lib/state.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-responsive-'));
saveState(root, emptyState()); // a connected snapshot keeps controls enabled (offline mode disables them)
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
  const sizes = [[1920,1080], [1728,900], [1600,900], [1440,900], [1366,768], [1280,800], [1024,768], [960,900], [768,900], [600,900], [390,844], [320,700]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
      const conversation = rect('.studio-conversation');
      const plan = rect('.studio-plan');
      const tabs = rect('.studio-mobile-tabs');
      const composer = rect('.studio-composer');
      const nextstep = rect('.studio-nextstep');
      const splitTabs = rect('.planpane-tabs');
      return {
        viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        conversation: conversation && { width: conversation.width, top: conversation.top, right: conversation.right, height: conversation.height },
        plan: plan && { width: plan.width, top: plan.top, left: plan.left, right: plan.right },
        tabsVisible: !!tabs && tabs.height > 0,
        composerVisible: !!composer && composer.height > 0,
        nextstepVisible: !!nextstep && nextstep.height > 0,
        splitTabsVisible: !!splitTabs && splitTabs.height > 0,
      };
    });
    assert.ok(layout.scrollWidth <= width + 2, `${width}px has no page overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.composerVisible, `${width}px keeps the composer operable: ${JSON.stringify(layout)}`);
    if (width >= 960) {
      assert.ok(layout.splitTabsVisible, `${width}px keeps the plan tabs reachable: ${JSON.stringify(layout)}`);
      assert.ok(layout.nextstepVisible, `${width}px keeps the persistent next-step bar visible: ${JSON.stringify(layout)}`);
      assert.ok(layout.conversation && layout.plan, `${width}px renders the split workspace: ${JSON.stringify(layout)}`);
      assert.ok(Math.abs(layout.conversation.top - layout.plan.top) < 3, `${width}px keeps conversation and plan side by side: ${JSON.stringify(layout)}`);
      assert.ok(layout.conversation.width >= 260, `${width}px keeps the conversation pane usable: ${JSON.stringify(layout)}`);
      assert.ok(layout.plan.width >= 360, `${width}px keeps the plan pane usable: ${JSON.stringify(layout)}`);
      assert.ok(!layout.tabsVisible, `${width}px hides the mobile pane tabs: ${JSON.stringify(layout)}`);
    } else {
      assert.ok(layout.tabsVisible, `${width}px shows the Conversation/Plan pane tabs: ${JSON.stringify(layout)}`);
      const activePane = (layout.conversation && layout.conversation.width > 0) !== (layout.plan && layout.plan.width > 0);
      assert.ok(activePane, `${width}px shows only the active pane: ${JSON.stringify(layout)}`);
    }
    if ([1920,1366,1024,390].includes(width)) await page.screenshot({ path: path.join(output, `plan-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  // Splitter drag resizes the conversation share; double-click resets it.
  const box = await page.locator('.studio-splitter').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const draggedShare = await page.evaluate(() => Number(document.querySelector('.studio-workspace')?.style.getPropertyValue('--studio-split')));
  assert.ok(draggedShare > 40, `dragging the splitter widens the conversation pane (got ${draggedShare})`);
  await page.locator('.studio-splitter').dblclick();
  assert.equal(await page.evaluate(() => document.querySelector('.studio-workspace')?.style.getPropertyValue('--studio-split')), '40', 'double-click resets the split');
  // Planning mode controls work from the settings popover.
  await page.locator('.studio-settings > summary').click();
  await page.getByRole('button', { name: 'Local skeleton', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Local skeleton', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Generate with model', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Generate with model', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.locator('.studio-settings > summary').click(); // close the popover before switching panes
  // Mobile pane tabs: switching to Plan hides the conversation pane and back.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('[data-action="studio-pane:plan"]').click();
  assert.ok(await page.locator('.studio-plan:visible').count() >= 1, 'the Plan pane becomes visible on the mobile Plan tab');
  assert.equal(await page.locator('.studio-conversation:visible').count(), 0, 'the Conversation pane hides on the mobile Plan tab');
  await page.locator('[data-action="studio-pane:conversation"]').click();
  assert.equal(await page.locator('.studio-plan:visible').count(), 0, 'switching back hides the Plan pane');
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
  console.log('PASS: Plan Studio split workspace responsive at 12 widths; desktop split and mobile pane tabs hold; splitter drag/reset works; mode controls work; seven adjacent routes fit');
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(root, { recursive: true, force: true });
}
