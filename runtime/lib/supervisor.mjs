// Local supervisor metadata. Project state remains in its own repository.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { reconcileLeases } from "./leases.mjs";

const home = () => process.env.ATL_HOME || path.join(process.env.HOME || process.env.USERPROFILE || ".", ".atl");
const file = () => path.join(home(), "supervisor.json");
const read = () => { try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch { return { version: 1, revision: 0, defaults: { maxConcurrent: 2, maxConcurrentCap: 5 }, projects: [], audit: [] }; } };
function withLock(fn) {
  fs.mkdirSync(home(), { recursive: true });
  const lock = `${file()}.lock`;
  // Windows note: openSync("wx") reports EPERM under concurrent lock-path
  // create/remove, and rename fails with EPERM while a reader holds the
  // destination open — both are contention, not permission errors.
  const deadline = Date.now() + 10000;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, "wx", 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: Date.now() })); }
    catch (error) {
      if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
      try { const owner = JSON.parse(fs.readFileSync(lock, "utf8")); let alive = true; try { process.kill(owner.pid, 0); } catch (probe) { alive = probe.code === "EPERM"; } if (!alive && Date.now() - Number(owner.created_at || 0) > 1000) fs.rmSync(lock, { force: true }); } catch { /* lock owner may still be writing metadata */ }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for supervisor lock ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); }
  finally {
    fs.closeSync(fd);
    try { const owner = JSON.parse(fs.readFileSync(lock, "utf8")); if (owner.pid !== process.pid) return; } catch { return; }
    fs.rmSync(lock, { force: true });
  }
}
const write = (data) => { fs.mkdirSync(path.dirname(file()), { recursive: true }); data.revision++; const tmp = `${file()}.${process.pid}.${crypto.randomUUID()}.tmp`; try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" }); for (let attempt = 0; ; attempt++) { try { fs.renameSync(tmp, file()); break; } catch (error) { if (error.code !== "EPERM" || attempt >= 6) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1)); } } } finally { fs.rmSync(tmp, { force: true }); } return data; };
export function registerProject(root, { id = null, name = null, maxConcurrent = 1, allowExisting = false } = {}) {
  if (typeof root !== "string" || !root.trim()) throw new Error("project root is required");
  let requested = root.trim();
  if (requested === "~") requested = process.env.HOME || process.env.USERPROFILE || requested;
  else if (requested.startsWith(`~${path.sep}`) || requested.startsWith("~/")) requested = path.join(process.env.HOME || process.env.USERPROFILE || ".", requested.slice(2));
  if (!path.isAbsolute(requested)) throw new Error("project root must be an absolute path");
  let canonical;
  try { canonical = fs.realpathSync(requested); } catch { throw new Error(`project directory does not exist: ${requested}`); }
  if (!fs.statSync(canonical).isDirectory()) throw new Error("project root must be a directory");
  if (canonical === path.parse(canonical).root) throw new Error("filesystem root cannot be registered as a project");
  const profile = process.env.HOME || process.env.USERPROFILE;
  if (profile && canonical === fs.realpathSync(profile)) throw new Error("home directory cannot be registered as a project");
  if (process.env.ATL_HOME) {
    try { if (canonical === fs.realpathSync(process.env.ATL_HOME)) throw new Error("ATL data directory cannot be registered as a project"); }
    catch (error) { if (error.message.includes("cannot be registered")) throw error; }
  }
  const concurrency = Number(maxConcurrent);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) throw new Error("maxConcurrent must be an integer from 1 to 5");
  return withLock(() => {
    const data = read();
    const existing = data.projects.find((p) => p.root === canonical);
    if (existing) {
      if (allowExisting) return existing;
      const error = new Error(`project is already registered as ${existing.id}`); error.statusCode = 409; throw error;
    }
    const project = { id: id || crypto.randomUUID(), name: (name || path.basename(canonical) || canonical).trim(), root: canonical, maxConcurrent: concurrency, registered_at: new Date().toISOString() };
    data.projects.push(project); data.audit.push({ at: project.registered_at, type: "project-registered", project: project.id }); write(data); return project;
  });
}
export function supervisorSnapshot() { return read(); }
export function removeProject(id, { force = false } = {}) { return withLock(() => { const data = read(); const project = data.projects.find((p) => p.id === id); if (!project) throw new Error(`unknown project ${id}`); const active = reconcileLeases(project.root).sessions.filter((lease) => lease.status === "active"); if (active.length && !force) throw new Error("active leases prevent project deletion"); data.projects = data.projects.filter((p) => p.id !== id); data.audit.push({ at: new Date().toISOString(), type: "project-removed", project: id, forced: Boolean(force) }); write(data); return project; }); }
export function setSupervisorDefaults(input) { return withLock(() => { const data = read(); const n = Number(input.maxConcurrent); if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("maxConcurrent must be an integer from 1 to 5"); data.defaults.maxConcurrent = n; write(data); return data; }); }
export function selectProjects(projects, { cursor = 0 } = {}) { const eligible = projects.filter((p) => p.eligible); return eligible.length ? eligible.slice(cursor % eligible.length).concat(eligible.slice(0, cursor % eligible.length)) : []; }
