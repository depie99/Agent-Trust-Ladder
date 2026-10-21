import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-install-test-"));
try {
  execFileSync(process.execPath, [path.join(repo, "scripts", "install.mjs"), "--no-path"], {
    cwd: repo,
    env: { ...process.env, ATL_HOME: home },
    stdio: "pipe",
  });
  assert.ok(fs.existsSync(path.join(home, "config", "manager-state-contract.json")));
  assert.ok(fs.existsSync(path.join(home, "config", "skill-routing.json")));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "atl-project-test-"));
  execFileSync(process.execPath, [path.join(home, "runtime", "atl-manager.mjs"), "init"], {
    cwd: project,
    env: { ...process.env, ATL_PROJECT: project },
    stdio: "pipe",
  });
  assert.ok(fs.existsSync(path.join(project, ".trust", "manager", "state.json")));
  assert.equal(fs.existsSync(path.join(project, ".humanlayer")), false);
  fs.rmSync(project, { recursive: true, force: true });
  console.log("PASS: installed ATL runtime carries its contract and initializes a clean project");
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
