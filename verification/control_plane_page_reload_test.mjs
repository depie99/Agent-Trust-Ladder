import assert from "node:assert/strict";
import { chromium } from "playwright";
import { controlPlaneProject } from './fixtures/control-plane-project.mjs';

const running = await controlPlaneProject();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(running.url, { waitUntil: "domcontentloaded" });
  for (const route of ["overview", "tasks", "studio", "queues", "team", "projects", "approvals", "operations", "brain", "activity", "usage", "settings"]) {
    await page.locator(`[data-page="${route}"]`).first().click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-page="${route}"].on`).first().waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("atl-cp-page")), route);
  }
  const sidebarRoutes = await page.locator(".sidebar [data-page]").evaluateAll(buttons => [...new Set(buttons.map(button => button.dataset.page))]);
  assert.ok(sidebarRoutes.includes("tasks") && sidebarRoutes.includes("studio"));
  for (const route of sidebarRoutes) {
    await page.locator(`.sidebar [data-page="${route}"]`).first().click();
    const spacing = await page.locator("#content").evaluate(content => {
      const style = getComputedStyle(content);
      return [style.paddingInlineStart, style.paddingInlineEnd, style.maxWidth];
    });
    assert.deepEqual(spacing, ["16px", "16px", "none"], `shared content gutter on ${route}`);
  }
  const invalidPage = await browser.newPage();
  await invalidPage.addInitScript(() => sessionStorage.setItem("atl-cp-page", "invalid"));
  await invalidPage.goto(running.url, { waitUntil: "domcontentloaded" });
  await invalidPage.locator('[data-page="overview"].on').first().waitFor();
  console.log("PASS: each control-plane menu survives reload; invalid saved routes fall back to overview");
} finally {
  await browser.close();
  await running.close();
}
