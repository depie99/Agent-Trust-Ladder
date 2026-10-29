import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { paths, loadState } from "./state.mjs";
import { discoverProvider } from "./providers.mjs";

const modes = new Set(["read-only", "workspace-write"]);
const validateMode = (mode) => { if (!modes.has(mode)) throw new Error("Choose read-only or workspace-write access."); return mode; };
function configFor(root) {
  const file = paths(root).config;
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}
export function executionAccess(root, taskId = null, { validateTask = true } = {}) {
  const policy = configFor(root).execution_access || {};
  const defaultMode = validateMode(policy.default || "workspace-write");
  if (taskId && validateTask && (!/^T-\d+$/.test(taskId) || !loadState(root).tasks[taskId])) throw new Error("Task not found.");
  const override = taskId ? policy.tasks?.[taskId] || null : null;
  if (override) validateMode(override);
  return { default: defaultMode, override, mode: override || defaultMode, source: override ? "task" : "project", task: taskId, applies_to: ["gapgpt", "codex"], task_overrides: Object.keys(policy.tasks || {}).length };
}
export function saveExecutionAccess(root, { task = null, mode }) {
  if (task) executionAccess(root, task);
  if (mode !== "inherit" || !task) validateMode(mode);
  const config = configFor(root);
  const policy = { default: "workspace-write", ...config.execution_access, tasks: { ...config.execution_access?.tasks } };
  if (!task) policy.default = mode;
  else if (mode === "inherit") delete policy.tasks[task];
  else policy.tasks[task] = mode;
  config.execution_access = policy;
  const file = paths(root).config;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return executionAccess(root, task);
}

// A single permission contract for Ask ATL and built-in queue workers.
// GapCode on Windows resolves named profiles rather than the legacy sandbox flag.
export function executionPermissionArgs(provider, mode, platform = process.platform) {
  validateMode(mode);
  return ["gapgpt", "codex"].includes(provider) && platform === "win32"
    ? [...(provider === "codex" ? ["--sandbox", mode] : []), "-c", `default_permissions=":${mode === "workspace-write" ? "workspace" : "read-only"}"`, "-c", 'windows.sandbox="unelevated"']
    : ["--sandbox", mode];
}

function workspaceProbe(root, taskId, provider, discover) {
  const access = executionAccess(root, taskId);
  if (access.mode !== "workspace-write") throw new Error("Authorize workspace read/write access before checking writes.");
  if (!["gapgpt", "codex"].includes(provider) || process.platform !== "win32") return null;
  const task = loadState(root).tasks[taskId];
  if (!task?.workspace) throw new Error("Task has no workspace to check.");
  const workspace = fs.realpathSync(task.workspace);
  const relative = path.relative(fs.realpathSync(root), workspace);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("Task workspace must be inside this project.");
  const discovery = discover(provider);
  if (!discovery.available) throw new Error(discovery.error);
  const filename = `.atl-access-probe-${crypto.randomUUID()}`;
  const script = `const fs=require('node:fs'); const p=${JSON.stringify(filename)}; try { fs.writeFileSync(p,'ATL workspace access',{flag:'wx'}); if(fs.readFileSync(p,'utf8')!=='ATL workspace access') throw Error('Readback failed'); console.log('ATL_WORKSPACE_ACCESS_OK'); } finally { if(fs.existsSync(p)) fs.unlinkSync(p); }`;
  const args = ["sandbox", "--permission-profile", ":workspace", "--include-managed-config", "--cd", workspace, "-c", 'windows.sandbox="unelevated"', process.execPath, "-e", script];
  return { command: discovery.path, args, workspace };
}

export function preflightWorkspaceAccess(root, taskId, { provider = "gapgpt", discover = discoverProvider } = {}) {
  // The standalone Codex alias shipped by GapCode uses the same named profile.
  // Other Codex distributions retain their own sandbox setup and CLI contract.
  if (process.platform !== "win32" || !["gapgpt", "codex"].includes(provider)) return null;
  const discovery = discover(provider);
  if (provider === "codex" && !/[\\/]\.gapcode[\\/]|gapcode(?:\.exe)?$/i.test(discovery.path || "")) return null;
  const probe = workspaceProbe(root, taskId, provider, () => discovery);
  const result = spawnSync(probe.command, probe.args, { cwd: probe.workspace, windowsHide: true, encoding: "utf8", timeout: 15000 });
  const output = String(result.stderr || "") + String(result.stdout || "");
  return { ok: result.status === 0 && output.includes("ATL_WORKSPACE_ACCESS_OK"), detail: output.trim().slice(-4000) || result.error?.message || `Workspace access check exited ${result.status}.` };
}

export async function probeWorkspaceAccess(root, taskId, { provider = "gapgpt", discover = discoverProvider, launch = spawn } = {}) {
  const probe = workspaceProbe(root, taskId, provider, discover);
  if (!probe) return { ok: false, status: "unavailable", detail: "The local sandbox check is available for GapCode and Codex on Windows. No model session was started." };
  return new Promise((resolve, reject) => {
    const child = launch(probe.command, probe.args, { cwd: probe.workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let timedOut = false;
    const collect = (chunk) => { output = (output + chunk.toString()).slice(-4000); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 15000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const ok = code === 0 && output.includes("ATL_WORKSPACE_ACCESS_OK");
      resolve({ ok, status: ok ? "verified" : "denied", detail: ok ? "GapCode's workspace sandbox read, wrote, and removed a temporary file. No model session or task budget was used. This checks filesystem access; an external MCP tool may still have its own approval requirements." : timedOut ? "The local access check timed out. No model session was started." : output.trim() || `Local access check exited ${code}.`, checked_at: new Date().toISOString() });
    });
  });
}
