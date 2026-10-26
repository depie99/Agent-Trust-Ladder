import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

export function probeUiReviewRuntime(root, workspace = root) {
  let playwrightRoot = null;
  try {
    const manifest = require.resolve("playwright/package.json", { paths: [workspace, root] });
    playwrightRoot = path.dirname(manifest);
  } catch { /* the browser may still be supplied by the host */ }
  const browser = firstExisting([
    process.env.ATL_BROWSER_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ]);
  const available = Boolean(playwrightRoot && browser);
  return {
    available,
    playwrightRoot,
    browserExecutable: browser,
    workspace,
    evidenceDir: path.join(workspace, ".trust", "manager", "evidence", "ui-review"),
    reason: available ? null : `browser runtime unavailable: ${!playwrightRoot ? "Playwright is not resolvable from the workspace/project" : "no Chrome, Edge, or configured browser executable"}`,
  };
}

export function uiReviewPrompt(runtime) {
  if (!runtime) return "";
  return `\n\nUI REVIEW RUNTIME (probed before this session):\n- Playwright module: ${runtime.playwrightRoot || "unavailable"}\n- Browser executable: ${runtime.browserExecutable || "unavailable"}\n- Evidence directory: ${runtime.evidenceDir}\nUse this exact runtime for rendered checks. Do not claim a UI cell observed without saving evidence there.`;
}
