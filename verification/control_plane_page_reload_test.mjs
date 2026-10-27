import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.ATL_UI_URL || "http://127.0.0.1:55012/", { waitUntil: "domcontentloaded" });
  for (const route of ["overview", "tasks", "studio", "queues", "team", "projects", "approvals", "operations", "brain", "activity", "usage", "settings"]) {
    await page.locator(`[data-page="${route}"]`).first().click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-page="${route}"].on`).first().waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("atl-cp-page")), route);
  }
  const invalidPage = await browser.newPage();
  await invalidPage.addInitScript(() => sessionStorage.setItem("atl-cp-page", "invalid"));
  await invalidPage.goto(process.env.ATL_UI_URL || "http://127.0.0.1:55012/", { waitUntil: "domcontentloaded" });
  await invalidPage.locator('[data-page="overview"].on').first().waitFor();
  console.log("PASS: each control-plane menu survives reload; invalid saved routes fall back to overview");
} finally {
  await browser.close();
}
