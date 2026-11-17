import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const projectKey = (root) => crypto.createHash("sha256").update(process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root)).digest("hex").slice(0, 32);
const sessionFile = (root, env = process.env) => path.join(env.ATL_HOME || path.join(os.homedir(), ".atl"), "sessions", `${projectKey(root)}.json`);
function saveSession(file, session) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* Windows ACLs inherit from the user's profile. */ }
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  try { fs.chmodSync(tmp, 0o600); } catch { /* Windows ACLs inherit from the user's profile. */ }
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs inherit from the user's profile. */ }
}
function refuseLegacyOwnerSession(root) {
  const legacy = path.join(root, ".trust", "manager", "owner-session.json");
  try { if (!fs.existsSync(legacy)) return; } catch { return; }
  let tracked = false;
  try { tracked = spawnSync("git", ["-C", root, "ls-files", "--error-unmatch", ".trust/manager/owner-session.json"], { stdio: "ignore", windowsHide: true }).status === 0; } catch { tracked = false; }
  if (tracked) console.warn("ATL_TRACKED_OWNER_SESSION: a committed owner-session.json is never read; purge it from git history (git filter-repo) — deleting the working copy now.");
  try { fs.rmSync(legacy, { force: true }); } catch { /* best effort */ }
}
export function ensureOwnerSession(root) {
  refuseLegacyOwnerSession(root);
  const file = sessionFile(root); try { const current = JSON.parse(fs.readFileSync(file, "utf8")); if (current.version === 1 && current.token && current.csrf) return current; } catch { /* create below */ }
  const session = { version: 1, token: createOwnerSession(), csrf: createOwnerSession(), created_at: new Date().toISOString() };
  saveSession(file, session);
  return session;
}
export function rotateOwnerSession(root) {
  refuseLegacyOwnerSession(root);
  const session = { version: 1, token: createOwnerSession(), csrf: createOwnerSession(), created_at: new Date().toISOString() };
  saveSession(sessionFile(root), session);
  return session;
}
export function clearOwnerSession(root, token) {
  const file = sessionFile(root);
  try {
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    if (equalSecret(token, current.token)) fs.rmSync(file, { force: true });
  } catch { /* already cleared or unavailable */ }
}
function equalSecret(value, expected) {
  if (typeof value !== "string" || !value) return false;
  const left = Buffer.from(value); const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export function validateOwnerSession(root, token, csrf) { const session = ensureOwnerSession(root); return equalSecret(token, session.token) && equalSecret(csrf, session.csrf); }
export function ownerSessionCookie(token, { embedded = false } = {}) { return `atl_owner=${encodeURIComponent(token)}; HttpOnly; ${embedded ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Strict'}; Path=/`; }
export function createOwnerSession() { return crypto.randomBytes(32).toString("base64url"); }
export function createWorkerCredential({ project, task, role, run, generation, leaseId = null, leaseKey = null, expiresInSeconds = 1800 }) { return { id: crypto.randomUUID(), project, task, role, run, generation, lease_id: leaseId, lease_key: leaseKey, expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString() }; }
export function validateWorkerCredential(credential, expected) { if (!credential || new Date(credential.expires_at).getTime() <= Date.now()) return false; return ["project", "task", "role", "run", "generation"].every((key) => credential[key] === expected[key]); }
