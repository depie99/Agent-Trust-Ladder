// Recoverable project-local snapshots. Backups are explicit owner operations;
// restore refuses to run while a live queue lease exists.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths } from "./state.mjs";
import { readRunLock } from "./launch.mjs";
import { reconcileLeases } from "./leases.mjs";

const backupRoot = (root) => path.join(root, ".trust", "manager", "backups");
const files = (root) => [paths(root).state, paths(root).queue, paths(root).notifications, paths(root).usage, paths(root).config].filter((f) => fs.existsSync(f));
export function createBackup(root, { label = "manual", retention = null } = {}) { const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`; const dir = path.join(backupRoot(root), id); fs.mkdirSync(dir, { recursive: true }); const manifest = { version: 2, id, label, created_at: new Date().toISOString(), files: [] }; for (const file of files(root)) { const name = path.relative(root, file).replace(/[\\/]/g, "__"); fs.copyFileSync(file, path.join(dir, name)); const bytes = fs.readFileSync(file); manifest.files.push({ source: path.relative(root, file), archive: name, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }); } fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"); if (retention) pruneBackups(root, Number(retention)); return manifest; }
export function listBackups(root) { try { return fs.readdirSync(backupRoot(root), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => JSON.parse(fs.readFileSync(path.join(backupRoot(root), e.name, "manifest.json"), "utf8"))); } catch { return []; } }
export function previewRestore(root, id) { const dir = path.join(backupRoot(root), id); const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); return { ...manifest, verified: manifest.files.every((item) => !item.sha256 || crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, item.archive))).digest("hex") === item.sha256) }; }
export function pruneBackups(root, keep = 10) { const entries = listBackups(root).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); for (const item of entries.slice(Math.max(0, keep))) fs.rmSync(path.join(backupRoot(root), item.id), { recursive: true, force: true }); return entries.slice(0, keep); }
export function restoreBackup(root, id) { if (readRunLock(root)?.pid) throw new Error("stop the active queue before restoring"); const leases = reconcileLeases(root).sessions.filter((l) => l.status === "active"); if (leases.length) throw new Error("active task leases prevent restore"); const manifest = previewRestore(root, id); if (!manifest.verified) throw new Error("backup integrity hash mismatch"); const dir = path.join(backupRoot(root), id); for (const item of manifest.files) { const source = path.join(root, item.source); fs.mkdirSync(path.dirname(source), { recursive: true }); const staged = `${source}.${process.pid}.restore`; fs.copyFileSync(path.join(dir, item.archive), staged); fs.renameSync(staged, source); } return manifest; }
