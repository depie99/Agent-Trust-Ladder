import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Issue #31: parallel writers used one temp path with no lock and dropped
// tasks. Every concurrent compose must either save or exit non-zero, and a
// writer holding a stale revision must be rejected instead of overwriting.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manager = path.join(repo, "runtime", "atl-manager.mjs");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "atl-state-race-"));
fs.mkdirSync(path.join(project, ".git"), { recursive: true });
const env = { ...process.env, ATL_PROJECT: project };

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [manager, ...args], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => resolve({ status: code, stderr }));
  });
}

try {
  const init = await run(["init"]);
  assert.equal(init.status, 0, `init failed: ${init.stderr}`);

  const writers = 20;
  const results = await Promise.all(Array.from({ length: writers }, (_, i) => run(["compose", "--title", `race ${i + 1}`, `body ${i + 1}`])));
  const failed = results.filter((r) => r.status !== 0);
  const state = JSON.parse(fs.readFileSync(path.join(project, ".trust", "manager", "state.json"), "utf8"));
  const saved = Object.keys(state.tasks).length;
  assert.equal(saved + failed.length, writers, `lost writes: ${saved} saved, ${failed.length} failed with: ${failed.map((f) => f.stderr.slice(0, 120)).join(" | ")}`);
  assert.equal(saved, writers, `expected ${writers} tasks, found ${saved}`);

  // A second writer that read a stale revision must fail loudly instead of
  // silently overwriting the first writer's task.
  const { loadState, saveState } = await import("../runtime/lib/state.mjs");
  const stale = loadState(project);
  saveState(project, loadState(project));
  assert.throws(() => saveState(project, stale), /revision conflict/, "stale writer was accepted");
  const after = loadState(project);
  assert.equal(Object.keys(after.tasks).length, writers, "conflict detection dropped tasks");

  console.log(`PASS: ${writers} parallel composes all persist and stale revisions are rejected`);
} finally {
  fs.rmSync(project, { recursive: true, force: true });
}
