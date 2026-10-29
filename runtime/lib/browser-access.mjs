import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths, loadState } from "./state.mjs";

const modes = new Set(["approval-required", "approved"]);
const validateMode = (mode) => { if (!modes.has(mode)) throw new Error("Choose approval-required or approved browser access."); return mode; };
const configFor = (root) => fs.existsSync(paths(root).config) ? JSON.parse(fs.readFileSync(paths(root).config, "utf8")) : {};

export function browserAccessPolicy(root) {
  const config = configFor(root).ui_review || {};
  const policy = config.browser_access || {};
  const defaultMode = validateMode(policy.default ?? (config.local_browser_tools_approved === true ? "approved" : "approval-required"));
  const tasks = { ...(policy.tasks || {}) };
  for (const mode of Object.values(tasks)) validateMode(mode);
  return { default: defaultMode, tasks };
}

export function browserAccess(root, task = null, { validateTask = true } = {}) {
  if (task && validateTask && (!/^T-\d+$/.test(task) || !loadState(root).tasks[task])) throw new Error("Task not found.");
  const policy = browserAccessPolicy(root);
  const override = task ? policy.tasks[task] || null : null;
  return { default: policy.default, override, mode: override || policy.default, source: override ? "task" : "project", task, task_overrides: Object.keys(policy.tasks).length, applies_to: ["gapgpt", "codex"], scope: "isolated-atl-preview" };
}

export function saveBrowserAccess(root, { task = null, mode }) {
  if (task !== null && (typeof task !== "string" || !/^T-\d+$/.test(task))) throw new Error("Task not found.");
  if (task) browserAccess(root, task);
  if (mode !== "inherit" || !task) validateMode(mode);
  const config = configFor(root);
  const policy = browserAccessPolicy(root);
  if (!task) policy.default = mode;
  else if (mode === "inherit") delete policy.tasks[task];
  else policy.tasks[task] = mode;
  config.ui_review = { ...config.ui_review, browser_access: policy };
  const file = paths(root).config;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(temporary, file);
  return browserAccess(root, task);
}

export async function checkBrowserRuntime(root, task = null) {
  browserAccess(root, task);
  const workspace = task ? loadState(root).tasks[task].workspace : root;
  if (!workspace) throw new Error("Task has no workspace to check.");
  const canonical = fs.realpathSync(workspace);
  const relative = path.relative(fs.realpathSync(root), canonical);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Task workspace must be inside this project.");
  const { createBrowserTools } = await import("./ui-review-mcp.mjs");
  const tools = createBrowserTools(root, canonical);
  try {
    await tools.call("browser_preview");
    return { ok: true, status: "runtime-verified", checked_at: new Date().toISOString(), detail: "The isolated browser started and loaded the task assets. No model session was used. This checks the browser runtime; the next model run must still pass the host's tool policy." };
  } catch (error) {
    return { ok: false, status: "unavailable", checked_at: new Date().toISOString(), detail: error.message };
  } finally { await tools.close(); }
}
