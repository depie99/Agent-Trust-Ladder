import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Synchronous transactions only: never hold this lock across provider calls.
export function withFileLock(file, fn, timeoutMs = 10000) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`, token = crypto.randomUUID();
  const deadline = Date.now() + timeoutMs;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: Date.now() })); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (probe) { alive = probe.code === 'EPERM'; }
        if (!alive && Date.now() - owner.at > 1000) fs.rmSync(lock, { force: true });
      } catch { /* an owner may still be writing */ }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for transaction: ${file}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); }
  finally {
    fs.closeSync(fd);
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.rmSync(lock, { force: true }); } catch { /* never remove another owner's lock */ }
  }
}
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    for (let i = 0;; i++) {
      try { fs.renameSync(tmp, file); break; }
      catch (error) { if (error.code !== 'EPERM' || i >= 8) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (i + 1)); }
    }
  } finally { fs.rmSync(tmp, { force: true }); }
}
