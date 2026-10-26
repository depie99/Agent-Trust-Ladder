import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const sessionFile = (root) => path.join(root, ".trust", "manager", "owner-session.json");
export function ensureOwnerSession(root) {
  const file = sessionFile(root); try { const current = JSON.parse(fs.readFileSync(file, "utf8")); if (current.token && current.csrf) return current; } catch { /* create below */ }
  const session = { version: 1, token: createOwnerSession(), csrf: createOwnerSession(), created_at: new Date().toISOString() }; fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(session, null, 2) + "\n"); fs.renameSync(tmp, file); return session;
}
export function validateOwnerSession(root, token, csrf) { const session = ensureOwnerSession(root); return Boolean(token && csrf && token === session.token && csrf === session.csrf); }
export function ownerSessionCookie(token) { return `atl_owner=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`; }
export function createOwnerSession() { return crypto.randomBytes(32).toString("base64url"); }
export function createWorkerCredential({ project, task, role, run, generation, leaseId = null, leaseKey = null, expiresInSeconds = 1800 }) { return { id: crypto.randomUUID(), project, task, role, run, generation, lease_id: leaseId, lease_key: leaseKey, expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString() }; }
export function validateWorkerCredential(credential, expected) { if (!credential || new Date(credential.expires_at).getTime() <= Date.now()) return false; return ["project", "task", "role", "run", "generation"].every((key) => credential[key] === expected[key]); }
