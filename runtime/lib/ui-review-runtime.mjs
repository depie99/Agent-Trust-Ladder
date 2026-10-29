import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { browserAccess } from "./browser-access.mjs";

const require = createRequire(import.meta.url);
export const UI_BROWSER_TOOLS = ["browser_preview", "browser_snapshot", "browser_action", "browser_inspect", "browser_screenshot", "browser_viewport", "browser_reload"];

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

export function probeUiReviewRuntime(root, workspace = root, { taskId = null } = {}) {
  const localToolsApproved = browserAccess(root, taskId, { validateTask: false }).mode === "approved";
  let playwrightRoot = null;
  let bundledBrowser = null;
  try {
    const manifest = require.resolve("playwright/package.json", { paths: [workspace, root] });
    playwrightRoot = path.dirname(manifest);
    bundledBrowser = require(path.join(playwrightRoot, "index.js")).chromium.executablePath();
  } catch { /* the browser may still be supplied by the host */ }
  const browser = firstExisting([
    process.env.ATL_BROWSER_EXECUTABLE,
    bundledBrowser,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ]);
  const available = Boolean(playwrightRoot && browser);
  return {
    root,
    localToolsApproved,
    available,
    playwrightRoot,
    browserExecutable: browser,
    workspace,
    evidenceDir: path.join(workspace, ".atl-evidence", "ui-review"),
    reason: available ? null : `browser runtime unavailable: ${!playwrightRoot ? "Playwright is not resolvable from the workspace/project" : "no Chrome, Edge, or configured browser executable"}`,
  };
}

// A task-local rendered regression belongs to its implementer as well as its
// reviewers. Do not infer browser needs from status, logs or blocker history.
export function needsUiReview(task, role) {
  if (!["rowan", "sage", "beacon"].includes(role)) return false;
  return /ui-review|rendered|visual inspection|browser journey|playwright|بررسی بصری/i.test(JSON.stringify({
    title: task.title, objective: task.objective, checks: task.completion_checks, integrated: task.integrated_checks,
    skills: task.selected_skills, route: task.skill_route,
  })) || (role === "beacon" && task.integrated_delivery === true);
}

export function uiReviewProviderArgs(worker, runtime) {
  if (!runtime?.available) return [];
  const spec = { command: process.execPath, args: [fileURLToPath(new URL("./ui-review-mcp.mjs", import.meta.url)), runtime.root, runtime.workspace] };
  if (["codex", "gapgpt"].includes(worker)) {
    // Only an explicit project-owner or task-owner setting can preapprove these seven
    // fixture-only tools. Never change the host-wide approval policy.
    const tools = runtime.localToolsApproved ? `,tools={${UI_BROWSER_TOOLS.map((name) => `${name}={approval_mode="approve"}`).join(",")}}` : "";
    const toml = `{command=${JSON.stringify(spec.command)},args=${JSON.stringify(spec.args)},required=true${tools}}`;
    return ["-c", `mcp_servers.atl_browser=${toml}`];
  }
  if (worker === "claude") return ["--mcp-config", JSON.stringify({ mcpServers: { atl_browser: spec } })];
  throw new Error(`Browser tools are not configured for provider ${worker}; configure a supported adapter before spending a task session.`);
}

export function uiReviewPrompt(runtime) {
  if (!runtime) return "";
  return `\n\nATL BROWSER TOOLS: the atl_browser MCP server is attached to this session, backed by an isolated Playwright browser. Start with browser_preview, then browser_snapshot to discover current selectors; use browser_action, browser_inspect and browser_screenshot to inspect the actual task assets. Screenshots are returned as images to you and saved with DOM/style observations under ${runtime.evidenceDir}. Preview data is synthetic and cannot mutate live manager state. This task-local check can precede downstream integrated UI review. A tool listing or successful screenshot capture is not a visual PASS: inspect the returned image, compare every requested behavior, and record PASS/FAIL/NOT OBSERVED per surface/locale. Obtain the current revision through the ATL revision command; record exact completion checks through the normal scoped observe command only after all check parts pass. Do not claim independent review from a builder session. If the host denies a tool or cannot display images, report the exact unavailable capability; do not bypass host policy, retry unchanged, or substitute an old screenshot. Browser availability is provisional until browser_preview succeeds. This session uses ${runtime.localToolsApproved ? "explicit owner approval for the seven isolated preview tools" : "the inherited host approval rules"}. The host-wide approval policy and sandbox remain unchanged.`;
}
