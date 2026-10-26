// Bounded local agent execution for an explicit ATL overnight run.
// The runtime is provider-neutral: built-in Codex/Claude adapters and
// user-defined command profiles receive the same ATL role contract and stop at
// the same state gates.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(RUNTIME_DIR, "..", "prompts");
const TERMINAL = new Set(["done", "rejected", "archived", "escalated", "blocked"]);

// These variables can make Claude Code prefer API/provider billing over a
// claude.ai subscription. They are removed only from a subscription-mode
// child; ATL never mutates the parent shell.
export const CLAUDE_SUBSCRIPTION_UNSET_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
  "CLAUDE_CODE_SKIP_VERTEX_AUTH",
];

export const ROLE_BY_STATUS = {
  new: "pip",
  triaged: "mira",
  assigned: "rowan",
  in_progress: "rowan",
  in_review: "sage",
  verifying: "beacon",
};

export function nextRole(task) {
  if (!task || TERMINAL.has(task.status)) return null;
  return ROLE_BY_STATUS[task.status] || null;
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

// Queue order for `overnight --all`: priority first, then task id (numeric).
export function queueSelect(tasks) {
  return [...(tasks || [])]
    .filter((t) => t && t.status && !TERMINAL.has(t.status))
    .sort((a, b) =>
      ((PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)) ||
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
}

export function assertWorkerAuth(worker, auth = "subscription") {
  if (worker !== "claude") return;
  if (!["subscription", "api"].includes(auth)) {
    throw new Error(`Unknown Claude auth mode "${auth}". Use subscription or api.`);
  }
}

export function workerEnvPolicy(worker, auth = "subscription", env = process.env) {
  assertWorkerAuth(worker, auth);
  if (worker !== "claude" || auth !== "subscription") {
    return { unset: [], stripped: [], set: { ATL_BIN: fileURLToPath(new URL("../atl-manager.mjs", import.meta.url)) } };
  }
  return {
    unset: [...CLAUDE_SUBSCRIPTION_UNSET_ENV],
    stripped: CLAUDE_SUBSCRIPTION_UNSET_ENV.filter((key) => Boolean(env[key])),
    set: { ATL_BIN: fileURLToPath(new URL("../atl-manager.mjs", import.meta.url)) },
  };
}

function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function promptFor(role, task, root, workspace, feedback = [], navigationContext = "") {
  const promptPath = path.join(PROMPT_DIR, `${role}.md`);
  const contract = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf8") : `Act as ATL role: ${role}.`;
  const checks = (task.completion_checks || []).map((check) => `- ${check}`).join("\n") || "- (Pip must define observable checks first)";
  const workdir = workspace || root;
  const feedbackBlock = feedback.length ? `\n\n## Human feedback to apply before acting\n${feedback.map((item) => `- [${item.id}] ${item.prompt}`).join("\n")}\nTreat this as a new manager instruction for this bounded stage. Explain how it changed your approach and record the result in your checkpoint or handoff.\n` : "";
  return `${contract.trim()}

## Bounded ATL worker run

You are one stage in an explicit, unattended ATL run. Do not invent a later stage.
Use the ATL runner for every state, evidence, checkpoint, assignment, block, or
escalation change. The absolute ATL runner path is available in ATL_BIN. Invoke
it as 'node "$env:ATL_BIN"' on Windows or 'node "$ATL_BIN"' on POSIX; do not
rely on PATH or an installed shell alias;
the project root is '${root}'.

Task: ${task.id} — ${task.title}
Current status: ${task.status}
Objective: ${task.objective || task.objective_hint || "(not yet bounded)"}
Completion checks:
${checks}
Assigned worker: ${task.assigned_worker || "not assigned"}
Task workspace: ${workdir}
Resources (project-root-relative paths or URLs):
${(task.resources || []).map((resource) => `- [${resource.kind}] ${resource.label}: ${resource.ref}${resource.caption ? ` — ${resource.caption}` : ""}${resource.missing ? " (missing at intake)" : ""}`).join("\n") || "- none"}
Evidence-linked context (advisory; cite sources and do not treat UNKNOWN or CONFLICTED claims as settled):
${(task.brain_context?.claims || []).map((claim) => `- [${claim.status}] ${claim.text} (source ${claim.source_id}, revision ${claim.source_revision})`).join("\n") || "- none"}

Hard boundaries:
- Work only in the role and stage named above.
- Do not merge, deploy, push, spend money, change policy, or message externally.
- Do not touch another task's workspace.
- Stop and record a blocker or escalation when required input, access, or evidence is missing.
- Respect the task's attempt budget. A process timeout or CLI failure is not success.
- Before exiting, record the truthful state, evidence, checkpoint, review, or handoff through ATL.
${feedbackBlock}${navigationContext}`;
}

function expandProviderArg(value, { root, cwd, workspace, role, task, auth, provider, prompt }) {
  const tokens = {
    root,
    cwd,
    workspace: workspace || root,
    role,
    task: task.id,
    task_id: task.id,
    auth,
    model: provider?.model || "",
    prompt,
  };
  return String(value).replace(/\{([a-z_]+)\}/gi, (full, key) => Object.prototype.hasOwnProperty.call(tokens, key) ? String(tokens[key]) : full);
}

export function buildInvocation(worker, { root, workspace, role, task, auth = "subscription", provider = null, feedback = [], navigationContext = "", uiReviewRuntime = null }) {
  const cwd = workspace || root;
  const prompt = promptFor(role, task, root, workspace, feedback, navigationContext) + (uiReviewRuntime?.prompt || "");
  if (provider && Array.isArray(provider.args)) {
    const args = provider.args.map((arg) => expandProviderArg(arg, { root, cwd, workspace, role, task, auth, provider, prompt }));
    if (provider.promptArg) args.push(expandProviderArg(provider.promptArg, { root, cwd, workspace, role, task, auth, provider, prompt }));
    return {
      command: provider.command,
      args,
      cwd,
      prompt,
    };
  }
  // The prompt travels on stdin (both CLIs read stdin when the prompt
  // argument is omitted or "-"): command lines stay short and Windows-safe.
  if (worker === "codex") {
    return {
      command: executable("codex"),
      args: [
        "exec",
        ...(provider?.model ? ["--model", provider.model] : []),
        "--cd", cwd,
        "--sandbox", "workspace-write",
        "--ephemeral",
        "-",
      ],
      cwd,
      prompt,
    };
  }
  if (worker === "claude") {
    return {
      command: executable("claude"),
      args: [
        "-p",
        ...(provider?.model ? ["--model", provider.model] : []),
        "--add-dir", cwd,
        "--permission-mode", "acceptEdits",
        "--permission-prompts", "none",
        "--no-session-persistence",
        "--output-format", "text",
      ],
      cwd,
      prompt,
    };
  }
  throw new Error(`Unknown worker "${worker}". Add providers.catalog.${worker} with a command and args; use "-" in args when the CLI reads the ATL prompt from stdin.`);
}

function killProcess(child) {
  if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 2000).unref();
}

// The one worker session this process currently runs, if any. The launch
// queue's abort path uses it to stop the live session (operator abort), so
// the spawn/exit lifecycle below keeps it current.
const activeChildren = new Set();

export function abortActiveWorker() {
  if (!activeChildren.size) return false;
  for (const child of activeChildren) killProcess(child);
  return true;
}

// Node ≥18.20 refuses to spawn .cmd/.bat shims directly (CVE-2024-27980,
// spawn EINVAL). Route those through cmd.exe with verbatim, self-quoted
// arguments. Real .exe binaries spawn directly.
function spawnPlan(command, args) {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args, windowsVerbatimArguments: false };
  }
  const quote = (a) => (/[\s&()^%!"<>|]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const line = [command, ...args].map(quote).join(" ");
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
}

// Worker transcripts belong to the session log. Callers must opt in to echoing
// provider output into their own terminal; the default keeps raw prompts,
// retries, and provider diagnostics out of the control-room UI.
export function runInvocation(invocation, { env, unsetEnv = [], logPath, timeoutMs, echo = false, stdinText, captureStdout = false }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.createWriteStream(logPath, { flags: "w" });
  const startedAt = new Date().toISOString();
  let timedOut = false;
  let settled = false;
  let captured = "";
  const plan = spawnPlan(invocation.command, invocation.args);

  return new Promise((resolve, reject) => {
    let child;
    try {
      const childEnv = { ...process.env, ...env };
      for (const key of unsetEnv) delete childEnv[key];
      child = spawn(plan.command, plan.args, {
        cwd: invocation.cwd,
        env: childEnv,
        windowsHide: true,
        windowsVerbatimArguments: plan.windowsVerbatimArguments,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      log.end();
      reject(error);
      return;
    }
    activeChildren.add(child);

    // Feed the prompt on stdin; ignore EPIPE if the child exits early.
    child.stdin.on("error", () => {});
    if (stdinText !== undefined) child.stdin.write(stdinText);
    child.stdin.end();

    const write = (chunk, isError = false) => {
      log.write(chunk);
      if (captureStdout && !isError) captured += chunk.toString("utf8");
      if (echo) (isError ? process.stderr : process.stdout).write(chunk);
    };
    child.stdout.on("data", (chunk) => write(chunk));
    child.stderr.on("data", (chunk) => write(chunk, true));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      log.end();
      reject(error);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      write(Buffer.from(`\n[ATL] worker timeout after ${Math.round(timeoutMs / 60000)} minute(s)\n`), true);
      killProcess(child);
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      if (settled) return;
      settled = true;
      const finishedAt = new Date().toISOString();
      log.end();
      resolve({ code: code ?? 1, signal, timedOut, startedAt, finishedAt, logPath, text: captured });
    });
  });
}

export function isTerminal(status) {
  return TERMINAL.has(status);
}
