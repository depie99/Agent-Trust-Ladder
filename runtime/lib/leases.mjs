// Durable session leases with fencing generations. A late worker can still
// exit, but its result is rejected by the generation check before mutation.
import path from "node:path";
import crypto from "node:crypto";
import { withFileLock, readJson, atomicJson } from "./file-transaction.mjs";

const leaseFile = (root) => path.join(root, ".trust", "manager", "leases.json");
const empty = () => ({ version: 1, revision: 0, sessions: {} });
function load(root) { return readJson(leaseFile(root), empty()); }
function save(root, book) { book.revision++; atomicJson(leaseFile(root), book); }
export function acquireLease(root, { project, task, role, run, ttlMs = 30000 }) { return withFileLock(leaseFile(root), () => {
  const book = load(root); const key = `${project}:${task}`; const current = book.sessions[key];
  if (current && current.expires_at > Date.now()) throw new Error(`active lease exists for ${task}`);
  const generation = (current?.generation || 0) + 1; const lease = { id: `L-${crypto.randomUUID()}`, key, project, task, role, run, generation, heartbeat_at: Date.now(), expires_at: Date.now() + ttlMs, status: "active" };
  book.sessions[key] = lease; save(root, book); return lease;
 }); }
export function heartbeatLease(root, lease, { ttlMs = 30000 } = {}) { return withFileLock(leaseFile(root), () => { const book = load(root); const current = book.sessions[lease.key]; if (!current || current.id !== lease.id || current.generation !== lease.generation) throw new Error("stale lease fencing token"); current.heartbeat_at = Date.now(); current.expires_at = Date.now() + ttlMs; save(root, book); return current;  }); }
export function releaseLease(root, lease) { return withFileLock(leaseFile(root), () => { const book = load(root); const current = book.sessions[lease.key]; if (!current || current.id !== lease.id || current.generation !== lease.generation) return false; current.status = "released"; current.released_at = Date.now(); current.expires_at = 0; save(root, book); return true;  }); }
export function activeLeaseId(root, task, now = Date.now()) {
  return Object.values(load(root).sessions).find((lease) => lease.task === task && lease.status === "active" && lease.expires_at > now)?.id ?? null;
}
export function leaseAllows(root, lease) { const current = load(root).sessions[lease.key]; return Boolean(current && current.id === lease.id && current.generation === lease.generation && current.status === "active" && current.expires_at > Date.now()); }
export function reconcileLeases(root, now = Date.now()) { return withFileLock(leaseFile(root), () => { const book = load(root); const expired = []; for (const lease of Object.values(book.sessions)) if (lease.status === "active" && lease.expires_at <= now) { lease.status = "expired"; lease.expired_at = now; expired.push(lease); } if (expired.length) save(root, book); return { expired, sessions: Object.values(book.sessions) };  }); }
