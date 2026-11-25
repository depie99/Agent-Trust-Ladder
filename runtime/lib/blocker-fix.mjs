// Owner-gated, allowlisted repairs for recorded blocker next actions. No
// caller-supplied command text is ever executed: the action must already exist
// on the task's blocker, and package commands come from a fixed set.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadState, saveState, logEvent } from "./state.mjs";
import { readResourceConfig, routeTask } from "./resource-policy.mjs";
import { providerProfile, providerNames } from "./providers.mjs";

const FIX_KINDS = new Set(["package-install", "provider-model", "provider-install"]);
const PACKAGE_COMMANDS = new Set([
  "npm ci --offline --ignore-scripts --no-audit --no-fund",
  "yarn install --frozen-lockfile --ignore-scripts",
  "pnpm install --frozen-lockfile --ignore-scripts",
  "bun install --frozen-lockfile --offline --ignore-scripts",
]);
// Mirror the pinned installers used by the Providers surface. No other
// provider command can be submitted through a blocker fix.
const PROVIDER_COMMANDS = {
  codex: "npm install --global @openai/codex@0.169.0",
  claude: "npm install --global @anthropic-ai/claude-code@2.1.326",
};

function recordedAction(task, requested) {
  const actions = [...(task?.blocker?.next_actions || []), ...(task?.recovery?.next_actions || [])];
  const action = actions.find((item) => item.kind === requested?.kind);
  if (!action || !FIX_KINDS.has(action.kind)) throw new Error("Only a fix recorded on this blocker can be applied.");
  if (requested.command && requested.command !== action.command) throw new Error("The submitted command does not match the recorded fix.");
  if (requested.model && action.model && requested.model !== action.model) throw new Error("The submitted model does not match the recorded fix.");
  if (requested.provider && action.provider && requested.provider !== action.provider) throw new Error("The submitted provider does not match the recorded fix.");
  return action;
}

function recordOutcome(root, state, task, action, detail, ok) {
  const entry = { kind: "fix-result", action: action.kind, detail, at: new Date().toISOString(), ok };
  const record = (task.recovery_records || []).find((item) => item.id === task.recovery?.id) || task.recovery;
  if (record) { record.evidence ||= []; record.evidence.push(entry); }
  if (task.blocker) { task.blocker.evidence ||= []; task.blocker.evidence.push(entry); }
  logEvent(state, { task: task.id, actor: "owner", event: "blocker_fix", detail: `${action.kind}: ${detail}` });
  state.updated_at = new Date().toISOString();
  saveState(root, state, { expectedRevision: state.revision || 0 });
}

export function applyBlockerFix(root, taskId, requested = {}, { installProvider = null } = {}) {
  const state = loadState(root);
  const task = state.tasks[String(taskId || "")];
  if (!task) throw new Error("Task not found.");
  const action = recordedAction(task, requested);
  if (action.kind === "provider-model") {
    const provider = String(requested.provider || action.provider || "").trim().toLowerCase();
    const model = String(requested.model || action.model || "").trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider) || !/^[a-z0-9][a-z0-9._-]*$/.test(model)) throw new Error("Choose an exact configured provider and model id.");
    const config = readResourceConfig(root);
    if (!providerNames(providerProfile(config)).includes(provider)) throw new Error("Provider is not configured. Configure it in Providers, then apply this fix.");
    const preview = routeTask(config, { ...task, provider_route: { provider, model } }, "rowan");
    if (preview.decision.blocked) throw new Error(preview.decision.blocked);
    task.provider_route = { provider, model };
    recordOutcome(root, state, task, action, `Task route set to ${provider}/${model}. The blocker remains until the owner reviews it.`, true);
    return { ok: true, kind: action.kind, detail: `Provider route set to ${provider}/${model}. Review and unblock when ready.`, requiresUnblock: true };
  }
  if (action.kind === "package-install") {
    const command = String(action.command || "");
    if (!PACKAGE_COMMANDS.has(command)) throw new Error("This package command is not allowlisted.");
    const workspace = path.resolve(String(action.workspace || task.workspace || ""));
    if (!task.workspace || workspace !== path.resolve(task.workspace) || !fs.existsSync(workspace)) throw new Error("The recorded fix workspace is unavailable.");
    const env = { ...process.env, npm_config_cache: path.join(root, ".trust", "manager", "npm-cache") };
    const result = process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], { cwd: workspace, encoding: "utf8", timeout: 600000, windowsHide: true, env })
      : spawnSync(command.split(" ")[0], command.split(" ").slice(1), { cwd: workspace, encoding: "utf8", timeout: 600000, env });
    const detail = `Ran ${command} (exit ${result.status ?? "unknown"}): ${String(result.stderr || result.stdout || "").slice(-1200)}`;
    const ok = result.status === 0;
    recordOutcome(root, state, task, action, detail, ok);
    if (!ok) throw new Error(detail);
    return { ok: true, kind: action.kind, detail: `Dependencies prepared with ${command}. Rerun dispatch preflight before resuming.`, requiresUnblock: true };
  }
  if (action.kind === "provider-install") {
    const provider = String(requested.provider || action.provider || "").trim().toLowerCase();
    if (!PROVIDER_COMMANDS[provider] || action.command !== PROVIDER_COMMANDS[provider]) throw new Error("Only a pinned provider installer can be applied from a blocker.");
    if (typeof installProvider !== "function") throw new Error("The pinned installer is available from the Control Plane Providers surface.");
    const operation = installProvider(provider);
    const detail = `Started pinned ${provider} CLI install (${action.command}); status ${operation.status}. Refresh provider status before retrying.`;
    recordOutcome(root, state, task, action, detail, operation.status === "running");
    return { ok: operation.status === "running", kind: action.kind, detail, operation, requiresUnblock: true };
  }
  throw new Error("This blocker fix kind cannot be applied.");
}
