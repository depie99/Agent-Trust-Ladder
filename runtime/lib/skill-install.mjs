import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { brainPaths } from "./brain.mjs";
const exec = promisify(execFile);

// Parse supported skills CLI syntax as data. Never execute the pasted command.
export function parseSkillSource(input) {
  const raw = String(input || "").trim();
  if (!raw || /[\r\n;&|`$<>"'\\]/.test(raw)) throw new Error("Use a GitHub URL, owner/repository, or a plain npx skills add command.");
  const words = raw.split(/\s+/);
  let source, name = null;
  if (words.length === 1) source = words[0];
  else {
    if (!((words[0] === "npx" && words[1] === "skills" && words[2] === "add") || (words[0] === "skills" && words[1] === "add"))) throw new Error("Expected npx skills add <source> --skill <name>.");
    const offset = words[0] === "npx" ? 3 : 2;
    source = words[offset];
    const rest = words.slice(offset + 1);
    if (rest.length) { if (rest.length !== 2 || !["--skill", "-s"].includes(rest[0])) throw new Error("Only --skill <name> is supported; choose a single skill."); name = rest[1]; }
  }
  if (!source) throw new Error("Enter a skill source.");
  if (/^https:\/\/skills\.sh\//i.test(source)) { const u = new URL(source); const parts = u.pathname.split("/").filter(Boolean); if (parts.length !== 3) throw new Error("Use a skills.sh skill page URL with owner, repository and skill name."); source = `${parts[0]}/${parts[1]}`; name ||= parts[2]; }
  let owner, repo, subpath = null, ref = null;
  if (/^https:\/\/github\.com\//i.test(source)) {
    const u = new URL(source); if (u.hostname !== "github.com" || u.username || u.password || u.search || u.hash) throw new Error("Use a plain GitHub URL.");
    const parts = u.pathname.split("/").filter(Boolean); [owner, repo] = parts;
    if (parts.length > 2) { if (parts[2] !== "tree" || parts.length < 5) throw new Error("Use a GitHub repository or skill directory URL."); ref = parts[3]; subpath = parts.slice(4).join("/"); }
  } else { const parts = source.split("/"); if (parts.length !== 2) throw new Error("Use a GitHub owner/repository or HTTPS URL."); [owner, repo] = parts; }
  repo = repo?.replace(/\.git$/, "");
  const safe = /^[A-Za-z0-9_.-]+$/;
  if (![owner, repo].every(x => x && safe.test(x) && x !== "." && x !== "..") || (name && (!safe.test(name) || name === "." || name === "..")) || (ref && !safe.test(ref)) || (subpath && subpath.split("/").some(x => !safe.test(x) || x === "." || x === ".."))) throw new Error("Invalid repository, ref, path, or skill name.");
  return { url: `https://github.com/${owner}/${repo}.git`, name, ref, subpath };
}
function findSkills(dir, depth = 0) {
  if (depth > 6) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.some(e => e.isFile() && e.name === "SKILL.md")) return [dir];
  return entries.filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").flatMap(e => findSkills(path.join(dir, e.name), depth + 1));
}
function checkTree(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink() || (!e.isDirectory() && !e.isFile())) throw new Error("Skill contains a link or unsupported file.");
    if (e.isDirectory()) checkTree(path.join(dir, e.name));
  }
}
export async function installSkill(root, input, { clone = null } = {}) {
  const source = parseSkillSource(input);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atl-skill-"));
  try {
    const repo = path.join(tmp, "repository");
    const emptyConfig = path.join(tmp, "empty-gitconfig"); fs.writeFileSync(emptyConfig, "");
    if (clone) await clone(source, repo);
    else await exec("git", ["-c", "core.hooksPath=", "-c", "protocol.file.allow=never", "clone", "--depth", "1", ...(source.ref ? ["--branch", source.ref] : []), "--", source.url, repo], { timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig } });
    const base = source.subpath ? path.join(repo, ...source.subpath.split("/")) : repo;
    if (!fs.existsSync(base)) throw new Error("Skill path was not found in the repository.");
    let part = repo; for (const component of (source.subpath || "").split("/").filter(Boolean)) { part = path.join(part, component); if (fs.lstatSync(part).isSymbolicLink()) throw new Error("Skill path cannot contain links."); }
    const candidates = findSkills(base).filter(p => !source.name || path.basename(p) === source.name);
    if (candidates.length !== 1) throw new Error(candidates.length ? "More than one matching skill found. Specify --skill <name>." : "No matching SKILL.md found. Specify a valid skill name or path.");
    const name = path.basename(candidates[0]);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new Error("Invalid skill directory name.");
    checkTree(candidates[0]);
    const target = path.join(root, ".agents", "skills", name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) throw new Error(`Skill ${name} is already installed in this project.`);
    fs.cpSync(candidates[0], target, { recursive: true, errorOnExist: true, force: false });
    return { id: name, source: source.url, path: `.agents/skills/${name}` };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
export function designateSkill(root, id) {
  const safe = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  if (!safe.test(String(id || ""))) throw new Error("Invalid skill ID.");
  const manifest = path.join(root, ".agents", "skills", id, "SKILL.md");
  if (!fs.existsSync(manifest)) throw new Error("Only project-installed skills can be added this way.");
  const file = path.join(brainPaths(root).dir, "skills.json");
  const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: 1, skills: [] };
  if (store.skills.some(s => s.id === id && s.version === "installed")) throw new Error("This skill is already in the Gold list.");
  const skill = { id, version: "installed", trust_basis: "user-designated", evidence_verified: false, approved_by: "manager", approved_at: new Date().toISOString() };
  store.skills.push(skill); fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n"); fs.renameSync(tmp, file);
  return skill;
}
