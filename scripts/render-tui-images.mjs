// Regenerate the terminal interface images in docs/diagrams/tui-*.svg.
//
// The frames are produced by the real dashboard renderers in
// runtime/lib/dashboard.mjs against a fixed demo portfolio, then translated
// ANSI -> SVG with the same palette the TUI paints. Nothing here starts a
// provider session. Run from the repo root: node scripts/render-tui-images.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderDashboard,
  renderComposeScreen,
  renderReviewScreen,
  renderQueueScreen,
  renderLaunchPreviewScreen,
  renderRunScreen,
  renderProvidersScreen,
} from "../runtime/lib/dashboard.mjs";
import {
  providerForRole,
} from "../runtime/lib/providers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "docs", "diagrams");

// ---------- the demo portfolio the images render ----------

const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60_000).toISOString();

const tasks = [
  {
    id: "T-001", title: "Fix login redirect loop on expired sessions", status: "in_progress",
    priority: "urgent", risk: "normal", assigned_worker: "rowan", attempt_count: 1,
    updated_at: minsAgo(4), created_at: minsAgo(320),
    objective: "An expired session redirects to /login exactly once and returns to the original deep link after sign-in.",
    completion_checks: [
      "valid session is never bounced to /login",
      "expired session redirects exactly once",
      "original deep link is restored after sign-in",
    ],
    evidence: [
      { kind: "check", check: "valid session is never bounced to /login", result: "pass", actor: "rowan", at: minsAgo(18) },
      { kind: "check", check: "expired session redirects exactly once", result: "pass", actor: "rowan", at: minsAgo(12) },
      { kind: "note", actor: "rowan", detail: "middleware guard rewritten in the isolated workspace; refresh-path coverage added.", at: minsAgo(9) },
    ],
    resources: [{ kind: "url", label: "issue", ref: "https://github.com/acme/app/issues/12" }],
    source: { type: "github", url: "https://github.com/acme/app/issues/12" },
    selected_skills: ["atl-implement"], proposed_worker: "rowan",
    composition: { intent: "Fix a problem", audience: "Repository / code" },
  },
  {
    id: "T-004", title: "Restore staging snapshot for migration rehearsal", status: "blocked",
    priority: "high", risk: "risky", assigned_worker: "rowan", attempt_count: 0,
    updated_at: minsAgo(26), created_at: minsAgo(200),
    objective: "A rehearsed migration run completes against a staging snapshot no older than 24h.",
    completion_checks: ["migration rehearsal completes on the restored snapshot"],
    evidence: [],
    resources: [],
    blocker: { reason: "waiting on the restored staging snapshot (platform ticket PLAT-88)", at: minsAgo(26) },
    next_wake_at: minsAgo(-120),
    source: { type: "manual" },
    selected_skills: [], proposed_worker: "rowan",
  },
  {
    id: "T-002", title: "Stream per-tenant audit logs to the warehouse", status: "in_review",
    priority: "normal", risk: "normal", assigned_worker: "sage", attempt_count: 1,
    updated_at: minsAgo(63), created_at: minsAgo(700),
    objective: "Audit events land in the warehouse within one minute of emission, keyed by tenant.",
    completion_checks: ["audit events appear in the warehouse within 60s", "tenant key is present on every event"],
    evidence: [{ kind: "review", result: "pass", actor: "sage", detail: "approve: pipeline verified end to end on the staging tenant.", at: minsAgo(30) }],
    resources: [],
    source: { type: "inbox", url: "2026-10-20-audit-streaming.md" },
    selected_skills: ["atl-implement"], proposed_worker: "rowan",
  },
  {
    id: "T-003", title: "Spike: cache the pricing table lookup", status: "new",
    priority: "normal", risk: "normal", attempt_count: 0,
    updated_at: minsAgo(11), created_at: minsAgo(11),
    completion_checks: [],
    evidence: [], resources: [], source: { type: "inbox", url: "2026-10-21-pricing-cache.md" },
  },
  {
    id: "T-007", title: "Migrate auth middleware to the new session store", status: "assigned",
    priority: "normal", risk: "risky", assigned_worker: "rowan", attempt_count: 0,
    updated_at: minsAgo(48), created_at: minsAgo(500),
    objective: "All session reads and writes go through the new store with the old store shadow-read for one release.",
    completion_checks: ["no direct reads of the legacy session store remain", "shadow-read mismatch rate logged and under 0.1%"],
    evidence: [], resources: [], review_required: true,
    source: { type: "inbox", url: "2026-10-19-session-store.md" },
    selected_skills: ["atl-implement"], proposed_worker: "rowan",
  },
  {
    id: "T-008", title: "Split the worker retry budget by risk", status: "assigned",
    priority: "normal", risk: "normal", assigned_worker: "rowan", attempt_count: 0,
    updated_at: minsAgo(39), created_at: minsAgo(400),
    objective: "Risky tasks keep the default three-attempt budget; normal tasks may use five.",
    completion_checks: ["retry budget honors the task risk class"],
    evidence: [], resources: [], source: { type: "manual" },
    selected_skills: [], proposed_worker: "rowan",
  },
  {
    id: "T-006", title: "Document the atl overnight budget flags", status: "triaged",
    priority: "low", risk: "normal", attempt_count: 0,
    updated_at: minsAgo(150), created_at: minsAgo(300),
    completion_checks: ["USAGE.md shows --max-minutes and --max-sessions with examples"],
    evidence: [], resources: [], source: { type: "manual" },
  },
  {
    id: "T-005", title: "Rotate the CI cache key", status: "done",
    priority: "normal", risk: "normal", assigned_worker: "beacon", attempt_count: 1,
    updated_at: minsAgo(220), created_at: minsAgo(900),
    objective: "CI restores from a fresh cache key; stale caches cannot shadow new installs.",
    completion_checks: ["a clean CI run restores from the new key"],
    evidence: [{ kind: "check", check: "a clean CI run restores from the new key", result: "pass", actor: "beacon", at: minsAgo(221) }],
    resources: [], source: { type: "manual" },
  },
];

const feed = [
  { at: minsAgo(75), from: "pip", text: "T-002 handed to review — warehouse round-trip measured at 41s on the staging tenant." },
  { at: minsAgo(63), from: "sage", text: "T-002 verdict: approve. Evidence packet matches the diff; one advisory note on retry logging.", kind: "card", status: "in_review" },
  { at: minsAgo(31), from: "manager", text: "T-001 queued for execution — waiting for a launch preview." },
  { at: minsAgo(26), from: "rowan", text: "T-004 blocked honestly: the staging snapshot is still restoring (PLAT-88). Retry timer set for 2h.", kind: "card", status: "blocked" },
  { at: minsAgo(9), from: "rowan", text: "T-001 ● checkpoint: middleware guard rewritten, refresh-path coverage added. 2/3 checks observed passing.", kind: "card", status: "in_progress" },
  { at: minsAgo(2), from: "beacon", text: "T-005 closed — clean CI run restored from the new cache key. Evidence attached.", kind: "card", status: "done" },
];

const actions = [
  { task: "T-003", for: "pip", what: 'triage "Spike: cache the pricing table lookup" (new, priority normal)' },
  { task: "T-006", for: "mira", what: 'assign "Document the atl overnight budget flags" (triaged, unassigned)' },
  { task: "T-004", for: "manager", what: "blocked — waiting on the staging snapshot; unblock when PLAT-88 lands" },
];

const queue = [
  { id: "T-001", added_by: "manager", added_at: minsAgo(31) },
  { id: "T-007", added_by: "manager", added_at: minsAgo(12) },
];

const counts = {};
for (const task of tasks) counts[task.status] = (counts[task.status] || 0) + 1;

// The demo tells one coherent provider story: a stored Z.ai GLM provider is
// the project default, so role sessions run on the claude worker against
// glm-4.6, while the subscription built-ins stay available. The registry
// entry is synthetic — never the machine's real ~/.atl/providers.json.
const userProvider = {
  id: "zai",
  label: "Z.ai GLM (international)",
  worker: "claude",
  base_url: "https://api.z.ai/api/anthropic",
  api_key: "sk-abcd1234efgh5678ijkl",
  model: "glm-4.6",
  models: ["glm-4.6", "glm-4.5", "glm-4.5-air"],
  created_at: minsAgo(4300),
  updated_at: minsAgo(35),
};
const demoProfile = {
  defaultWorker: "claude",
  defaultModel: "glm-4.6",
  auth: "subscription",
  use: "zai",
  userProviders: { zai: userProvider },
  byRole: {},
  modelByRole: {},
  catalog: {},
  raw: { use: "zai" },
};
const providers = { codex: true, claude: true, zai: true };

const snapshot = {
  root: repoRoot,
  state: { updated_at: minsAgo(1), log: [], tasks: {} },
  tasks,
  counts,
  active: tasks.filter((t) => !["done", "rejected"].includes(t.status)),
  feed,
  actions,
  queue,
  providers,
  providerProfile: demoProfile,
  userProviders: demoProfile.userProviders,
  updatedAt: minsAgo(1),
  lastEvent: { at: minsAgo(2), actor: "rowan", event: "transition", task: "T-001", detail: "checkpoint: 2/3 checks observed" },
};

// A launch plan in the exact shape buildLaunchPlan returns (pure: starts nothing).
const workspaceOf = (id) => `D:\\proj\\acme-app\\.trust\\manager\\workspaces\\${id}`;
const roleProvider = (role) => providerForRole(demoProfile, role);
const planItem = (task, role, extra = {}) => ({
  taskId: task.id,
  priority: task.priority || "normal",
  status: task.status,
  role,
  provider: roleProvider(role),
  title: task.title,
  workspace: task.id === "T-001" ? workspaceOf(task.id) : null,
  workspaceNote: task.id === "T-001" ? null : "isolated workspace is created on start",
  command: role ? `claude -p --model glm-4.6 --add-dir D:\\proj\\acme-app --add-dir ${workspaceOf(task.id)} --permission-mode acceptEdits --permission-prompts none --no-session-persistence --output-format text   (role prompt on stdin)` : null,
  sessionLogs: `.trust/manager/overnight/${task.id}/session-NN-${role || "-"}.log`,
  containment: [
    "sandbox: workspace-write, task workspace only",
    "no merge, push, deploy, spend, policy, or external messages",
    "state advances only via observed atl commands/evidence",
  ],
  blockers: [],
  ...extra,
});
const launchPlan = {
  root: repoRoot,
  createdAt: minsAgo(9),
  budget: { maxMinutes: 120, maxSessions: 5 },
  profile: demoProfile,
  order: ["T-001", "T-007"],
  items: [planItem(tasks[0], "rowan"), planItem(tasks.find((t) => t.id === "T-007"), "rowan")],
  readyCount: 2,
  blockedCount: 0,
  confirmCommand: "atl launch --confirm",
};

const runUi = {
  running: true,
  runStartedAt: now - 212_000,
  runEndedAt: null,
  runCurrent: {
    taskId: "T-001", role: "rowan", provider: "claude", model: "glm-4.6",
    session: 1, sessionMax: 5, startedAt: now - 97_000, phase: "working in isolated workspace",
  },
  runTasks: [
    { taskId: "T-001", role: "rowan", provider: "claude/api", state: "running", status: null, session: 1, sessionMax: 5, startedAt: now - 97_000, exit: null, reason: null },
    { taskId: "T-007", role: "rowan", provider: "claude/api", state: "queued", status: null, session: 0, sessionMax: null, startedAt: null, exit: null, reason: null },
  ],
  runLines: [],
  runLogName: "session-01-rowan.log",
  runLogTail: [
    "rowan: reading task packet T-001",
    "rowan: isolated workspace ready (.trust/manager/workspaces/T-001)",
    "rowan: editing server/middleware/session.js",
    "rowan: adding regression coverage for the refresh path",
    "rowan: running checks — 2/3 passing",
  ],
};

// ---------- ANSI frame -> terminal-styled SVG ----------

const CHAR_W = 7.8;
const LINE_H = 19;
const FONT_SIZE = 13;
const PAD_X = 28;
const BAR_H = 46;
const PAD_TOP = 16;
const PAD_BOTTOM = 20;
const INK = "#f5f5f7";

const rgb = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const escapeXml = (text) => String(text)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// Walk one frame line, honoring the SGR subset the renderers emit:
// 38;2;r;g;b / 39 (foreground), 48;2;r;g;b / 49 (background), 1 (bold), 0 (reset).
function parseAnsiLine(line) {
  const runs = [];
  let fg = null;
  let bg = null;
  let bold = false;
  let col = 0;
  let buffer = "";
  let bufferStart = 0;
  const flush = () => {
    if (buffer) {
      runs.push({ text: buffer, fg, bg, bold, start: bufferStart, len: buffer.length });
      buffer = "";
    }
  };
  const pieces = line.split(/(\x1b\[[0-9;]*m)/);
  for (const piece of pieces) {
    const match = piece.match(/^\x1b\[([0-9;]*)m$/);
    if (match) {
      const codes = match[1].split(";").map(Number);
      for (let i = 0; i < codes.length; i += 1) {
        const code = codes[i];
        if (code === 0) { fg = null; bg = null; bold = false; }
        else if (code === 1) bold = true;
        else if (code === 38 && codes[i + 1] === 2) { fg = rgb(codes.slice(i + 2, i + 5)); i += 4; }
        else if (code === 39) fg = null;
        else if (code === 48 && codes[i + 1] === 2) { bg = rgb(codes.slice(i + 2, i + 5)); i += 4; }
        else if (code === 49) bg = null;
      }
      continue;
    }
    if (!piece) continue;
    // Renderer grid assumption: one JS char per column (emoji surrogate pairs
    // count as two), which widthOf() uses. Keep runs of mixed emoji out of
    // textLength so wide glyphs are not squashed.
    const start = col;
    col += piece.length;
    if (fg === null && bg === null && !bold && !piece.trim()) continue; // plain whitespace, skip
    if (/[\uD800-\uDBFF]/.test(piece)) {
      flush();
      runs.push({ text: piece, fg, bg, bold, start, len: piece.length, natural: true });
    } else {
      if (!buffer) bufferStart = start;
      buffer += piece;
    }
  }
  flush();
  return runs;
}

function frameSvg(frame, { title, id }) {
  const lines = frame.split("\n");
  const cols = Math.max(...lines.map((l) => l.replace(/\t/g, "  ").length));
  const width = Math.round(cols * CHAR_W + PAD_X * 2);
  const height = Math.round(BAR_H + PAD_TOP + lines.length * LINE_H + PAD_BOTTOM);
  const top = BAR_H + PAD_TOP;
  const body = [];
  let lineNo = 0;
  for (const line of lines) {
    const y = top + lineNo * LINE_H + FONT_SIZE + 1;
    const runs = parseAnsiLine(line);
    for (const run of runs) {
      const x = PAD_X + run.start * CHAR_W;
      if (run.bg) body.push(`<rect x="${(x - 1.5).toFixed(1)}" y="${(y - FONT_SIZE - 1).toFixed(1)}" width="${(run.len * CHAR_W + 3).toFixed(1)}" height="${LINE_H}" fill="${run.bg}"/>`);
      const fill = run.fg || INK;
      const weight = run.bold ? ' font-weight="700"' : "";
      const stretch = run.natural ? "" : ` textLength="${(run.len * CHAR_W).toFixed(1)}"`;
      body.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}"${weight}${stretch} xml:space="preserve">${escapeXml(run.text)}</text>`);
    }
    lineNo += 1;
  }
  const dot = (cx, fill) => `<circle cx="${cx}" cy="${BAR_H / 2 + 2}" r="6" fill="${fill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t-${id} d-${id}">
  <title id="t-${id}">${escapeXml(title)}</title>
  <desc id="d-${id}">Terminal window showing the ATL control room: ${escapeXml(title)}. Generated by scripts/render-tui-images.mjs from the live dashboard renderers.</desc>
  <defs>
    <linearGradient id="bg-${id}" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0c0d13"/><stop offset="1" stop-color="#141322"/></linearGradient>
    <style>
      text{font-family:ui-monospace,'Cascadia Mono','Cascadia Code',Consolas,Menlo,monospace;font-size:${FONT_SIZE}px}
      .title{fill:#8a8ca0;font-size:12.5px;font-family:'Segoe UI',system-ui,sans-serif;letter-spacing:.4px}
    </style>
  </defs>
  <rect width="${width}" height="${height}" rx="16" fill="url(#bg-${id})"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="15" fill="none" stroke="#3d3752"/>
  <line x1="1" y1="${BAR_H}" x2="${width - 1}" y2="${BAR_H}" stroke="#26272f"/>
  ${dot(PAD_X + 4, "#fa8f83")}${dot(PAD_X + 24, "#f4c67e")}${dot(PAD_X + 44, "#5fe0c2")}
  <text x="${width / 2}" y="${BAR_H / 2 + 6}" text-anchor="middle" class="title">${escapeXml(title)}</text>
  ${body.join("\n  ")}
</svg>
`;
}

// ---------- render + write ----------

const shots = [
  {
    id: "dashboard", title: "atl ui — the control room", file: "tui-dashboard.svg",
    frame: () => renderDashboard(snapshot, { width: 150, height: 36, interactive: true, syncedAt: now - 2_000, selected: 0 }),
  },
  {
    id: "compose", title: "atl ui — c · compose", file: "tui-compose.svg",
    frame: () => renderComposeScreen({ composeFlow: { step: "intent", intentIndex: 1, audienceIndex: 0 } }, 150, 26),
  },
  {
    id: "review", title: "atl ui — e · packet review", file: "tui-review.svg",
    frame: () => renderReviewScreen(snapshot, { reviewTaskId: "T-001" }, 150, 28),
  },
  {
    id: "queue", title: "atl ui — Q · execution queue", file: "tui-queue.svg",
    frame: () => renderQueueScreen(snapshot, { launchPlan, runTasks: [], queueSelected: 0 }, 150, 16),
  },
  {
    id: "launch", title: "atl ui — l · launch preview", file: "tui-launch.svg",
    frame: () => renderLaunchPreviewScreen({ launchPlan }, 150, 24),
  },
  {
    id: "run", title: "atl ui — confirmed queue run", file: "tui-run.svg",
    frame: () => renderRunScreen(runUi, 150, 24),
  },
  {
    id: "providers", title: "atl ui — p · providers", file: "tui-providers.svg",
    frame: () => renderProvidersScreen(snapshot, { providerSelected: 0 }, 150, 24),
  },
];

fs.mkdirSync(outDir, { recursive: true });
for (const shot of shots) {
  const frame = shot.frame();
  const plain = frame.replace(/\x1b\[[0-9;]*m/g, "");
  if (process.argv.includes("--frames")) fs.writeFileSync(path.join(outDir, shot.file.replace(/\.svg$/, ".txt")), plain);
  const svg = frameSvg(frame, { title: shot.title, id: shot.id });
  const out = path.join(outDir, shot.file);
  fs.writeFileSync(out, svg);
  console.log(`wrote docs/diagrams/${shot.file}  (${Math.round(svg.length / 1024)}KB, ${frame.split("\n").length} rows)`);
}
