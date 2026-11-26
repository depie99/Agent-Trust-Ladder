// Daemon ownership races (#72): concurrent starts must produce exactly one
// owner, a hung (SIGSTOP'd) daemon must be distinguishable from a dead one,
// and a stale record pointing at an unrelated live server must never be
// signaled by stopDaemon.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalRoot, daemonFile, daemonStatus, ensureDaemon, stopDaemon } from "../runtime/lib/daemon.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { emptyState, saveState } from "../runtime/lib/state.mjs";

const project = fs.mkdtempSync(path.join(os.tmpdir(), "atl-daemon-race-"));
fs.mkdirSync(path.join(project, "config"), { recursive: true });
fs.writeFileSync(path.join(project, "config", "manager.json"), JSON.stringify({ version: 1 }));
saveState(project, emptyState());

try {
  // 1. N concurrent starters land on exactly one daemon.
  const starters = await Promise.all(Array.from({ length: 5 }, () => ensureDaemon(project, { waitMs: 30000 })));
  const pids = new Set(starters.map((entry) => String(entry.record?.pid)));
  const urls = new Set(starters.map((entry) => entry.url));
  assert.equal(pids.size, 1, `concurrent ensureDaemon must agree on one owner pid, got ${[...pids].join(",")}`);
  assert.equal(urls.size, 1, "every starter must receive the same Control Plane URL");
  const after = await daemonStatus(project);
  assert.equal(after.alive, true, "the winner keeps serving after the start race");
  assert.equal(after.record.port, (await import("../runtime/lib/daemon.mjs")).deterministicPort(canonicalRoot(project)), "the owner owns the deterministic port, not an orphan's ephemeral one");

  // 2. A hung daemon (pid alive, health failing) is alive:false + pid_alive:true.
  if (process.platform !== "win32") {
    const { default: obs } = { default: null };
    process.kill(after.record.pid, "SIGSTOP");
    let hung;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      hung = await daemonStatus(project);
      if (hung.alive === false && hung.pid_alive === true) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(hung.alive, false, "a hung daemon must not be reported alive");
    assert.equal(hung.pid_alive, true, "a hung daemon's pid is still alive and reported as such");
    assert.equal(hung.responsive, false, "a hung daemon is explicitly not responsive");
    process.kill(after.record.pid, "SIGCONT");
    let revived;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      revived = await daemonStatus(project);
      if (revived.alive === true) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(revived.alive, true, "the daemon resumes serving after SIGCONT");
  }

  // 3. stopDaemon against a stale record whose port serves another project
  //    refuses and leaves the unrelated process running.
  const bystander = fs.mkdtempSync(path.join(os.tmpdir(), "atl-daemon-bystander-"));
  fs.mkdirSync(path.join(bystander, "config"), { recursive: true });
  fs.writeFileSync(path.join(bystander, "config", "manager.json"), JSON.stringify({ version: 1 }));
  saveState(bystander, emptyState());
  const innocent = await startControlPlaneServer(bystander, { port: 0 });
  try {
    const health = await fetch(`${innocent.url}api/health`).then((r) => r.json());
    const stale = { pid: health.pid, port: innocent.port, url: innocent.url, started_at: Date.now() - 60000, heartbeat_at: Date.now() - 30000, runtime: health.runtime || null, lease: null, embed_tokens: [] };
    fs.mkdirSync(path.join(project, ".atl"), { recursive: true });
    // Detach the real owner first so only the stale record remains.
    await stopDaemon(project);
    fs.writeFileSync(daemonFile(project), JSON.stringify(stale), "utf8");
    const refused = await stopDaemon(project);
    assert.equal(refused.stopped, false, "a record pointing at a foreign project is not stopped");
    assert.equal(refused.identityMismatch, true, "the mismatch is identified and the stale record cleared");
    const stillServing = await fetch(`${innocent.url}api/health`).then((r) => r.json());
    assert.equal(stillServing.pid, health.pid, "the unrelated server was never signaled");
    assert.equal(fs.existsSync(daemonFile(project)), false, "the stale record is removed instead of killing a foreign pid");
  } finally {
    await new Promise((resolve) => innocent.server.close(resolve));
    fs.rmSync(bystander, { recursive: true, force: true });
  }

  await stopDaemon(project);
  const gone = await daemonStatus(project);
  assert.equal(gone.alive, false, "the daemon is stopped for the teardown");
  console.log("PASS: concurrent starts agree on one owner; hung vs dead is distinguishable; stale records never signal an unrelated pid");
} finally {
  fs.rmSync(project, { recursive: true, force: true });
}
