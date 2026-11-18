// Issue #34, part 1: one state owner per project.
// The daemon owns state.json; a foreign process without a writer lease is
// refused; the CLI self-heals by leasing; the URL is stable across restarts;
// the bootstrap path (no live daemon) keeps working for tests and scripts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDaemon, daemonStatus, stopDaemon, deterministicPort, canonicalRoot, daemonFile, writerGate } from "../runtime/lib/daemon.mjs";
import { loadState, saveState, hasWrittenState } from "../runtime/lib/state.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manager = path.join(repo, "runtime", "atl-manager.mjs");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "atl-daemon-"));
fs.mkdirSync(path.join(project, ".git"), { recursive: true });

function run(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [manager, ...args], {
      cwd: project,
      env: { ...process.env, ATL_PROJECT: project, ATL_NO_OPEN: "1", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

try {
  const init = await run(["init"]);
  assert.equal(init.status, 0, `init failed: ${init.stderr}`);

  // 1. Start the owner; record + health must identify this project.
  const first = await ensureDaemon(project, { waitMs: 30000 });
  assert.equal(first.reused, false, "expected a fresh daemon for a new project");
  // The port is derived from the canonical root (realpath — on macOS os.tmpdir()
  // spells /var/folders/… while the daemon sees /private/var/folders/…), so the
  // expectation must canonicalize the same way the daemon does.
  assert.equal(first.url, `http://127.0.0.1:${deterministicPort(canonicalRoot(project))}/`, "URL must be the deterministic per-project port");
  const record = JSON.parse(fs.readFileSync(daemonFile(project), "utf8"));
  assert.equal(record.pid, first.record.pid, "record pid must be the owner process");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(daemonFile(project)).mode & 0o777, 0o600, "daemon record holds a lease capability and must not be world-readable");
  }

  // 2. Reuse: a second ensure returns the same URL without spawning a second owner.
  const second = await ensureDaemon(project, { waitMs: 30000 });
  assert.equal(second.reused, true, "expected reuse of the live owner");
  assert.equal(second.url, first.url, "stable Control Plane URL per project");
  assert.equal(second.record.pid, first.record.pid, "reuse must not start a second owner process");

  // 3. Single writer: this test process is foreign (no lease) — saveState refuses.
  const state = loadState(project);
  assert.throws(() => saveState(project, state), /state is owned by the project daemon/, "a foreign direct write must be refused");
  assert.equal(writerGate(project).verdict, "denied", "writer gate must deny a leaseless foreign writer");

  // 4. CLI self-heal: a mutating command leases from the owner and succeeds.
  const compose = await run(["compose", "--title", "leased task", "body"]);
  assert.equal(compose.status, 0, `compose must self-heal through a writer lease: ${compose.stderr || compose.stdout}`);
  const leased = loadState(project);
  assert.ok(Object.values(leased.tasks).some((task) => task.title === "leased task"), "the leased write must persist");

  // 5. Two concurrent mutating commands serialize on the exclusive lease; both land.
  const pair = await Promise.all([
    run(["compose", "--title", "race A", "body a"]),
    run(["compose", "--title", "race B", "body b"]),
  ]);
  for (const [index, result] of pair.entries()) {
    assert.equal(result.status, 0, `concurrent compose ${index} must lease and succeed: ${result.stderr || result.stdout}`);
  }
  const raced = loadState(project);
  const titles = Object.values(raced.tasks).map((task) => task.title);
  for (const expected of ["race A", "race B"]) assert.ok(titles.includes(expected), `lost write under the lease: missing ${expected}`);

  // 6. A read-only command never needs the lease.
  const show = await run(["show"]);
  assert.equal(show.status, 0, `read-only show must not need a lease: ${show.stderr || show.stdout}`);

  // 7. The daemon surface: status reports the owner; a recorded lease, if
  // still inside its TTL window, must be masked (no token leak).
  const status = await run(["daemon", "status"]);
  assert.equal(status.status, 0, `daemon status failed: ${status.stderr}`);
  const statusBody = JSON.parse(status.stdout);
  assert.equal(statusBody.alive, true, "daemon status must report a live owner");
  assert.equal(statusBody.record.pid, first.record.pid, "daemon status must identify the owner");
  if (statusBody.record.lease) assert.ok(!statusBody.record.lease.token, "status must not leak the lease token");

  // 8. Bootstrap path: with the owner stopped, direct writes work again.
  const stopped = await run(["daemon", "stop"]);
  assert.equal(stopped.status, 0, `daemon stop failed: ${stopped.stderr}`);
  const afterStop = await daemonStatus(project);
  assert.equal(afterStop.alive, false, "owner must be gone after stop");
  saveState(project, loadState(project)); // revision bump, direct write
  assert.equal(hasWrittenState(), true, "bootstrap write after stop must succeed");
  const revived = await ensureDaemon(project, { waitMs: 30000 });
  assert.equal(revived.url, first.url, "the URL must be stable across daemon restarts");
  await stopDaemon(project);

  console.log("PASS: one state owner per project — reuse, stable URL, lease gate, CLI self-heal, serialization, bootstrap fallback");
} finally {
  await stopDaemon(project).catch(() => {});
  // The owner's cwd is the temp project; Windows releases the directory
  // handle a beat after the process dies. Cleanup must never mask the
  // verdict — a leftover temp dir under os.tmpdir() is harmless.
  try { fs.rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
  catch (error) { console.log(`note: temp dir cleanup deferred (${error.code}); the OS clears it`); }
}
