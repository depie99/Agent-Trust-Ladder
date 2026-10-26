import fs from "node:fs";
import path from "node:path";
import { brainPaths, listClaims } from "./brain.mjs";

function file(root, name) { return path.join(brainPaths(root).dir, name); }
function read(root, name, fallback) { const p = file(root, name); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
function write(root, name, value) { const p = file(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = `${p}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n"); fs.renameSync(tmp, p); }

export function staleClaims(root, { now = Date.now(), maxAgeDays = 30 } = {}) {
  const cutoff = now - maxAgeDays * 86400000;
  return listClaims(root).filter((c) => c.checked_at && new Date(c.checked_at).getTime() < cutoff || (!c.checked_at && new Date(c.observed_at).getTime() < cutoff));
}

export function approveClaim(root, claimId, { actor = "manager", note = "" } = {}) {
  const p = brainPaths(root); const store = read(root, "claims.json", { version: 1, claims: [] });
  const claim = store.claims.find((c) => c.claim_id === claimId);
  if (!claim) throw new Error(`unknown claim ${claimId}`);
  if (claim.status === "CONFLICTED") throw new Error(`${claimId} is conflicted and cannot be approved`);
  claim.status = "VERIFIED"; claim.checked_at = new Date().toISOString(); claim.approved_by = actor; claim.approval_note = note;
  const tmp = `${p.claims}.tmp`; fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n"); fs.renameSync(tmp, p.claims); return claim;
}

export function validateSkill(skill) {
  const required = ["id", "version", "input_contract", "validation", "approval_boundary", "rollback", "fixtures", "capabilities"];
  const missing = required.filter((key) => !skill?.[key] || (Array.isArray(skill[key]) && skill[key].length === 0));
  const evidence = skill?.validation_evidence;
  const independentlyReviewed = evidence?.independent_review?.verdict === "approve";
  const observed = Array.isArray(evidence?.runs) && evidence.runs.some((run) => run.result === "pass" && run.artifact_hash);
  const level = missing.length ? "bronze" : observed && independentlyReviewed ? "gold" : "silver";
  return { level, valid: missing.length === 0, missing, observed, independentlyReviewed };
}

export function promoteSkill(root, skill, { actor = "manager" } = {}) {
  const check = validateSkill(skill); if (!check.valid || check.level !== "gold") throw new Error(`skill requires observed validation and independent approval: ${check.missing.join(", ") || "missing evidence"}`);
  const store = read(root, "skills.json", { version: 1, skills: [] });
  if (!store.skills.some((s) => s.id === skill.id && s.version === skill.version)) store.skills.push({ ...skill, approved_by: actor, approved_at: new Date().toISOString() });
  write(root, "skills.json", store); return store.skills.find((s) => s.id === skill.id && s.version === skill.version);
}

export function registerRoutine(root, routine, { actor = "manager" } = {}) {
  if (!routine.id || !routine.project || !routine.skill_id || !routine.schedule || !routine.idempotency_key || !Number.isInteger(routine.retry_limit)) throw new Error("routine requires id, project, skill_id, schedule, idempotency_key, and integer retry_limit");
  const skills = read(root, "skills.json", { version: 1, skills: [] });
  const skill = skills.skills.find((s) => s.id === routine.skill_id && s.version === routine.skill_version);
  if (!skill) throw new Error("routine requires an approved skill version");
  const store = read(root, "routines.json", { version: 1, routines: [] });
  const item = { ...routine, enabled: false, approval_gate: "manager", timezone: routine.timezone || "Asia/Tehran", retry_limit: Math.min(2, Math.max(0, routine.retry_limit)), registered_by: actor, registered_at: new Date().toISOString() };
  const index = store.routines.findIndex((r) => r.id === routine.id); if (index >= 0) store.routines[index] = item; else store.routines.push(item); write(root, "routines.json", store); return item;
}

export const listSkills = (root) => read(root, "skills.json", { version: 1, skills: [] }).skills;
export const listRoutines = (root) => read(root, "routines.json", { version: 1, routines: [] }).routines;
