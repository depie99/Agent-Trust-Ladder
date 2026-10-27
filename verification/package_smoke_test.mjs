import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const scratchRoot = path.join(root, ".trust", "package-smoke");
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, "run-"));
let child, browser;
try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packed = JSON.parse(execFileSync(npm, ["pack", "--json", "--pack-destination", scratch], { cwd: root, encoding: "utf8", shell: process.platform === "win32" }));
  execFileSync("tar", ["-xf", path.join(scratch, packed[0].filename), "-C", scratch]);
  const cli = path.join(scratch, "package", "runtime", "atl-manager.mjs");
  const project = path.join(scratch, "project"); fs.mkdirSync(project);
  const env = { ...process.env, ATL_PROJECT: project, ATL_HOME: path.join(scratch, "home"), ATL_NO_OPEN: "1" };
  execFileSync(process.execPath, [cli, "init"], { cwd: project, env, stdio: "pipe" });
  child = spawn(process.execPath, [cli, "ui-refresh", "--port", "0"], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let output = ""; const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 15000);
    child.stdout.on("data", (chunk) => { output += chunk; const match = output.match(/ATL browser control plane: (http:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  const assistant = await fetch(`${url}api/assistant`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "read", scope: "global" }) });
  assert.equal(assistant.status, 200); assert.equal((await assistant.json()).session.status, "idle");
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator('[data-page="studio"]').first().click();
  await page.getByRole("button", { name: /Generate local/i }).click();
  assert.ok(await page.locator("#content").isVisible());
  console.log(`PASS: packed ATL initializes a fresh project and serves its UI and assistant API on ${url}`);
} finally {
  if (browser) await browser.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  fs.rmSync(scratch, { recursive: true, force: true });
}
