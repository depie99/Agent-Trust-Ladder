import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

// Issue #32 acceptance: axe-core reports no critical or serious violations on
// Overview, Tasks, Projects and Settings.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-axe-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));
const state = emptyState();
for (let i = 1; i <= 4; i++) {
  const id = `T-00${i}`;
  state.tasks[id] = { id, title: `Accessibility fixture ${i}`, objective: "Rendered fixtures for the accessibility audit.", status: i === 1 ? "in_progress" : "new", completion_checks: ["Rendered fixture check"], evidence: [], priority: "normal", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}
saveState(root, state);

let browser, server;
try {
  const started = await startControlPlaneServer(root);
  server = started.server;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  await page.goto(started.url);
  await page.waitForSelector("#navA .nav");
  await page.addScriptTag({ content: axeSource });

  const runAxe = async (label, action) => {
    if (action) await action();
    // Allow the debounced render + snapshot refresh to settle.
    await page.waitForTimeout(700);
    const results = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
    const bad = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
    for (const violation of bad) {
      console.error(`${label}: ${violation.id} (${violation.impact}) — ${violation.help}`);
      for (const node of violation.nodes.slice(0, 4)) console.error(`   ${node.target.join(" ")}`);
    }
    assert.equal(bad.length, 0, `${label} has critical/serious axe violations`);
    console.log(`PASS: ${label} has no critical or serious axe violations (${results.violations.length} total)`);
  };

  await runAxe("Overview");
  await runAxe("Tasks", () => page.locator('[data-page="tasks"]:visible').first().click());
  // The New task dialog is the highest-risk form (issue #32 unlabelled fields).
  await runAxe("New task dialog", async () => { await page.locator("#newBtn").click(); await page.getByRole("dialog").waitFor(); });
  await page.keyboard.press("Escape");
  await runAxe("Projects", () => page.locator('[data-page="projects"]:visible').first().click());
  await runAxe("Settings", () => page.locator('[data-page="settings"]:visible').first().click());
  console.log("ALL OK: accessibility audit");
} finally {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
