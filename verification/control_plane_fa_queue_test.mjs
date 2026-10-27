import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.ATL_UI_URL || "http://127.0.0.1:55012/";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('[data-page="queues"]').first().click();
  await assert.doesNotReject(() => page.locator("h1").waitFor({ state: "visible" }));
  assert.equal(await page.locator("h1").textContent(), "Multi-queue manager");
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.locator("#localeBtn").click(),
  ]);
  await page.locator('[data-page="queues"]').first().click();
  assert.equal(await page.locator("html").getAttribute("lang"), "fa-IR");
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  assert.equal(await page.locator("body").evaluate((node) => node.classList.contains("atl-rtl")), true);
  const queueHeading = await page.locator("h1").textContent();
  assert.match(queueHeading, /[\u0600-\u06ff]/, "Queue heading uses Persian/Arabic Unicode text");
  assert.match(await page.locator("#localeBtn").textContent(), /English/);
  console.log("PASS: live Queue page switches to fa-IR with RTL layout");
} finally {
  await browser.close();
}
