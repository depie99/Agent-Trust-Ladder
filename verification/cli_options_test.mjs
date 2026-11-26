import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyState, saveState } from "../runtime/lib/state.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-cli-options-"));
const entry = fileURLToPath(new URL("../runtime/atl-manager.mjs", import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [entry, ...args], {
  encoding: "utf8", timeout: 10000,
  env: { ...process.env, ATL_PROJECT: root, ATL_HOME: path.join(root, "home") },
});
const session = (...args) => cli("session", "start", "T-001", "--actor", "rowan", ...args);

try {
  const state = emptyState();
  state.tasks["T-001"] = { id: "T-001", title: "Fixture" };
  saveState(root, state);
  for (const args of [["--ttl"], ["--ttl="], ["--ttl", "30x"], ["--ttl=25h"]]) {
    const result = session(...args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /--ttl (requires|must be between)/);
  }
  const now = Date.now();
  const issued = cli("session", "start", "--unused", "not-a-task", "T-001", "--actor", "rowan", "--ttl", "30m");
  assert.equal(issued.status, 0, issued.stderr);
  assert.match(issued.stderr, /unrecognized option --unused ignored/);
  const expiry = JSON.parse(issued.stdout.match(/ATL_WORKER_CREDENTIAL='([^']+)'/)[1]).expires_at;
  assert.ok(Math.abs(Date.parse(expiry) - now - 30 * 60_000) < 10_000);
  for (const keyArgs of [["--key", "fixture-secret"], ["--key=fixture-secret"]]) {
    const result = cli("provider", "add", "fixture", ...keyArgs);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /--key is not accepted/);
    assert.doesNotMatch(result.stderr + result.stdout, /fixture-secret/);
  }
  console.log("PASS: CLI validates TTL, isolates unknown options, and refuses keys in argv");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
