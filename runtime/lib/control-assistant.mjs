import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { builtinProviderStatus, discoverProvider } from "./providers.mjs";
import { loadState } from "./state.mjs";
import { inspectHandoffChain } from "./handoffs.mjs";
import { beginQueueRun, endQueueRun } from "./launch.mjs";

const keyPattern = /(?:sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+)/i;
const directory = (root) => path.join(root, ".trust", "manager", "assistant");
const validScope = (scope) => scope === "global" || /^T-\d+$/.test(scope);
const fileFor = (root, scope) => path.join(directory(root), `${scope}.json`);
const redact = (value) => String(value || "").replace(/sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+/gi, "[redacted]");
const save = (root, session) => { fs.mkdirSync(directory(root), { recursive: true }); const file = fileFor(root, session.scope); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(session, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); };

export function assistantWorkspace(root, scope) {
  if (!validScope(scope) || scope === "global") throw new Error("Fix mode requires a task with an existing isolated workspace.");
  const task = loadState(root).tasks[scope];
  if (!task?.workspace || ["done", "archived", "rejected"].includes(task.status)) throw new Error("Fix mode requires an active task with an existing workspace.");
  const project = fs.realpathSync(root); const workspace = fs.realpathSync(task.workspace);
  const relative = path.relative(project, workspace);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Task workspace must be inside the selected project.");
  return workspace;
}

export function assistantContext(root, scope) {
  if (!validScope(scope)) throw new Error("Invalid assistant scope.");
  if (scope === "global") return { scope, project: path.basename(root) };
  const state = loadState(root); const task = state.tasks[scope];
  if (!task) throw new Error("Task not found.");
  const handoffs = inspectHandoffChain(root, task, state.tasks);
  return { scope, id: task.id, title: redact(task.title), objective: redact(task.objective), status: task.status, checks: (task.completion_checks || []).map(redact), blocker: redact(task.blocker?.reason), dependencies: (task.plan_depends_on || []).map((id) => ({ id, status: state.tasks[id]?.status || "missing" })), handoffs: handoffs.items.map((item) => ({ id: item.id, status: item.status, handoff: item.handoff, reason: redact(item.reason), baselineAvailable: item.baselineAvailable, workspaceAvailable: item.workspaceAvailable })), evidence: (task.evidence || []).slice(-8).map((item) => ({ kind: item.kind, result: item.result, check: redact(item.check), detail: redact(item.detail) })), recovery: task.recovery ? { cause: task.recovery.cause, status: task.recovery.status, attempts: (task.recovery.attempts || []).map((attempt) => ({ action: attempt.action, status: attempt.status })) } : null };
}

export function createAssistant(root, { launch = spawn, providerStatus = builtinProviderStatus, providerConfig = () => ({}), discover = discoverProvider } = {}) {
  const active = new Map();
  function read(scope) {
    if (!validScope(scope)) throw new Error("Invalid assistant scope.");
    let session; try { session = JSON.parse(fs.readFileSync(fileFor(root, scope), "utf8")); } catch { return { scope, status: "idle", messages: [] }; }
    if (session.status === "running" && !active.has(scope)) { session.status = "interrupted"; session.error = "Server restarted or provider session was interrupted. Review before sending another message."; save(root, session); }
    return session;
  }
  function start({ scope, provider, model, message, mode = "diagnose", workspace: approvedWorkspace = null }) {
    const context = assistantContext(root, scope);
    if (!["diagnose", "fix"].includes(mode)) throw new Error("Unknown assistant mode.");
    const workspace = mode === "fix" ? assistantWorkspace(root, scope) : root;
    if (mode === "fix" && workspace !== approvedWorkspace) throw new Error("Task workspace changed; review the request again.");
    if (active.size) throw new Error("Another assistant provider session is active.");
    if (!["codex", "gapgpt"].includes(provider)) throw new Error("This assistant supports the built-in Codex and GapCode providers only.");
    if (typeof message !== "string" || !message.trim() || message.length > 12000 || keyPattern.test(message)) throw new Error("Enter a message under 12,000 characters without credentials or secrets.");
    const worker = providerStatus(providerConfig()).find((item) => item.id === provider);
    if (!worker?.installed || !worker.signedIn) throw new Error("Provider must be installed and signed in before starting a session.");
    const selectedModel = String(model || worker.defaultModel || "");
    if (selectedModel && (!/^[A-Za-z0-9._:-]{1,120}$/.test(selectedModel) || ![worker.defaultModel, ...(worker.models || []).map((item) => item.id)].includes(selectedModel))) throw new Error("Choose an available provider model.");
    const discovery = discover(provider, { command: worker.command });
    if (!discovery.available) throw new Error(discovery.error);
    const session = read(scope); session.messages ||= [];
    session.messages.push({ role: "user", text: message.trim(), at: new Date().toISOString() });
    session.messages = session.messages.slice(-30); session.status = "running"; session.mode = mode; session.workspace = mode === "fix" ? workspace : null; session.provider = provider; session.model = selectedModel || null; session.error = null; session.output = ""; session.diagnostic = ""; session.cancelled = false; session.startedAt = new Date().toISOString();
    const instruction = mode === "fix" ? "Investigate and fix the user's issue in this task workspace. Preserve unrelated changes, run relevant checks, and report exact results and remaining blockers. Do not modify ATL state, credentials, budgets, approvals, or files outside this workspace. Do not claim review approval or task completion. Return your changes for independent review." : "Diagnose and propose steps only. Do not modify files, task state, credentials, budgets, or approvals. The owner must separately approve and run any change.";
    const prompt = `You are the ATL control-plane assistant. ${instruction} Never claim checks passed without evidence.\nContext: ${JSON.stringify(context)}\nConversation: ${JSON.stringify(session.messages)}\n`;
    const args = ["exec", ...(selectedModel ? ["--model", selectedModel] : []), "--cd", workspace, "--sandbox", mode === "fix" ? "workspace-write" : "read-only", "--ephemeral", "--skip-git-repo-check", "-"];
    let command = discovery.path; let actualArgs = args; let windowsVerbatimArguments = false;
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) { const quote = (value) => `"${String(value).replace(/"/g, '""')}"`; actualArgs = ["/d", "/s", "/c", `"${[command, ...args].map(quote).join(" ")}"`]; command = process.env.ComSpec || "cmd.exe"; windowsVerbatimArguments = true; }
    const lock = mode === "fix" ? beginQueueRun(root, `assistant-${scope}`) : null;
    try { save(root, session); } catch (error) { if (lock) endQueueRun(root, lock); throw error; }
    let child;
    try { child = launch(command, actualArgs, { cwd: workspace, windowsHide: true, windowsVerbatimArguments, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { if (lock) endQueueRun(root, lock); session.status = "failed"; session.error = redact(error.message); save(root, session); throw error; }
    active.set(scope, { child, session });
    child.stdin.on("error", () => {}); child.stdin.end(prompt);
    child.stdout.on("data", (chunk) => { session.output = redact((session.output + chunk.toString("utf8")).slice(-100000)); save(root, session); });
    child.stderr.on("data", (chunk) => { session.diagnostic = redact(((session.diagnostic || "") + chunk.toString("utf8")).slice(-4000)); save(root, session); });
    const timer = setTimeout(() => { session.error = "Provider session timed out."; child.kill(); }, 15 * 60 * 1000); timer.unref?.();
    child.on("error", (error) => { session.error = redact(error.message); });
    child.on("close", (code) => { clearTimeout(timer); active.delete(scope); if (lock) endQueueRun(root, lock); if (mode === "fix" && /^(?:GapCode|OpenAI Codex) v/m.test(session.diagnostic) && /^sandbox:\s*read-only\s*$/m.test(session.diagnostic)) session.error = "Provider started with a read-only sandbox; the requested workspace fix could not be applied."; session.status = session.cancelled ? "cancelled" : code === 0 && !session.error ? (mode === "fix" ? "awaiting-review" : "complete") : "failed"; if (session.output) session.messages.push({ role: "assistant", text: session.output, at: new Date().toISOString() }); if (code !== 0 && !session.error) session.error = `Provider exited with code ${code}.`; session.finishedAt = new Date().toISOString(); save(root, session); });
    return session;
  }
  function cancel(scope) { const running = active.get(scope); if (!running) throw new Error("No active assistant session."); running.session.cancelled = true; save(root, running.session); running.child.kill(); return running.session; }
  return { read, start, cancel };
}
export const assistantMessageDigest = (message) => crypto.createHash("sha256").update(message).digest("hex");
