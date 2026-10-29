import assert from "node:assert/strict";
import { chromium } from "playwright";
import { controlPlaneProject } from './fixtures/control-plane-project.mjs';

const running = await controlPlaneProject();
const baseUrl = running.url;
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
  assert.equal(queueHeading, "\u0645\u062f\u06cc\u0631\u06cc\u062a \u0686\u0646\u062f \u0635\u0641", "Queue heading is the approved Persian translation");
  assert.match(await page.locator("#localeBtn").textContent(), /English/);
  for (const route of ["overview", "tasks", "studio", "queues", "team", "projects", "approvals", "operations", "brain", "activity", "usage", "settings"]) {
    await page.locator(`[data-page="${route}"]`).first().click();
    await page.locator("h1").waitFor({ state: "visible" });
    assert.match(await page.locator("h1").textContent(), /[\u0600-\u06ff]/, `${route} heading is localized`);
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl", `${route} remains RTL`);
  }
  await page.locator('[data-page="tasks"]').first().click();
  assert.match(await page.locator("body").innerText(), /T-026/, "Task portfolio shows the ATL task");
  assert.ok(await page.locator(".bidi-isolate").count() > 0, "mixed-direction surfaces are isolated");
  console.log("PASS: live Queue page switches to fa-IR with RTL layout");
} finally {
  await browser.close();
  await running.close();
}
