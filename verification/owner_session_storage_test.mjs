import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureOwnerSession, rotateOwnerSession, validateOwnerSession } from "../runtime/lib/session-auth.mjs";

const projectKey = (root) => crypto.createHash("sha256").update(process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root)).digest("hex").slice(0, 32);
const previousHome = process.env.ATL_HOME;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-session-home-"));
process.env.ATL_HOME = home;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-owner-session-storage-"));
try {
  const session = ensureOwnerSession(root);
  const file = path.join(home, "sessions", `${projectKey(root)}.json`);
  assert.equal(fs.existsSync(file), true, "session is stored under ATL_HOME/sessions, keyed by project");
  assert.equal(fs.existsSync(path.join(root, ".trust", "manager", "owner-session.json")), false, "no session file inside the project");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, "session file is 0600");
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700, "sessions directory is 0700");
  }
  const rotated = rotateOwnerSession(root);
  assert.notEqual(rotated.token, session.token, "rotation issues a new token");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).token, rotated.token, "rotation persists the new token");
  assert.equal(validateOwnerSession(root, rotated.token, rotated.csrf), true, "new session validates");
  assert.equal(validateOwnerSession(root, session.token, session.csrf), false, "pre-rotation token no longer validates");

  const legacyDir = path.join(root, ".trust", "manager");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "owner-session.json"), JSON.stringify({ version: 1, token: "stale", csrf: "stale" }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "legacy session committed"], { cwd: root });
  const after = ensureOwnerSession(root);
  assert.equal(fs.existsSync(path.join(legacyDir, "owner-session.json")), false, "a committed legacy copy is deleted, never read");
  assert.equal(after.token, rotated.token, "legacy copy does not change the live session");
  console.log("PASS: owner session storage location, permissions, rotation, and legacy-copy refusal");
} finally {
  if (previousHome === undefined) delete process.env.ATL_HOME; else process.env.ATL_HOME = previousHome;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
