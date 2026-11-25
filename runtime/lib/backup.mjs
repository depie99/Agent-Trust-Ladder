// Recoverable project-local snapshots. Backups are explicit owner operations;
// restore refuses to run while a live queue lease exists.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths } from "./state.mjs";
import { readRunLock } from "./launch.mjs";
import { reconcileLeases } from "./leases.mjs";

const backupRoot = (root) => path.join(root, ".trust", "manager", "backups");
const files = (root) => [paths(root).state, paths(root).queue, paths(root).notifications, paths(root).usage, paths(root).config].filter((file) => fs.existsSync(file));
const BACKUP_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

function assertBackupId(id) {
  const value = String(id || "");
  if (!BACKUP_ID.test(value)) throw new Error("backup id must contain 1-100 letters, digits, dots, underscores, or dashes");
  return value;
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safeSourcePath(root, value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error("backup manifest contains an invalid source path");
  }
  const segments = value.split(/[\\/]/);
  if (segments.some((segment) => segment === ".." || segment === "")) throw new Error("backup manifest source path escapes the project root");
  const target = path.resolve(root, ...segments);
  if (!within(path.resolve(root), target)) throw new Error("backup manifest source path escapes the project root");
  return target;
}

function safeArchivePath(dir, value) {
  if (typeof value !== "string" || value === "." || value === ".." || !/^[a-z0-9._-]{1,241}$/i.test(value)) throw new Error("backup manifest contains an invalid archive path");
  const target = path.join(dir, value);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("backup archive entry is not a regular file");
  return target;
}

function assertNoSymlinkEscape(root, target) {
  const realRoot = fs.realpathSync(root);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("restore refuses to replace a symbolic link");
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("restore destination has no existing parent");
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  if (!within(realRoot, realAncestor) && realAncestor !== realRoot) throw new Error("restore destination resolves outside the project root");
}

export function createBackup(root, { label = "manual", retention = null } = {}) {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const dir = path.join(backupRoot(root), id);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { version: 2, id, label, created_at: new Date().toISOString(), files: [] };
  for (const file of files(root)) {
    const name = path.relative(root, file).replace(/[\\/]/g, "__");
    fs.copyFileSync(file, path.join(dir, name));
    const bytes = fs.readFileSync(file);
    manifest.files.push({ source: path.relative(root, file), archive: name, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  if (retention) pruneBackups(root, Number(retention));
  return manifest;
}

export function listBackups(root) {
  try {
    return fs.readdirSync(backupRoot(root), { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => JSON.parse(fs.readFileSync(path.join(backupRoot(root), entry.name, "manifest.json"), "utf8")));
  } catch { return []; }
}

export function previewRestore(root, id) {
  const safeId = assertBackupId(id);
  const rootDir = backupRoot(root);
  const dir = path.join(rootDir, safeId);
  const dirStat = fs.lstatSync(dir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error("backup entry is not a regular directory");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (manifest?.version !== 2 || manifest.id !== safeId || !Array.isArray(manifest.files)) throw new Error("backup manifest is invalid");
  const verifiedFiles = manifest.files.map((item) => {
    const source = safeSourcePath(root, item?.source);
    assertNoSymlinkEscape(root, source);
    const archive = safeArchivePath(dir, item?.archive);
    const expected = String(item?.sha256 || "");
    if (!/^[a-f0-9]{64}$/i.test(expected)) return { archive, source, verified: false };
    const actual = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    return { archive, source, verified: actual === expected.toLowerCase() };
  });
  return { ...manifest, verified: verifiedFiles.every((item) => item.verified) };
}

export function pruneBackups(root, keep = 10) {
  const count = Math.max(0, Math.floor(Number(keep) || 0));
  const entries = listBackups(root).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const item of entries.slice(count)) {
    try { fs.rmSync(path.join(backupRoot(root), assertBackupId(item.id)), { recursive: true, force: true }); } catch { /* malformed entries are not followed */ }
  }
  return entries.slice(0, count);
}

export function scheduledBackup(root, { intervalHours = 24, retention = 10, now = new Date() } = {}) {
  const latest = listBackups(root).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (latest && now.getTime() - new Date(latest.created_at).getTime() < intervalHours * 3600000) return { created: false, latest };
  return { created: true, backup: createBackup(root, { label: "scheduled", retention }) };
}

export function restoreBackup(root, id) {
  if (readRunLock(root)?.pid) throw new Error("stop the active queue before restoring");
  const leases = reconcileLeases(root).sessions.filter((lease) => lease.status === "active");
  if (leases.length) throw new Error("active task leases prevent restore");
  const manifest = previewRestore(root, id);
  if (!manifest.verified) throw new Error("backup integrity hash mismatch or a required sha256 is missing");
  const dir = path.join(backupRoot(root), assertBackupId(id));
  for (const item of manifest.files) {
    const source = safeSourcePath(root, item.source);
    assertNoSymlinkEscape(root, source);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    assertNoSymlinkEscape(root, source);
    const staged = `${source}.${process.pid}.${crypto.randomUUID()}.restore`;
    fs.copyFileSync(safeArchivePath(dir, item.archive), staged);
    fs.renameSync(staged, source);
  }
  return manifest;
}
