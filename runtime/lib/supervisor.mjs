// Local supervisor metadata. Project state remains in its own repository.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { reconcileLeases } from "./leases.mjs";

const home = () => process.env.ATL_HOME || path.join(process.env.USERPROFILE || process.env.HOME || ".", ".atl");
const file = () => path.join(home(), "supervisor.json");
const read = () => { try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch { return { version: 1, revision: 0, defaults: { maxConcurrent: 2, maxConcurrentCap: 5 }, projects: [], audit: [] }; } };
const write = (data) => { fs.mkdirSync(path.dirname(file()), { recursive: true }); data.revision++; const tmp = `${file()}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n"); fs.renameSync(tmp, file()); return data; };
export function registerProject(root, { id = null, name = path.basename(root), maxConcurrent = 1 } = {}) { const data = read(); const canonical = fs.realpathSync(root); const existing = data.projects.find((p) => p.root === canonical); if (existing) return existing; const project = { id: id || crypto.randomUUID(), name, root: canonical, maxConcurrent: Math.min(5, Math.max(1, Number(maxConcurrent) || 1)), registered_at: new Date().toISOString() }; data.projects.push(project); data.audit.push({ at: project.registered_at, type: "project-registered", project: project.id }); write(data); return project; }
export function supervisorSnapshot() { return read(); }
export function removeProject(id, { force = false } = {}) { const data = read(); const project = data.projects.find((p) => p.id === id); if (!project) throw new Error(`unknown project ${id}`); const active = reconcileLeases(project.root).sessions.filter((lease) => lease.status === "active"); if (active.length && !force) throw new Error("active leases prevent project deletion"); data.projects = data.projects.filter((p) => p.id !== id); data.audit.push({ at: new Date().toISOString(), type: "project-removed", project: id, forced: Boolean(force) }); write(data); return project; }
export function setSupervisorDefaults(input) { const data = read(); const n = Number(input.maxConcurrent); if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("maxConcurrent must be an integer from 1 to 5"); data.defaults.maxConcurrent = n; write(data); return data; }
export function selectProjects(projects, { cursor = 0 } = {}) { const eligible = projects.filter((p) => p.eligible); return eligible.length ? eligible.slice(cursor % eligible.length).concat(eligible.slice(0, cursor % eligible.length)) : []; }
