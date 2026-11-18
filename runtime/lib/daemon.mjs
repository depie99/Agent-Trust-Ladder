// One state owner per project (issue #34).
//
// The first session-forming entry point (`atl ui`, the plugin's
// atl_control_plane/atl_start) starts or reuses a small per-project server and
// records its port and pid in <root>/.atl/daemon.json. The CLI, atl_command and
// the Control Plane become clients of that owner: state.json is written only by
// the owner process or by a process holding the owner's writer lease, while the
// file lock + revision compare-and-swap in state.mjs stay as the last line of
// defense. When no daemon record exists — tests, one-shot scripts, a crashed
// owner — the pre-daemon direct-write path remains, so nothing goes offline.
//
// Two locks with distinct jobs:
//   - <file>.lock        guards record read-modify-write (claim, lease, beat).
//   - <file>.start.lock  elects the single spawner in ensureDaemon; the record
//                        lock is NEVER held while waiting on a child, because
//                        the child needs that lock to claim ownership.
//
// This module deliberately imports nothing from state.mjs or the control-plane
// server: both of those import it, and the lease/record file operations must
// work in any process (owner, CLI client, verifier) without loading the server
// graph.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

// daemon.mjs lives at <bundle>/runtime/lib/daemon.mjs: the runtime directory
// (for spawning the owner) and the bundle root (for identity files) differ.
const RUNTIME_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUNDLE_ROOT = path.dirname(RUNTIME_DIR);

// A lease whose holder stopped renewing is reclaimed after this grace period.
export const LEASE_TTL_MS = 120000;
// The daemon refreshes heartbeat_at at half this interval; a record whose pid
// is alive but whose heartbeat is stale is treated as dead (pid reuse or a hung
// owner) and the pre-daemon write path resumes.
export const HEARTBEAT_MAX_AGE_MS = 90000;
// How long the CLI waits for a busy lease before failing with holder details.
export const LEASE_WAIT_MS_DEFAULT = 30000;

export function daemonFile(root) {
  return path.join(root, ".atl", "daemon.json");
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// A deterministic port makes the Control Plane URL stable across daemon
// restarts (issue #34: "a stable Control Plane URL per project"). Collisions
// degrade to an ephemeral port rather than failing.
export function deterministicPort(canonicalRoot) {
  return 47100 + (fnv1a(canonicalRoot.toLowerCase()) % 800);
}

export function canonicalRoot(root) {
  try { return fs.realpathSync(root); } catch { return path.resolve(root); }
}

// True when two runtime identities are the same build (issue #34: the CLI,
// the plugin and the Control Plane report the same version and commit, or
// warn when they differ).
export function sameRuntime(a, b) {
  if (!a || !b) return false;
  return a.version === b.version && (a.commit || null) === (b.commit || null);
}

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

// Version identity for one-runtime reporting (issue #34: CLI, plugin and
// Control Plane report the same version and commit, or warn when they differ).
export function runtimeIdentity(installDir = BUNDLE_ROOT) {
  const read = (file) => { try { return JSON.parse(fs.readFileSync(path.join(installDir, file), "utf8")); } catch { return null; } };
  const pkg = read("package.json") || {};
  const source = read("source.json") || read("atl-release.json") || {};
  const manifest = read(path.join(".codex-plugin", "plugin.json")) || {};
  return {
    version: pkg.version || "unknown",
    commit: source.commit || null,
    manifestVersion: manifest.version || null,
  };
}

function readRecord(root) {
  try { return JSON.parse(fs.readFileSync(daemonFile(root), "utf8")); } catch { return null; }
}

function writeRecord(root, record) {
  const file = daemonFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); break; }
    catch (error) {
      if (error.code !== "EPERM" || attempt >= 6) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } throw error; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
    }
  }
}

// Only remove a lock whose recorded owner is this process: a stolen lock path
// must never be deleted out from under its new owner. No `return` in a
// caller's finally — a helper cannot swallow an exception from fn().
function releaseLock(lock) {
  try {
    const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
    if (owner.pid !== process.pid) return;
  } catch { return; }
  fs.rmSync(lock, { force: true });
}

function withLock(lock, fn) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 10000;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, "wx", 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: Date.now() })); }
    catch (error) {
      if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (probe) { alive = probe.code === "EPERM"; }
        if (!alive && Date.now() - Number(owner.created_at || 0) > 1000) fs.rmSync(lock, { force: true });
      } catch { /* lock owner may still be writing metadata */ }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for lock ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); } finally { fs.closeSync(fd); releaseLock(lock); }
}

const withRecordLock = (root, fn) => withLock(`${daemonFile(root)}.lock`, fn);
const withStartLock = (root, fn) => withLock(`${daemonFile(root)}.start.lock`, fn);

// Mutate the record under the record lock. fn receives the current record (or
// null) and returns the next record; returning null removes the file.
export function updateRecord(root, fn) {
  return withRecordLock(root, () => {
    const next = fn(readRecord(root));
    const file = daemonFile(root);
    if (next === null) { fs.rmSync(file, { force: true }); return null; }
    writeRecord(root, next);
    return next;
  });
}

export function heartbeatFresh(record, now = Date.now()) {
  const at = Number(record?.heartbeat_at || 0);
  return at > 0 && now - at < HEARTBEAT_MAX_AGE_MS;
}

export function leaseUsable(record, token, now = Date.now()) {
  const lease = record?.lease;
  return Boolean(token && lease && lease.token === token && Number(lease.expires_at || 0) > now);
}

// The synchronous half of the single-writer gate, evaluated per save by
// state.mjs. The health probe (asynchronous, authoritative) runs in
// ensureDaemon and daemonStatus; here the heartbeat stands in for it so saves
// never wait on HTTP.
export function writerGate(root, { pid = process.pid, token = process.env.ATL_WRITER_LEASE, now = Date.now() } = {}) {
  const record = readRecord(root);
  if (!record) return { verdict: "bootstrap" };
  const ownerPid = Number(record.pid || 0);
  if (!ownerPid) return { verdict: "bootstrap" };
  if (ownerPid === pid) return { verdict: "owner" };
  if (!pidAlive(ownerPid)) return { verdict: "bootstrap" };
  if (!heartbeatFresh(record, now)) return { verdict: "bootstrap" };
  if (leaseUsable(record, token, now)) return { verdict: "lease" };
  const holder = record.lease && Number(record.lease.expires_at || 0) > now
    ? `pid ${record.lease.pid} (${String(record.lease.argv || "unknown command").slice(0, 120)})`
    : "no active writer lease";
  return {
    verdict: "denied",
    ownerPid,
    message: `state is owned by the project daemon (pid ${ownerPid}, writer lease: ${holder}); `
      + `the atl CLI acquires a lease automatically — run the command again to retry, or stop the daemon with: atl daemon stop`,
  };
}

export async function probeHealth(url, { project, timeoutMs = 900 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/health", url), { signal: controller.signal });
    if (!response.ok) return { alive: false };
    const body = await response.json();
    return {
      alive: body?.ok === true,
      project: body?.project || null,
      pid: Number(body?.pid || 0),
      runtime: body?.runtime || null,
      projectMatch: project ? body?.project === project : null,
    };
  } catch { return { alive: false }; }
  finally { clearTimeout(timer); }
}

async function healthForPort(port, project) {
  return probeHealth(`http://127.0.0.1:${port}/`, { project });
}

// Wait for a freshly spawned owner to record itself and answer health checks.
async function waitForRecord(root, { deadlineMs = 15000 } = {}) {
  const canonical = canonicalRoot(root);
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const record = readRecord(root);
    if (record && Number(record.pid || 0) !== process.pid && pidAlive(Number(record.pid))) {
      const health = await probeHealth(`http://127.0.0.1:${record.port}/`, { project: canonical });
      if (health.alive && health.projectMatch !== false) return record;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  return null;
}

function maskLease(lease) {
  if (!lease) return null;
  const { token, ...rest } = lease;
  return { ...rest, token_present: Boolean(token) };
}

// Read-only owner status. When called while the caller already holds the
// record lock (`locked: true`), cleanup skips nested lock acquisition — the
// lock helper is not reentrant.
export async function daemonStatus(root, { locked = false } = {}) {
  const canonical = canonicalRoot(root);
  const clearRecord = () => {
    if (locked) fs.rmSync(daemonFile(root), { force: true });
    else withRecordLock(root, () => { fs.rmSync(daemonFile(root), { force: true }); });
  };
  const record = readRecord(root);
  if (!record) return { alive: false, record: null, project: canonical };
  const pid = Number(record.pid || 0);
  if (!pid || !pidAlive(pid)) {
    clearRecord();
    return { alive: false, record: null, project: canonical };
  }
  const health = await probeHealth(`http://127.0.0.1:${record.port}/`, { project: canonical });
  if (health.alive && health.projectMatch === false) {
    // The recorded pid was reused by another process, or the port now serves a
    // different project: the record is stale either way.
    clearRecord();
    return { alive: false, record: null, project: canonical };
  }
  if (health.alive && !heartbeatFresh(record)) {
    // Server responds but the heartbeat died: refresh it so the synchronous
    // writer gate in state.mjs keeps recognizing the owner.
    try { updateRecord(root, (current) => (current && current.pid === record.pid ? { ...current, heartbeat_at: Date.now() } : current)); }
    catch { /* someone else holds the record lock; their write wins */ }
  }
  return {
    alive: true,
    record: { ...record, lease: maskLease(record.lease) },
    health,
    project: canonical,
    url: `http://127.0.0.1:${record.port}/`,
    runtime: record.runtime || health.runtime || null,
  };
}

// Adopt a server that already answers health checks for this project but has
// no usable record (lost file, cross-version transition). Without adoption a
// second owner would race the first for writes.
function adoptRecord(root, health, canonical, url) {
  if (!health.alive || !health.pid || !pidAlive(health.pid)) return false;
  try {
    updateRecord(root, (record) => {
      if (record && Number(record.pid || 0) !== health.pid && pidAlive(Number(record.pid)) && heartbeatFresh(record)) return record;
      return {
        pid: health.pid,
        port: Number(new URL(url).port) || Number(record?.port) || 0,
        url,
        project: canonical,
        runtime: health.runtime || null,
        started_at: new Date().toISOString(),
        heartbeat_at: Date.now(),
        lease: record?.lease || null,
        adopted: true,
      };
    });
    return true;
  } catch { return false; }
}

// The panel embed capability (issue #34 follow-on): hosts embed the Control
// Plane with a per-session token. The old model shipped it in the server
// process env, which cannot work for a reused daemon — the current session's
// token lives in the owner record instead. Direct (non-daemon) servers still
// honor the env var for compatibility.
export function readEmbedToken(root) {
  try { return JSON.parse(fs.readFileSync(daemonFile(root), "utf8"))?.embed_token || null; } catch { return null; }
}

// Start or reuse the per-project owner. Deterministic port first; if the port
// is held by a control plane for another project, fall back to an ephemeral
// port so two projects never fight over one slot.
export async function ensureDaemon(root, { port = null, host = "127.0.0.1", waitMs = 15000, embedToken = null } = {}) {
  const canonical = canonicalRoot(root);
  const existing = await daemonStatus(root);
  if (existing.alive) return finishWithEmbedToken({ ...existing, reused: true }, embedToken, root);

  const preferredPort = port ?? deterministicPort(canonical);
  const squatter = await healthForPort(preferredPort, canonical);
  if (squatter.alive && squatter.projectMatch === true && (await adoptRecord(root, squatter, canonical, `http://127.0.0.1:${preferredPort}/`))) {
    return { ...await daemonStatus(root), reused: true, adopted: true };
  }
  const childPort = squatter.alive && squatter.projectMatch === false ? 0 : preferredPort;

  return withStartLock(root, async () => {
    // Another process may have started the owner while we waited on the lock.
    const raced = await daemonStatus(root, { locked: false });
    if (raced.alive) return finishWithEmbedToken(raced, embedToken, root);
    // Re-check adoption: a sibling ensureDaemon may have adopted or spawned.
    if (squatter.alive && squatter.projectMatch === true && (await adoptRecord(root, squatter, canonical, `http://127.0.0.1:${preferredPort}/`))) {
      return finishWithEmbedToken({ ...await daemonStatus(root, { locked: false }), reused: true, adopted: true }, embedToken, root);
    }

    const child = spawn(process.execPath, [path.join(RUNTIME_DIR, "atl-manager.mjs"), "ui", "--no-open", "--host", host, "--port", String(childPort)], {
      cwd: canonical,
      env: { ...process.env, ATL_PROJECT: canonical, ATL_NO_OPEN: "1", ATL_DAEMON_CHILD: "1" },
      // Detached on every platform: the owner must outlive the host process
      // that started it (a plugin session, a connect assistant, a CLI one-shot
      // all exit; issue #34). windowsHide keeps the Windows console invisible.
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref?.();
    const record = await waitForRecord(root, { deadlineMs: waitMs });
    if (!record) {
      throw new Error(`ATL project daemon did not start within ${Math.round(waitMs / 1000)}s for ${canonical}`);
    }
    return finishWithEmbedToken({ ...await daemonStatus(root, { locked: false }), reused: false }, embedToken, root);
  });
}

function finishWithEmbedToken(status, embedToken, root) {
  if (embedToken) {
    try { updateRecord(root, (record) => (record ? { ...record, embed_token: embedToken } : record)); }
    catch { /* panel embedding falls back to the previous token or cookies */ }
  }
  return status;
}

export async function stopDaemon(root) {
  const canonical = canonicalRoot(root);
  const record = readRecord(root);
  if (!record) return { stopped: false, wasAlive: false };
  const pid = Number(record.pid || 0);
  const health = await probeHealth(`http://127.0.0.1:${record.port}/`, { project: canonical });
  if (!pid || !pidAlive(pid) || (health.alive && health.projectMatch === false)) {
    withRecordLock(root, () => { fs.rmSync(daemonFile(root), { force: true }); });
    return { stopped: false, wasAlive: Boolean(pid && pidAlive(pid)) };
  }
  if (health.alive && health.projectMatch === true) {
    // Ask politely first so the owner can flush and clear its own record.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      await fetch(new URL("/api/daemon/shutdown", `http://127.0.0.1:${record.port}/`), { method: "POST", signal: controller.signal });
      clearTimeout(timer);
    } catch { /* fall through to signal */ }
  }
  try { process.kill(pid); } catch { /* already gone */ }
  const deadline = Date.now() + 5000;
  while (pidAlive(pid) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  withRecordLock(root, () => { fs.rmSync(daemonFile(root), { force: true }); });
  return { stopped: true, wasAlive: true };
}

// ---- Writer lease (exclusive, TTL-renewed, inherited by the holder's children) ----

export async function acquireWriterLease(root, { pid = process.pid, argv = [], ttlMs = LEASE_TTL_MS, waitMs = LEASE_WAIT_MS_DEFAULT } = {}) {
  const deadline = Date.now() + waitMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const status = await daemonStatus(root);
    if (!status.alive) throw new Error("no live project daemon to lease from — the direct-write path applies instead");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(new URL("/api/daemon/lease", status.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, argv, ttl_ms: ttlMs }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.ok) return { token: body.token, expires_at: body.expires_at, url: status.url };
      lastError = new Error(body?.error || `lease request failed with HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    finally { clearTimeout(timer); }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`writer lease busy: ${lastError?.message || "timed out"}`);
}

export async function renewWriterLease(root, token, { ttlMs = LEASE_TTL_MS } = {}) {
  const status = await daemonStatus(root);
  if (!status.alive) return false;
  try {
    const response = await fetch(new URL("/api/daemon/lease/renew", status.url), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ttl_ms: ttlMs }),
    });
    return response.ok;
  } catch { return false; }
}

export async function releaseWriterLease(root, token) {
  const status = await daemonStatus(root);
  if (!status.alive) return;
  try {
    await fetch(new URL("/api/daemon/lease/release", status.url), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch { /* the TTL reclaims an unreleased lease */ }
}

// Lease record mutations, called from the owner's HTTP endpoints.
export function grantLeaseRecord(root, { pid, argv, ttlMs }) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) throw new Error("lease requires the holder pid");
  return updateRecord(root, (record) => {
    if (!record) throw new Error("no daemon record — leases belong to a live project daemon");
    const now = Date.now();
    const current = record.lease;
    if (current && Number(current.expires_at || 0) > now && pidAlive(Number(current.pid || 0))) {
      const error = new Error(`writer lease held by pid ${current.pid} (${String(current.argv || "unknown command").slice(0, 120)}) until ${new Date(Number(current.expires_at)).toISOString()}`);
      error.statusCode = 409;
      throw error;
    }
    const lease = { token: crypto.randomUUID(), pid: Number(pid), argv: String(argv || "").slice(0, 200), granted_at: now, expires_at: now + Math.max(1000, Math.min(600000, Number(ttlMs) || LEASE_TTL_MS)) };
    return { ...record, lease };
  });
}

export function renewLeaseRecord(root, token, { ttlMs } = {}) {
  return updateRecord(root, (record) => {
    if (!record?.lease || record.lease.token !== token) throw new Error("unknown writer lease token");
    const now = Date.now();
    if (Number(record.lease.expires_at || 0) <= now && !pidAlive(Number(record.lease.pid || 0))) throw new Error("writer lease expired");
    return { ...record, lease: { ...record.lease, expires_at: now + Math.max(1000, Math.min(600000, Number(ttlMs) || LEASE_TTL_MS)) } };
  });
}

export function releaseLeaseRecord(root, token) {
  return updateRecord(root, (record) => {
    if (!record?.lease || record.lease.token !== token) return record;
    const { lease, ...rest } = record;
    return rest;
  });
}

// Owner lifecycle record helpers, called by the `ui` command process.
export function claimOwnerRecord(root, { port, url, runtime }) {
  const canonical = canonicalRoot(root);
  return updateRecord(root, (record) => {
    const now = Date.now();
    // A fresh owner must not overwrite a live one: ui children raced on the
    // deterministic port and the loser exits instead.
    if (record && Number(record.pid || 0) !== process.pid && pidAlive(Number(record.pid)) && heartbeatFresh(record, now)) {
      const error = new Error(`another project daemon (pid ${record.pid}) already owns ${canonical}`);
      error.statusCode = 409;
      throw error;
    }
    return {
      pid: process.pid,
      port,
      url,
      project: canonical,
      runtime,
      started_at: new Date(now).toISOString(),
      heartbeat_at: now,
      lease: null,
    };
  });
}

export function beatOwnerRecord(root) {
  try {
    updateRecord(root, (record) => (record && Number(record.pid) === process.pid ? { ...record, heartbeat_at: Date.now() } : record));
  } catch { /* a transient lock race must never kill the owner; next beat recovers */ }
}

export function releaseOwnerRecord(root) {
  try {
    updateRecord(root, (record) => (record && Number(record.pid) === process.pid ? null : record));
  } catch { /* same: best effort */ }
}
