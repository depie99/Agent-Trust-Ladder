// Read-only terminal dashboard for the ATL manager.
//
// The dashboard is a projection of the authoritative state, with a small
// control-room surface for reversible task intake and queue membership.
// Provider launch is still owned by launch.mjs: the TUI presents an explicit
// confirmation gate and delegates the bounded queue run to that module.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { activeTasks, wakeActions } from "./render.mjs";
import { paths, loadState, saveState, logEvent, transition } from "./state.mjs";
import { AVATARS, NAMES, readFeed, post as feedPost } from "./feed.mjs";
import { applyDeterministicRoute, composeTask, importCandidates, normalizeDraftText } from "./composer.mjs";
import { loadQueue, queueAdd, queueIds, queueRemove, queueArchive, queueCreate, queuePause, queueRename, queueResume, queueSetActive } from "./queue.mjs";
import { buildLaunchPlan, executeLaunchQueue, requestRunAbort, requestSessionInterrupt } from "./launch.mjs";
import { unblockTask } from "./recovery.mjs";
import { addResourceToTask } from "./resources.mjs";
import { submitFeedback } from "./feedback.mjs";
import { intakeFromFiles, intakeFromAzure, intakeFromGitHub } from "./intake.mjs";
import { discoverProvider, providerForRole, providerModels, providerNames, providerProfile, providerSpec } from "./providers.mjs";
import { loadUserProviders, maskKey, PROVIDER_TEMPLATES, removeProvider, saveUserProviders, templateById, upsertProvider, wireMismatches } from "./userProviders.mjs";
import { layoutFor } from "./tui-layout.mjs";
import { dispatchTuiCommand, TUI_COMMANDS } from "./command-console.mjs";
import { createControlPlaneSnapshot } from "./control-plane.mjs";
import { frameIntent, savePlanDraft, loadPlanDraft, approvePlanDraft } from "./plan-studio.mjs";
import { usageFreshness } from "./usage.mjs";
import { archiveTask, createTaskInWorkspace, editTaskInWorkspace, restoreTask } from "./task-workspace.mjs";

export const STATUS_ORDER = [
  "new", "triaged", "assigned", "in_progress", "in_review", "verifying", "done",
];

const STATUS_LABELS = {
  new: "New",
  triaged: "Triaged",
  assigned: "Assigned",
  in_progress: "Running",
  in_review: "Review",
  verifying: "Verify",
  done: "Done",
  blocked: "Blocked",
  escalated: "Escalated",
  rejected: "Rejected",
  archived: "Archived",
};

const COMPACT_STATUS_LABELS = {
  new: "New",
  triaged: "Triage",
  assigned: "Assign",
  in_progress: "Run",
  in_review: "Review",
  verifying: "Verify",
  done: "Done",
  blocked: "Block",
  escalated: "Escalate",
  rejected: "Reject",
  archived: "Archive",
};

const STATUS_ICON = {
  new: "○",
  triaged: "◌",
  assigned: "◔",
  in_progress: "●",
  in_review: "◉",
  verifying: "◍",
  done: "◆",
  blocked: "×",
  escalated: "!",
  rejected: "–",
  archived: "⌁",
};

const STATUS_COLOR = {
  new: "muted",
  triaged: "violet",
  assigned: "violet",
  in_progress: "mint",
  in_review: "coral",
  verifying: "amber",
  done: "mint",
  blocked: "amber",
  escalated: "coral",
  rejected: "muted",
  archived: "muted",
};

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const SPINNER = ["◐", "◓", "◑", "◒"];
const RESET = "\x1b[0m";
const COLORS = {
  // These are the terminal equivalents of the prototype's dark navy system:
  // #0b1018 canvas, #121b28 panels, #192535 raised surfaces, and mint as the
  // primary action. Keeping the values here makes every page feel like the
  // supplied control-plane artifact instead of a separate legacy theme.
  ink: [228, 236, 247],
  muted: [139, 155, 176],
  faint: [118, 137, 165],
  violet: [190, 169, 255],
  mint: [79, 225, 182],
  amber: [243, 192, 115],
  coral: [251, 135, 146],
  line: [41, 56, 75],
  panel: [18, 27, 40],
  panel2: [25, 37, 53],
};
const SURFACES = {
  coral: [38, 29, 38],
  violet: [29, 34, 52],
  mint: [22, 53, 46],
};
const FOCUS_SURFACE = [32, 53, 47];

function paint(value, color, plain) {
  if (plain || !COLORS[color]) return String(value);
  const [r, g, b] = COLORS[color];
  // Reset only the foreground so panel surfaces can stay continuous behind
  // nested labels, icons, and status badges.
  return `\x1b[38;2;${r};${g};${b}m${value}\x1b[39m`;
}

function surface(value, accent, plain) {
  if (plain || !SURFACES[accent]) return String(value);
  const [r, g, b] = SURFACES[accent];
  return `\x1b[48;2;${r};${g};${b}m${value}\x1b[49m\x1b[39m`;
}

function focusRow(value, width, plain) {
  const row = fit(value, width);
  if (plain) return row;
  const [r, g, b] = FOCUS_SURFACE;
  return `\x1b[1m\x1b[38;2;255;255;255m\x1b[48;2;${r};${g};${b}m${row}${RESET}`;
}

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, "");
}

function widthOf(value) {
  return stripAnsi(value).replace(/\t/g, "  ").length;
}

function truncate(value, width) {
  const raw = String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, "  ");
  if (widthOf(raw) <= width) return raw;
  if (width <= 1) return stripAnsi(raw).slice(0, width);
  return `${stripAnsi(raw).slice(0, width - 1)}…`;
}

function fit(value, width) {
  const text = truncate(value, Math.max(0, width));
  return text + " ".repeat(Math.max(0, width - widthOf(text)));
}

function wrap(value, width) {
  const source = String(value ?? "").replace(/\r/g, "");
  if (!source) return [""];
  const output = [];
  for (const raw of source.split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (word.length > width) {
        if (line) output.push(line);
        let remaining = word;
        while (remaining.length > width) {
          output.push(remaining.slice(0, width));
          remaining = remaining.slice(width);
        }
        line = remaining;
      } else if (!line) {
        line = word;
      } else if (line.length + word.length + 1 <= width) {
        line += ` ${word}`;
      } else {
        output.push(line);
        line = word;
      }
    }
    if (line) output.push(line);
  }
  return output;
}

// Labels are memoized per ISO stamp: every feed redraw formats the same 80
// messages, and `toLocaleTimeString` builds a fresh Intl formatter per call —
// measured at ~5ms per dashboard draw on Windows, ~75% of total paint cost.
// The scope prefixes the key so the minute and second formatters never
// hand each other a cached label of the wrong shape.
function memoTime(iso, fallback, scope, format) {
  if (!iso) return fallback;
  const key = `${scope}\u0000${iso}`;
  let label = TIME_CACHE.get(key);
  if (label === undefined) {
    const date = new Date(iso);
    label = Number.isNaN(date.getTime()) ? fallback : format(date);
    if (TIME_CACHE.size > 2048) TIME_CACHE.clear();
    TIME_CACHE.set(key, label);
  }
  return label;
}

const TIME_CACHE = new Map();

function timeOf(iso) {
  return memoTime(iso, "--:--", "minute", (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
}

function timeOfSec(iso) {
  return memoTime(iso, "--:--:--", "second", (date) => date.toLocaleTimeString([], { hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
}

function elapsedOf(ms) {
  if (ms == null || ms < 0) return "-";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s` : `${m}m${String(s).padStart(2, "0")}s`;
}

// Last non-empty lines of a growing log file. A missing file (session not
// started yet, or raced with a rotate) is an empty tail, never an error.
export function tailFileLines(filePath, count) {
  if (!filePath) return [];
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim().length);
    return lines.slice(-Math.max(1, count)).map((line) => stripAnsi(line));
  } catch {
    return [];
  }
}

// Read a provider transcript without truncating evidence. ANSI is removed for
// the UI, but line boundaries and all text are preserved for wrapping/scroll.
export function readLogLines(filePath) {
  if (!filePath) return [];
  try {
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => stripAnsi(line));
  } catch {
    return [];
  }
}

// One chronological stream for the LOGS screen: state.json decisions
// (transitions, evidence, worker start/exit) merged with feed.jsonl narration.
export function mergedLogEntries(snapshot, { limit = 400 } = {}) {
  const entries = [];
  for (const event of snapshot.state?.log || []) {
    entries.push({
      at: event.at,
      who: event.actor || "state",
      kind: "state",
      task: event.task || null,
      text: [event.event, event.detail].filter(Boolean).join(" — "),
    });
  }
  for (const message of snapshot.feed || []) {
    entries.push({
      at: message.at,
      who: message.from || "team",
      kind: "feed",
      task: message.task || null,
      text: [message.text, message.detail].filter(Boolean).join(" — "),
    });
  }
  entries.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  return entries.slice(-limit);
}

function ageOf(iso) {
  if (!iso) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 2880) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || "Unknown");
}

function statusLine(status, plain, compact = false) {
  const label = compact ? (COMPACT_STATUS_LABELS[status] || statusLabel(status).slice(0, 7)) : statusLabel(status);
  return paint(`${STATUS_ICON[status] || "·"} ${label}`, STATUS_COLOR[status] || "muted", plain);
}

function taskSort(a, b) {
  const terminal = (status) => ["done", "rejected"].includes(status) ? 1 : 0;
  return terminal(a.status) - terminal(b.status) ||
    (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2) ||
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
}

function panel(title, body, width, height, { accent = "violet", plain = false } = {}) {
  const totalWidth = Math.max(24, width);
  const totalHeight = Math.max(4, height);
  const inner = totalWidth - 4;
  // Titles are content too: a focused/long title must never make the border
  // wider than its owning column and break the shell geometry.
  const topTitle = truncate(`─ ${stripAnsi(title)} `, Math.max(0, totalWidth - 2));
  const top = `┌${topTitle}${"─".repeat(Math.max(0, totalWidth - 2 - topTitle.length))}┐`;
  const bottom = `└${"─".repeat(totalWidth - 2)}┘`;
  const source = [];
  for (const item of body || []) {
    if (widthOf(item) <= inner) source.push(String(item));
    else source.push(...wrap(stripAnsi(item), inner));
  }
  const content = source.slice(0, totalHeight - 2);
  while (content.length < totalHeight - 2) content.push("");
  const border = plain ? "│" : paint("│", accent, false);
  const topLine = plain ? top : `${paint("┌", accent, false)}${paint(topTitle, accent, false)}${paint("─".repeat(Math.max(0, totalWidth - 2 - topTitle.length)), "line", false)}${paint("┐", accent, false)}`;
  const bottomLine = plain ? bottom : `${paint("└", accent, false)}${paint("─".repeat(totalWidth - 2), "line", false)}${paint("┘", accent, false)}`;
  return [
    topLine,
    ...content.map((line) => `${border} ${surface(fit(line, inner), accent, plain)} ${border}`),
    bottomLine,
  ];
}

function joinPanels(panels, gap = 1) {
  const height = Math.max(...panels.map((p) => p.length));
  const widths = panels.map((p) => Math.max(...p.map(widthOf)));
  const out = [];
  for (let row = 0; row < height; row += 1) {
    out.push(panels.map((p, index) => fit(p[row] || "", widths[index])).join(" ".repeat(gap)));
  }
  return out;
}

// The sidebar is intentionally a route map, not a second source of truth.
// It gives the manager a stable place to discover the same screens that are
// reachable by shortcuts, while narrow terminals keep the compact keyboard UI.
export const TUI_NAV_ITEMS = Object.freeze([
  ["dashboard", "Overview", "1"],
  ["tasks", "Tasks", "2"],
  ["plan", "Plan Studio", "3"],
  ["queue", "Queues", "4"],
  ["team", "Agent Team", "5"],
  ["activity", "Activity & Logs", "6"],
  ["usage", "Usage & Limits", "7"],
  ["settings", "Settings", "8"],
]);

export const TUI_SIDEBAR_WIDTH = 24;

// Medium terminals still need visible information architecture.  The old
// renderer silently dropped the sidebar below 120 columns, which made the
// interactive TUI look like the legacy three-pane dashboard and left mouse
// clicks with nowhere useful to land.  Keep the same routes, but pack them
// into a keyboard- and mouse-addressable switcher when the full sidebar does
// not fit.
function routeSwitcherLayout(width) {
  const safeWidth = Math.max(20, Number(width) || 80);
  const rows = [];
  let row = { prefix: "ROUTES ", entries: [], cursor: "ROUTES ".length };
  for (const [route, label, key] of TUI_NAV_ITEMS) {
    const text = `${key} ${label}`;
    const separator = row.entries.length ? " · " : "";
    const needed = separator.length + text.length;
    if (row.entries.length && row.cursor + needed > safeWidth) {
      rows.push(row);
      row = { prefix: "       ", entries: [], cursor: "       ".length };
    }
    const leading = row.entries.length ? " · " : "";
    const start = row.cursor + leading.length;
    row.entries.push({ route, text, start, end: start + text.length });
    row.cursor = start + text.length;
  }
  if (row.entries.length || !rows.length) rows.push(row);
  return rows;
}

function renderRouteSwitcher(current, width, plain) {
  return routeSwitcherLayout(width).map((row) => {
    let line = row.prefix;
    for (const entry of row.entries) {
      const leading = line.length > row.prefix.length ? " · " : "";
      const token = entry.route === current
        ? focusRow(entry.text, entry.text.length, plain)
        : paint(entry.text, "muted", plain);
      line += leading + token;
    }
    return truncate(line, width);
  });
}

function routeAtSwitcherPosition(width, rowIndex, column) {
  const row = routeSwitcherLayout(width)[rowIndex];
  if (!row) return null;
  const entry = row.entries.find((item) => column >= item.start && column < item.end);
  return entry?.route || null;
}

// Consume complete SGR mouse packets while retaining an incomplete suffix.
// Keeping this pure makes PTY chunking testable without pretending that a
// source-level regex is proof of a working terminal interaction.
export function consumeSgrMousePackets(buffer) {
  const input = String(buffer || "");
  const pattern = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
  const packets = [];
  let match;
  let consumedThrough = 0;
  while ((match = pattern.exec(input))) {
    packets.push({ button: Number(match[1]), x: Number(match[2]) - 1, y: Number(match[3]) - 1, type: match[4] });
    consumedThrough = pattern.lastIndex;
  }
  const trailing = input.slice(consumedThrough);
  const partialStart = trailing.lastIndexOf("\x1b[<");
  return { packets, remainder: partialStart >= 0 ? trailing.slice(partialStart) : "" };
}

// Keep the visible sidebar and its mouse hit map on one model. The previous
// handler assumed that every route started immediately below the panel title;
// once WORKSPACE and OPERATIONS section rows were added, every click landed on
// the next route (Tasks opened Queues, etc.).
function sidebarBodyModel(height) {
  const compact = height <= 16;
  if (compact) {
    return TUI_NAV_ITEMS.map(([route, label, key]) => ({ type: "route", route, label, key }));
  }
  const body = [
    { type: "text", value: "agent-trust-ladder", color: "ink" },
    { type: "text", value: "main · control-plane", color: "muted" },
    { type: "blank" },
    { type: "text", value: "WORKSPACE", color: "faint" },
  ];
  for (const [route, label, key] of TUI_NAV_ITEMS.slice(0, 4)) body.push({ type: "route", route, label, key });
  body.push({ type: "blank" }, { type: "text", value: "OPERATIONS", color: "faint" });
  for (const [route, label, key] of TUI_NAV_ITEMS.slice(4)) body.push({ type: "route", route, label, key });
  body.push(
    { type: "blank" },
    { type: "text", value: "PROVIDER STATUS", color: "faint" },
    { type: "provider" },
    { type: "text", value: "Workspace Manager", color: "ink" },
    { type: "text", value: "Owner / approvals", color: "muted" },
  );
  return body;
}

export function sidebarRouteAtPanelRow(panelRow, height) {
  const row = sidebarBodyModel(height)[Number(panelRow)];
  return row?.type === "route" ? row.route : null;
}

function renderSidebar(current, width, height, plain) {
  const body = sidebarBodyModel(height).map((entry) => {
    if (entry.type === "blank") return "";
    if (entry.type === "provider") return `${paint("●", "amber", plain)} quota unknown`;
    if (entry.type === "route") {
      const selected = entry.route === current;
      const row = `${selected ? "▸" : " "} ${entry.key.padEnd(2)} ${entry.label}`;
      return selected ? focusRow(row, width - 4, plain) : row;
    }
    return paint(entry.value, entry.color, plain);
  });
  return panel("A  ATL / CONTROL", body, width, height, { accent: "mint", plain });
}

function statusCounts(tasks) {
  const counts = {};
  for (const task of tasks) counts[task.status] = (counts[task.status] || 0) + 1;
  return counts;
}

function resolveSourceCandidates(root, task) {
  const url = task?.source?.url;
  if (!url || /^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return [];
  const candidates = [];
  if (path.isAbsolute(url)) candidates.push(url);
  candidates.push(path.join(root, ".trust", "manager", "inbox", url));
  candidates.push(path.join(root, ".trust", "manager", "inbox-archive", url));
  candidates.push(path.join(root, url));
  if (task.workspace) candidates.push(path.join(task.workspace, url));
  return [...new Set(candidates)];
}

export function resolveTaskSource(root, task) {
  for (const candidate of resolveSourceCandidates(root, task)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // The dashboard reports a not-found state instead of failing the view.
    }
  }
  return null;
}

export function createDashboardSnapshot(root) {
  const state = loadState(root);
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(paths(root).config, "utf8"));
  } catch {
    // State remains useful even if optional config is absent.
  }
  const tasks = Object.values(state.tasks).sort(taskSort);
  const counts = statusCounts(tasks);
  const active = activeTasks(state);
  const feed = readFeed(root, { n: 80 });
  const actions = wakeActions(state, { budgets: config.budgets || {} });
  let queue = [];
  try {
    queue = loadQueue(root).items;
  } catch {
    // A broken queue file must never take the dashboard down.
  }
  const providerProfileValue = providerProfile(config);
  const providers = {};
  for (const name of providerNames(config)) {
    providers[name] = discoverProvider(name, { command: providerSpec(providerProfileValue, name).command }).available;
  }
  let controlPlane = null;
  try { controlPlane = createControlPlaneSnapshot(root); } catch { /* optional additive records */ }
  return {
    root,
    state,
    tasks,
    counts,
    active,
    feed,
    actions,
    queue,
    providers,
    providerProfile: providerProfileValue,
    userProviders: providerProfileValue.userProviders || {},
    updatedAt: state.updated_at,
    lastEvent: state.log.at(-1) || null,
    controlPlane,
  };
}

function renderHeader(snapshot, width, { plain, loading, spinner, interactive, syncedAt, routeLabel = "Overview" }) {
  const age = Math.max(0, Math.round((Date.now() - (syncedAt || Date.now())) / 1000));
  const live = loading
    ? `${SPINNER[spinner % SPINNER.length]} SYNCING`
    : interactive
      ? `● LIVE · synced ${age}s ago`
      : `SNAPSHOT · state of ${timeOf(snapshot.updatedAt)}`;
  const left = `${paint("A", "mint", plain)} ${paint("ATL CONTROL ROOM", "ink", plain)}  ${paint(routeLabel, "ink", plain)}${interactive ? `  ${paint("INTERACTIVE DEMO", "faint", plain)}` : ""}`;
  const right = `${interactive ? `${paint("◈", "amber", plain)} 3  ${paint("+ New task", "mint", plain)}   ` : ""}${paint(live, loading ? "amber" : "mint", plain)}`;
  const gap = Math.max(1, width - widthOf(left) - widthOf(right));
  return truncate(`${left}${" ".repeat(gap)}${right}`, width);
}

function renderSummary(snapshot, plain, width = null) {
  const total = snapshot.tasks.length;
  const active = snapshot.active.length;
  const done = snapshot.counts.done || 0;
  const blocked = snapshot.counts.blocked || 0;
  const escalated = snapshot.counts.escalated || 0;
  const queued = (snapshot.queue || []).length;
  const unread = snapshot.controlPlane?.notifications?.unread || 0;
  const latestUsage = snapshot.controlPlane?.usage?.latest;
  const usageLabel = latestUsage ? `${latestUsage.provider || "provider"} ${latestUsage.status || "unknown"}` : "provider quota unknown";
  const lines = [
    `${paint("PORTFOLIO", "faint", plain)}  ${paint(total, "ink", plain)} tasks  ·  ${paint(done, "mint", plain)} shipped  ·  ${paint(active, "violet", plain)} active  ·  ${paint(blocked, "amber", plain)} blocked  ·  ${paint(escalated, "coral", plain)} escalated  ·  ${paint("⌁", "mint", plain)} ${paint(queued, "mint", plain)} queued`,
    `${paint("last decision", "faint", plain)} ${snapshot.lastEvent ? `${timeOf(snapshot.lastEvent.at)} · ${snapshot.lastEvent.event}` : "no events yet"}  ·  ${paint("N", "coral", plain)} ${unread} notifications  ·  ${paint("usage", "faint", plain)} ${usageLabel}`,
  ];
  return width ? lines.map((line) => truncate(line, width)) : lines;
}

function renderPipeline(snapshot, width, plain) {
  const compact = width < 105;
  const nodes = STATUS_ORDER.map((status) => {
    const count = snapshot.counts[status] || 0;
    const label = compact ? (COMPACT_STATUS_LABELS[status] || statusLabel(status).slice(0, 7)) : statusLabel(status);
    return `${paint(STATUS_ICON[status], STATUS_COLOR[status], plain)} ${paint(label, "muted", plain)} ${paint(count, STATUS_COLOR[status], plain)}`;
  });
  const separator = paint(compact ? " › " : "  ──›  ", "faint", plain);
  const attention = `  ${paint("↘", "amber", plain)} ${paint(`${snapshot.counts.blocked || 0} blocked`, "amber", plain)}   ${paint("↗", "coral", plain)} ${paint(`${snapshot.counts.escalated || 0} escalated`, "coral", plain)}   ${paint("◆", "mint", plain)} ${paint(`${snapshot.counts.done || 0} shipped`, "mint", plain)}`;
  if (compact) {
    return [
      `${paint("LIFECYCLE", "faint", plain)}  ${paint("authoritative state path", "muted", plain)}`,
      `  ${nodes.slice(0, 4).join(separator)}`,
      `    ${nodes.slice(4).join(separator)}`,
      attention,
    ];
  }
  const line = `  ${nodes.join(separator)}`;
  return [
    `${paint("LIFECYCLE", "faint", plain)}  ${paint("authoritative state path", "muted", plain)}`,
    truncate(line, width),
    attention,
  ];
}

function renderActionBar(snapshot, selected, width, plain) {
  const selectedQueued = snapshot.tasks.length
    ? (snapshot.queue || []).some((item) => item.id === snapshot.tasks[selected]?.id)
    : false;
  const task = snapshot.tasks[selected];
  const recovery = task?.status === "blocked" ? `   ${paint("u", "amber", plain)} unblock` : "";
  const compact = `${paint("ACTIONS", "faint", plain)}  ${paint("c", "coral", plain)} new · ${paint("e", "coral", plain)} edit · ${paint("x", "coral", plain)} queue · ${paint("l", "coral", plain)} run${recovery ? ` · ${paint("u", "amber", plain)} fix` : ""} · ${paint("r", "coral", plain)} refresh · ${paint("w", "coral", plain)} why · ${paint(":", "coral", plain)} commands`;
  const full = `${paint("ACTIONS", "faint", plain)}  ${paint("c", "coral", plain)} create task   ${paint("e", "coral", plain)} edit selected   ${paint("x", "coral", plain)} ${selectedQueued ? "remove from" : "add to"} queue   ${paint("l", "coral", plain)} run queue${recovery}   ${paint("r", "coral", plain)} refresh   ${paint("w", "coral", plain)} why   ${paint(":", "coral", plain)} commands   ${paint("a", "coral", plain)} resources`;
  return truncate(width < 105 ? compact : full, width);
}

function renderOverviewPrelude(snapshot, width, plain, wide) {
  if (!wide) return [];
  const blocked = snapshot.counts.blocked || 0;
  return [
    paint("WORKSPACE / CONTROL ROOM", "mint", plain),
    `${paint("Overview", "ink", plain)}  ${paint("Tasks, execution health, decisions and live agent activity.", "muted", plain)}`,
    `${paint("● Manager online · live", "mint", plain)}   ${paint(`${blocked} blocked`, "amber", plain)}   ${paint("SDD / TDD", "violet", plain)}`,
  ].map((line) => truncate(line, width));
}

function renderOverviewStatCards(snapshot, width, plain, wide) {
  if (!wide) return [];
  const total = snapshot.tasks.length;
  const active = snapshot.active.length;
  const blocked = snapshot.counts.blocked || 0;
  const done = snapshot.counts.done || 0;
  const cardWidth = Math.max(20, Math.floor((width - 3) / 4));
  const cards = [
    ["Portfolio", total, "Tracked tasks", "violet"],
    ["Active / available", `${active} / 5`, "Agent snapshot", "mint"],
    ["Blocked", blocked, "Need intervention", "amber"],
    ["Shipped", done, "Verified sample", "mint"],
  ].map(([label, value, detail, accent]) => panel(label, [paint(String(value), accent, plain), paint(detail, "faint", plain)], cardWidth, 4, { accent, plain }));
  return joinPanels(cards);
}

function renderPortfolio(snapshot, selected, width, plain, scroll = 0, maxRows = null) {
  if (!snapshot.tasks.length) return [paint("No tasks yet.", "muted", plain), "", "Run `atl intake`, press c to compose, or i to import."];
  const queuedIds = new Set((snapshot.queue || []).map((q) => q.id));
  const lines = [];
  const rowWidth = Math.max(16, width - 4);
  snapshot.tasks.forEach((task, index) => {
    const isSelected = index === selected;
    const selectedMark = isSelected ? paint("▸", "coral", plain) : " ";
    const priorityChar = task.priority === "urgent" ? "!" : task.priority === "high" ? "+" : "·";
    const priority = task.priority === "urgent" ? paint(priorityChar, "coral", plain) : task.priority === "high" ? paint(priorityChar, "amber", plain) : priorityChar;
    const queuedMark = queuedIds.has(task.id) ? "⌁" : " ";
    const titleWidth = Math.max(10, rowWidth - 20);
    const title = truncate(task.title, titleWidth);
    const row = `${selectedMark} ${priority} ${paint(task.id, "ink", plain)} ${queuedIds.has(task.id) ? paint("⌁", "mint", plain) : " "} ${title}`;
    // Keep the task row physically single-line. `panel()` wraps oversized
    // body entries, but mouse hit-testing intentionally maps one task to a
    // fixed two-row pair; an unexpected wrap shifts every task below it.
    lines.push(isSelected ? focusRow(`${isSelected ? "▸" : " "} ${priorityChar} ${task.id} ${queuedMark} ${title}`, rowWidth, plain) : truncate(row, rowWidth));
    const worker = task.assigned_worker ? `${AVATARS[task.assigned_worker] || "·"} ${task.assigned_worker}` : "unassigned";
    const extra = task.status === "blocked" && task.blocker?.reason
      ? truncate(task.blocker.reason, Math.max(10, rowWidth - 14))
      : `${worker} · ${ageOf(task.updated_at)}`;
    const statusRow = `    ${statusLine(task.status, plain, true)}  ${paint(extra, task.status === "blocked" ? "amber" : "faint", plain)}`;
    lines.push(truncate(statusRow, rowWidth));
  });
  // Windowed list: the wheel scrolls this pane without moving the selection,
  // so keep only the visible pair-window on screen.
  if (!maxRows || lines.length <= maxRows) return lines;
  const visible = portfolioWindowSize(maxRows);
  const maxScroll = Math.max(0, snapshot.tasks.length - visible);
  const start = Math.min(Math.max(0, Number(scroll) || 0), maxScroll);
  return lines.slice(start * 2, (start + visible) * 2);
}

function renderTaskDetail(snapshot, selected, width, plain, scroll = 0, maxRows = null) {
  const task = snapshot.tasks[selected];
  if (!task) return [paint("Select a task to inspect its contract.", "muted", plain)];
  const inner = Math.max(14, width - 4);
  const lines = [
    `${paint(task.id, "ink", plain)}  ${statusLine(task.status, plain)}`,
    ...wrap(task.title, inner),
    "",
    `${paint("worker", "faint", plain)}  ${task.assigned_worker || "unassigned"}    ${paint("priority", "faint", plain)}  ${task.priority || "normal"}`,
    `${paint("risk", "faint", plain)}    ${task.risk || "normal"}    ${paint("attempts", "faint", plain)}  ${task.attempt_count || 0}`,
    `${paint("queue", "faint", plain)}   ${(snapshot.queue || []).some((q) => q.id === task.id) ? paint("⌁ queued for execution (x to remove)", "mint", plain) : paint("not queued (x to add)", "muted", plain)}`,
  ];
  if (task.blocker?.reason) {
    const recovery = task.assigned_worker || task.proposed_worker;
    lines.push("", paint("RECOVERY · NEXT ACTION", "amber", plain), ...wrap(`${paint("blocked", "amber", plain)} · ${task.blocker.reason}`, inner));
    lines.push(...wrap(recovery
      ? `${paint("u", "amber", plain)} unblock → ${recovery}; then ${paint("x", "mint", plain)} queue → ${paint("l", "mint", plain)} run`
      : `${paint("u", "amber", plain)} unblock → triage; then assign a worker before queueing`, inner));
  }
  if (task.resources?.length) {
    lines.push("", paint(`RESOURCES · ${task.resources.length}`, "mint", plain));
    for (const resource of task.resources.slice(0, 3)) {
      lines.push(...wrap(`${paint(`[${resource.kind}]`, "faint", plain)} ${resource.label}: ${resource.ref}`, inner));
    }
    if (task.resources.length > 3) lines.push(paint(`+ ${task.resources.length - 3} more — press e to review`, "faint", plain));
  }
  if (task.objective) {
    lines.push("", paint("OBJECTIVE", "violet", plain), ...wrap(task.objective, inner));
  }
  const sourcePath = resolveTaskSource(snapshot.root, task);
  lines.push("", paint("SOURCE", "faint", plain), ...wrap(task.source?.url || task.source?.type || "manual", inner));
  lines.push(sourcePath ? paint("Enter to open source file", "mint", plain) : paint("Source file not found locally", "amber", plain));
  const stageIndex = Math.max(0, STATUS_ORDER.indexOf(task.status));
  const stages = STATUS_ORDER.map((status, index) => index < stageIndex ? "●" : index === stageIndex ? "◉" : "○").join("─");
  lines.push("", `${paint("GATE", "faint", plain)}  ${paint(stages, task.status === "blocked" ? "amber" : "violet", plain)}`);
  if (task.blocker?.reason) {
    if (task.next_wake_at) lines.push(`${paint("wake", "faint", plain)} ${timeOf(task.next_wake_at)}`);
  }
  if (task.completion_checks?.length) {
    lines.push("", paint(`CHECKS · ${task.completion_checks.length}`, "faint", plain));
    for (const check of task.completion_checks.slice(0, 8)) {
      const evidence = task.evidence?.filter((entry) => entry.kind === "check" && entry.check === check) || [];
      const pass = evidence.some((entry) => entry.result === "pass");
      const fail = evidence.some((entry) => entry.result === "fail");
      const icon = pass ? paint("✓", "mint", plain) : fail ? paint("×", "coral", plain) : paint("·", "amber", plain);
      lines.push(` ${icon} ${truncate(check, Math.max(10, inner - 4))}`);
    }
  }
  const notes = (task.evidence || []).filter((entry) => entry.kind === "note").slice(-2);
  if (notes.length) {
    lines.push("", paint("LATEST NOTES", "faint", plain));
    for (const note of notes) lines.push(...wrap(`${note.actor}: ${note.detail}`, inner));
  }
  // Windowed view for the center panel: the full detail is longer than the
  // panel, so a scroll offset turns it into a page plus a position hint.
  if (!maxRows || lines.length <= maxRows) return lines;
  const maxOffset = Math.max(0, lines.length - (maxRows - 1));
  const offset = Math.min(Math.max(0, Number(scroll) || 0), maxOffset);
  const page = lines.slice(offset, offset + maxRows - 1);
  const hint = [offset > 0 ? "↑ back" : "", offset < maxOffset ? "↓ more" : ""].filter(Boolean).join(" · ") || "full";
  return [...page, paint(`DETAIL ${offset + 1}-${offset + page.length} / ${lines.length} · ${hint}`, "faint", plain)];
}

function renderFeedPanel(snapshot, width, plain, scroll = 0, maxLines = 8) {
  const inner = Math.max(12, width - 4);
  const all = [];
  for (const message of snapshot.feed) {
    const who = NAMES[message.from] || message.from || "team";
    const avatar = AVATARS[message.from] || "·";
    all.push(`${paint(timeOf(message.at), "faint", plain)} ${paint(`${avatar} ${who}`, "ink", plain)}`);
    all.push(...wrap(message.text || "", inner));
    if (message.kind === "card" && message.status) all.push(`  ${statusLine(String(message.status).toLowerCase().replace(/ /g, "_"), plain, true)}`);
    all.push("");
  }
  if (!all.length) return [paint("The team feed is quiet.", "muted", plain)];
  const contentLines = Math.max(2, maxLines - 1);
  const maxOffset = Math.max(0, all.length - contentLines);
  const offset = Math.min(Math.max(0, Number(scroll) || 0), maxOffset);
  const start = Math.max(0, maxOffset - offset);
  const page = all.slice(start, start + contentLines);
  const hint = [
    offset < maxOffset ? "↑ older" : "",
    offset > 0 ? "↓ newer" : "",
  ].filter(Boolean).join(" · ") || "latest";
  return [...page, paint(`FEED VIEW · ${hint}`, "faint", plain)];
}

const TASK_FILTERS = ["All", "New", "Queued", "Running", "Blocked", "Review", "Done", "Archived"];

function taskPageItems(snapshot, ui) {
  const filter = ui.tasksFilter || "All";
  const query = String(ui.tasksQuery || "").trim().toLowerCase();
  return snapshot.tasks.filter((task) => {
    if (filter !== "All" && statusLabel(task.status) !== filter) return false;
    if (!query) return true;
    return [task.id, task.title, task.objective, task.assigned_worker, task.priority, task.status]
      .filter(Boolean).join(" ").toLowerCase().includes(query);
  });
}

export function renderTasksScreen(snapshot, ui, width, height, plain) {
  const tasks = taskPageItems(snapshot, ui);
  const selected = Math.min(Math.max(0, Number(ui.tasksSelected) || 0), Math.max(0, tasks.length - 1));
  const filtered = { ...snapshot, tasks, counts: statusCounts(tasks) };
  const contentWidth = Math.max(20, width - 2);
  const leftWidth = Math.max(30, Math.floor(contentWidth * 0.58));
  const rightWidth = Math.max(24, contentWidth - leftWidth - 1);
  const cards = [
    ["All", snapshot.tasks.length, "Tracked", "violet"],
    ["Blocked", snapshot.tasks.filter((task) => task.status === "blocked").length, "Need action", "amber"],
    ["Queued", (snapshot.queue || []).length, "Ready path", "mint"],
    ["Archived", snapshot.tasks.filter((task) => task.status === "archived").length, "Recoverable", "muted"],
  ].map(([label, value, detail, accent]) => panel(label, [paint(String(value), accent, plain), paint(detail, "faint", plain)], Math.max(24, Math.floor((contentWidth - 1) / 2)), 4, { accent, plain }));
  const cardRows = width < 105
    ? [`${paint("PORTFOLIO", "faint", plain)} ${snapshot.tasks.length}  ·  ${paint("BLOCKED", "amber", plain)} ${snapshot.tasks.filter((task) => task.status === "blocked").length}  ·  ${paint("QUEUED", "mint", plain)} ${(snapshot.queue || []).length}  ·  ${paint("ARCHIVED", "muted", plain)} ${snapshot.tasks.filter((task) => task.status === "archived").length}`]
    : [joinPanels(cards.slice(0, 2)), joinPanels(cards.slice(2))].flat();
  const tableLines = [
    `${paint("FILTER", "faint", plain)} ${paint(ui.tasksFilter || "All", "mint", plain)}  ${paint("QUERY", "faint", plain)} ${paint(ui.tasksQuery || "all tasks", "muted", plain)}`,
    "",
    ...renderPortfolio(filtered, selected, leftWidth, plain, 0, Math.max(4, height - 10)),
    "",
    paint("↑↓ select · f filter · / search · c create · e edit · d archive/restore", "faint", plain),
  ];
  const detailLines = tasks[selected]
    ? renderTaskDetail(filtered, selected, rightWidth, plain, 0, Math.max(4, height - 4))
    : [paint("No matching tasks.", "muted", plain), "", paint("Press c to create a task.", "mint", plain)];
  const body = [
    paint("WORKSPACE / TASKS", "mint", plain),
    `${paint("Task management", "ink", plain)}  ${paint("Create, edit, filter, archive and restore real ATL tasks.", "muted", plain)}`,
    "",
    ...cardRows,
    "",
    ...joinPanels([
      panel("TASK LIST", tableLines, leftWidth, Math.max(8, height - 8), { accent: "coral", plain }),
      panel("SELECTED TASK", detailLines, rightWidth, Math.max(8, height - 8), { accent: "violet", plain }),
    ]),
  ];
  return panel("TASKS", body, width, height, { accent: "mint", plain }).join("\n");
}

export function renderQueuesScreen(snapshot, ui, width, height, plain) {
  const queueBook = snapshot.controlPlane?.queues || {};
  const queues = queueBook.items || [];
  const selected = Math.min(Math.max(0, Number(ui.queuePageSelected) || 0), Math.max(0, queues.length - 1));
  const body = [
    paint("WORKSPACE / QUEUES", "mint", plain),
    `${paint("Multi-queue manager", "ink", plain)}  ${paint("Independent workstreams with explicit gates and one safe global runner.", "muted", plain)}`,
    "",
    `${paint("ACTIVE", "faint", plain)} ${paint(queueBook.active_queue || "default", "mint", plain)}   ${paint("CONCURRENCY", "faint", plain)} ${paint("1 global session", "violet", plain)}   ${paint("RUNNABLE", "faint", plain)} ${paint(String(snapshot.queue?.length || 0), "ink", plain)}`,
    "",
  ];
  if (!queues.length) body.push(paint("No named queues yet. Press n to create one.", "muted", plain));
  for (const [index, queue] of queues.entries()) {
    const active = index === selected;
    const status = queue.status === "paused" ? paint("PAUSED", "amber", plain) : queue.status === "archived" ? paint("ARCHIVED", "muted", plain) : paint(queue.id === queueBook.active_queue ? "ACTIVE" : "READY", queue.id === queueBook.active_queue ? "mint" : "violet", plain);
    const marker = active ? paint("▸", "coral", plain) : " ";
    body.push(`${marker} ${paint(queue.name || queue.id, "ink", plain)}  ${status}  ${paint(`${queue.items?.length || 0} task(s)`, "muted", plain)}  ${paint(`${queue.policy?.maxMinutes || 120}m / ${queue.policy?.maxSessions || 5} sessions`, "faint", plain)}`);
  }
  const current = queues[selected];
  body.push("", paint("TASKS IN SELECTED QUEUE", "violet", plain));
  if (current?.items?.length) {
    const live = new Map(snapshot.tasks.map((task) => [task.id, task]));
    for (const item of current.items.slice(0, Math.max(1, height - body.length - 5))) {
      const task = live.get(item.id);
      body.push(`  ${paint(item.id, "ink", plain)}  ${statusLine(task?.status || "new", plain, true)}  ${truncate(task?.title || "unknown task", Math.max(12, width - 30))}`);
    }
  } else body.push(paint("  Queue is empty.", "muted", plain));
  body.push("", paint("↑↓ select · n new queue · r rename · p pause/resume · u use · a archive · l run preview · : commands", "faint", plain));
  return panel("QUEUES", body, width, height, { accent: "mint", plain }).join("\n");
}

function renderActions(snapshot, plain) {
  if (!snapshot.actions.length) return [paint("Queue is quiet.", "mint", plain), "", "No next move is waiting."];
  const lines = [paint("NEXT MOVES", "faint", plain)];
  for (const action of snapshot.actions.slice(0, 4)) {
    lines.push(`${paint(action.task, "coral", plain)}  ${paint(action.for, "violet", plain)}`);
    lines.push(...wrap(action.what, 46));
  }
  return lines;
}

function renderTeam(snapshot, plain) {
  const byWorker = {};
  for (const task of snapshot.active) {
    if (task.assigned_worker) byWorker[task.assigned_worker] = (byWorker[task.assigned_worker] || 0) + 1;
  }
  return [
    `${paint("Mira", "ink", plain)}  ${paint(`${byWorker.mira || 0} routing`, "muted", plain)}`,
    `${paint("Pip", "ink", plain)}   ${paint(`${byWorker.pip || 0} triage`, "muted", plain)}`,
    `${paint("Rowan", "ink", plain)} ${paint(`${byWorker.rowan || 0} build`, "muted", plain)}`,
    `${paint("Sage", "ink", plain)}  ${paint(`${byWorker.sage || 0} review`, "muted", plain)}`,
    `${paint("Beacon", "ink", plain)} ${paint(`${byWorker.beacon || 0} verify`, "muted", plain)}`,
  ];
}

// Column geometry of the three-pane wide layout (joinPanels places panels
// with a 1-space gap). Shared by the renderer and the mouse-wheel handler so
// hover routing never drifts from what is on screen.
function dashboardPanelLayout(safeWidth) {
  const geometry = layoutFor(safeWidth, 34);
  const contentWidth = geometry.mode === "wide" ? safeWidth - TUI_SIDEBAR_WIDTH - 1 : safeWidth;
  // The control-plane prototype is a two-column work surface: task portfolio
  // and lifecycle on the left, attention/activity on the right. Keep one
  // shared geometry object so mouse hover, wheel routing, and rendering agree.
  const leftWidth = geometry.mode === "wide" ? Math.max(36, Math.floor(contentWidth * 0.62)) : Math.floor(contentWidth * 0.58);
  const rightWidth = geometry.mode === "wide" ? Math.max(24, contentWidth - leftWidth - 1) : Math.max(20, contentWidth - leftWidth - 1);
  const centerWidth = rightWidth;
  return { leftWidth, centerWidth, rightWidth, contentWidth };
}

export function panelFromColumn(safeWidth, column) {
  const layout = dashboardPanelLayout(safeWidth);
  const offset = layout.contentWidth < safeWidth ? TUI_SIDEBAR_WIDTH + 1 : 0;
  if (offset && column < offset) return "nav";
  const relative = column - offset;
  const { leftWidth, centerWidth } = layout;
  if (relative < leftWidth) return "portfolio";
  if (relative < leftWidth + 1 + centerWidth) return "task";
  return "feed";
}

// Rows the renderer spends above the panels (header, divider, summary,
// pipeline, action bar, blank). Shared so input handlers can clamp scroll
// offsets with the same panel height the next paint will use.
function dashboardPanelOrigin(snapshot, safeWidth) {
  const layout = layoutFor(safeWidth, 34);
  const routeRows = layout.mode === "wide" ? 0 : routeSwitcherLayout(safeWidth).length;
  const preludeRows = layout.mode === "wide" ? renderOverviewPrelude(snapshot, safeWidth, true, true).length : 0;
  const statRows = layout.mode === "wide" ? 4 : 0;
  return 4 + preludeRows + statRows + renderSummary(snapshot, false, safeWidth).length + renderPipeline(snapshot, safeWidth, false).length + routeRows;
}

function dashboardRemainingRows(snapshot, safeWidth, safeHeight) {
  return Math.max(8, safeHeight - dashboardPanelOrigin(snapshot, safeWidth) - 2);
}

// The dashboard has two different vertical geometries. Wide mode keeps the
// portfolio, detail and feed panes side by side; compact mode stacks the
// portfolio above the selected-task pane. Keep mouse selection derived from
// those same bounds instead of guessing from whatever text happens to contain
// a task id. The previous fallback silently did nothing in compact mode and
// could select a task when the pointer was over lifecycle/detail content.
export function dashboardTaskIndexAtPoint(snapshot, { x = 0, y = 0, width = 120, height = 34, portfolioScroll = 0 } = {}) {
  const safeWidth = Math.max(60, Number(width) || 120);
  const safeHeight = Math.max(14, Number(height) || 34);
  const origin = dashboardPanelOrigin(snapshot, safeWidth);
  const panelHeight = Math.max(7, dashboardRemainingRows(snapshot, safeWidth, safeHeight));
  const layout = layoutFor(safeWidth, safeHeight);
  let relativeX = Number(x) || 0;
  let listRows;
  let row;
  if (layout.mode === "wide") {
    const { leftWidth } = dashboardPanelLayout(safeWidth);
    const offset = TUI_SIDEBAR_WIDTH + 1;
    if (relativeX < offset || relativeX >= offset + leftWidth) return -1;
    relativeX -= offset;
    listRows = Math.max(4, Math.floor(panelHeight * 0.62));
    const panelRow = (Number(y) || 0) - origin - 1;
    if (panelRow < 0 || panelRow >= listRows) return -1;
    row = Math.floor(panelRow / 2) + Math.max(0, Number(portfolioScroll) || 0);
  } else {
    if (relativeX < 0 || relativeX >= safeWidth) return -1;
    listRows = Math.max(1, panelHeight - 2);
    const panelRow = (Number(y) || 0) - origin - 1;
    if (panelRow < 0 || panelRow >= listRows) return -1;
    row = Math.floor(panelRow / 2) + Math.max(0, Number(portfolioScroll) || 0);
  }
  return row >= 0 && row < (snapshot.tasks || []).length ? row : -1;
}

// Portfolio list rows come in pairs (task row + status row); the window is
// how many whole task pairs fit the panel's content rows (borders excluded).
function portfolioWindowSize(contentRows) {
  return Math.max(1, Math.floor(contentRows / 2));
}

export { dashboardPanelLayout, dashboardPanelOrigin, dashboardRemainingRows, portfolioWindowSize, renderPortfolio, renderTaskDetail };

function dashboardProjection(snapshot) {
  if (snapshot?.tasks) return snapshot;
  const plane = snapshot || {};
  const state = plane.state || {};
  const tasks = Object.values(state.tasks || {}).sort(taskSort);
  const taskState = { tasks: state.tasks || {} };
  const active = activeTasks(taskState);
  const queueBook = plane.queues || {};
  const activeQueue = (queueBook.items || []).find((queue) => queue.id === queueBook.active_queue);
  const queue = activeQueue?.items || [];
  const counts = statusCounts(tasks);
  return {
    ...plane,
    root: plane.root || null,
    state: state,
    tasks,
    active,
    counts,
    feed: plane.feed || [],
    actions: plane.actions || [],
    queue,
    providers: plane.providers || {},
    providerProfile: plane.providerProfile || {},
    userProviders: plane.userProviders || {},
    updatedAt: plane.updatedAt || state.updated_at || null,
    lastEvent: plane.lastEvent || (state.log_tail || []).at(-1) || null,
  };
}

export function renderDashboard(snapshot, {
  width = 120,
  height = 34,
  plain = false,
  loading = false,
  spinner = 0,
  selected = 0,
  feedScroll = 0,
  panelFocus = "portfolio",
  navSelected = 0,
  taskScroll = 0,
  portfolioScroll = 0,
  interactive = true,
  syncedAt = null,
} = {}) {
  snapshot = dashboardProjection(snapshot);
  const requestedWidth = Number(width) || 120;
  const safeWidth = Math.max(60, requestedWidth);
  const safeHeight = Math.max(14, Number(height) || 34);
  const tooNarrow = requestedWidth < 60;
  const shell = layoutFor(safeWidth, safeHeight);
  const lines = [
    renderHeader(snapshot, safeWidth, { plain, loading, spinner, interactive, syncedAt, routeLabel: "Overview" }),
    ...(tooNarrow
      ? [paint(truncate(`RESIZE · ${requestedWidth} columns is below the 60-column minimum — widen the terminal for the full control room`, safeWidth), "amber", plain)]
      : []),
    paint("─".repeat(safeWidth), "line", plain),
    ...renderOverviewPrelude(snapshot, safeWidth, plain, shell.mode === "wide"),
    ...renderOverviewStatCards(snapshot, safeWidth, plain, shell.mode === "wide"),
    ...renderSummary(snapshot, plain, safeWidth),
    ...renderPipeline(snapshot, safeWidth, plain),
    interactive ? renderActionBar(snapshot, selected, safeWidth, plain) : "",
    ...(shell.mode === "wide" ? [] : renderRouteSwitcher(TUI_NAV_ITEMS[navSelected]?.[0] || "dashboard", safeWidth, plain)),
    "",
  ];
  const remaining = dashboardRemainingRows(snapshot, safeWidth, safeHeight);
  if (shell.mode === "wide") {
    const { leftWidth, centerWidth } = dashboardPanelLayout(safeWidth);
    const panelHeight = Math.max(7, remaining);
    const mark = (name) => interactive && panelFocus === name ? "▸ " : "";
    const task = snapshot.tasks[selected];
    const attention = [
      paint("SELECTED TASK", "faint", plain),
      paint("FEED VIEW · latest", "faint", plain),
      ...renderTaskDetail(snapshot, selected, centerWidth, plain, taskScroll, Math.min(7, panelHeight - 2)),
      ...(task?.blocker?.reason ? [paint(`RECOVERY · ${truncate(task.blocker.reason, Math.max(12, centerWidth - 12))}`, "amber", plain), paint("u unblock · x queue · l run", "amber", plain)] : []),
      "",
      paint("ATTENTION REQUIRED", "amber", plain),
      ...renderActions(snapshot, plain),
      "",
      paint("LIVE ACTIVITY", "mint", plain),
      ...renderFeedPanel(snapshot, centerWidth, plain, feedScroll, Math.max(4, panelHeight - 12)),
    ];
    const panels = [
      renderSidebar(TUI_NAV_ITEMS[navSelected]?.[0] || "dashboard", TUI_SIDEBAR_WIDTH, panelHeight, plain),
      panel(`${mark("portfolio")}TASK PORTFOLIO · FOCUS ${snapshot.tasks.length ? Math.min(selected + 1, snapshot.tasks.length) : 0}/${snapshot.tasks.length}`, [
        ...renderPortfolio(snapshot, selected, leftWidth, plain, portfolioScroll, Math.max(4, Math.floor(panelHeight * 0.62))),
        "",
        paint("SDD / TDD LIFECYCLE", "violet", plain),
        ...renderPipeline(snapshot, leftWidth - 4, plain),
        "",
        renderActionBar(snapshot, selected, leftWidth - 4, plain),
      ], leftWidth, panelHeight, { accent: "coral", plain }),
      panel(`${mark("task")}ATTENTION & ACTIVITY`, attention, centerWidth, panelHeight, { accent: "violet", plain }),
    ];
    const sidebar = panels.shift();
    lines.push(...joinPanels([sidebar, ...panels]));
  } else {
    const panelHeight = Math.max(6, Math.floor(remaining / 2));
    lines.push(...panel(interactive ? `PORTFOLIO · FOCUS ${snapshot.tasks.length ? Math.min(selected + 1, snapshot.tasks.length) : 0}/${snapshot.tasks.length}` : "PORTFOLIO", renderPortfolio(snapshot, selected, safeWidth, plain, portfolioScroll, panelHeight - 2), safeWidth, panelHeight, { accent: "coral", plain }));
    lines.push(...panel("SELECTED TASK", renderTaskDetail(snapshot, selected, safeWidth, plain, taskScroll, panelHeight - 2), safeWidth, panelHeight, { accent: "violet", plain }));
  }
  const footerChoices = interactive
    ? [
        "atl › : commands · Ctrl-K palette · c new task · Enter open · x queue · l run · q quit",
        "atl › : commands · ↑↓ scroll · c new task · x queue · ? help · q quit",
        "atl › : commands · ↑↓ scroll · ? help · q quit",
      ]
    : ["SNAPSHOT · read-only · run `atl ui` for keyboard navigation"];
  const footer = footerChoices.find((choice) => widthOf(choice) <= safeWidth - 2) || footerChoices[footerChoices.length - 1];
  const footerLine = `${paint("●", "mint", plain)} ${paint(footer, "muted", plain)}`;
  const output = [...lines, "", truncate(footerLine, safeWidth)];
  return output.slice(0, safeHeight).join("\n");
}

export function renderFileView(view, width, height, plain) {
  const title = view.filePath ? path.basename(view.filePath) : "source file";
  const header = `${paint("SOURCE FILE", "faint", plain)}  ${paint(title, "ink", plain)}`;
  const info = view.filePath ? path.relative(view.root, view.filePath) : "No local source file resolved for this task.";
  const lines = [header, paint(info, "muted", plain), ""];
  const available = Math.max(4, height - 7);
  if (view.error) {
    lines.push(...wrap(view.error, Math.max(20, width - 4)));
  } else {
    const source = view.lines || [];
    const slice = source.slice(view.scroll, view.scroll + available);
    lines.push(...slice.map((line, index) => `${paint(String(view.scroll + index + 1).padStart(4), "faint", plain)} ${line}`));
    if (!slice.length) lines.push(paint("End of file", "muted", plain));
    lines.push("", paint(`${view.scroll + 1}-${Math.min(source.length, view.scroll + available)} / ${source.length} lines`, "faint", plain));
  }
  lines.push("", paint("Esc back   ↑↓ / j k scroll   PgUp/PgDn jump   Home/End top/tail", "muted", plain));
  return panel(`TASK ${view.taskId || "-"}`, lines, width, height, { accent: "mint", plain }).join("\n");
}

export function renderFeedView(snapshot, width, height, scroll, plain) {
  const all = [];
  for (const message of snapshot.feed) {
    all.push(`${timeOf(message.at)}  ${NAMES[message.from] || message.from} ${AVATARS[message.from] || "·"}`);
    all.push(...wrap(message.text || "", Math.max(20, width - 8)));
    if (message.detail) all.push(`  ↳ ${message.detail}`);
    all.push("");
  }
  const visible = Math.max(4, height - 6);
  const maxOffset = Math.max(0, all.length - visible);
  const offset = Math.min(Math.max(0, Number(scroll) || 0), maxOffset);
  const start = Math.max(0, maxOffset - offset);
  const hint = [offset < maxOffset ? "↑ older" : "", offset > 0 ? "↓ newer" : ""].filter(Boolean).join(" · ") || "latest";
  const body = [paint("FULL TEAM FEED", "faint", plain), ...all.slice(start, start + visible), "", paint(`Esc back   ↑↓ / j k scroll   PgUp/PgDn jump   · ${hint}`, "muted", plain)];
  return panel("FEED", body, width, height, { accent: "mint", plain }).join("\n");
}

export function renderHelp(width, height, plain) {
  const hk = (label, color = "coral") => paint(label.padEnd(9), color, plain);
  const body = [
    paint("A calm view of the room — select any text with the mouse and copy it.", "ink", plain),
    "",
    `${hk("mouse")}  click cards and controls; wheel pans the pane under the pointer`,
    `${hk("Shift+M")}  toggle capture: Shift+drag selects and copies text in terminal mode`,
    `${hk("↑↓ / j k")}  act on the focused pane (move tasks, scroll task detail or feed)`,
    `${hk("Tab")}  choose the focused pane: portfolio → task detail → live feed`,
    `${hk("PgUp/PgDn")}  bigger jumps · Home/End: top/last (pane-aware)`,
    `${hk("Enter / o")}  read the task source file`,
    `${hk("c")}  create: choose outcome + surface, write freely, preview packet, create candidate`,
    `${hk("i")}  import: read-only candidates from inbox / GitHub / Azure`,
    `${hk("e / v")}  edit/review the canonical packet (objective, checks, priority, risk, route)`,
    `${hk("a")}  attach a URL or local screenshot/file; local files are copied into the task packet`,
    `${hk("x")}  add/remove the selected task in the execution queue`,
    `${hk("l")}  launch preview; Enter / y confirms the queued run`,
    `${hk("Q")}  execution queue: live gate state per queued task (d remove · l launch)`,
    `${hk("L")}  logs: state decisions + feed narration in one stream (F follow · End latest)`,
    `${hk("b / i")}  queue feedback for the next bot / interrupt and restart the active session`,
    `${hk("Shift+R")}  reopen the run view from anywhere while a queue run is live`,
    `${hk("u", "amber")}  unblock the selected blocked task; then x queue and l run`,
    `${hk("w")}  explain the selected task in the bounded command console`,
    `${hk(":")}  open the ATL command console (help, why, queue, task, feedback, launch)`,
    `${hk("p")}  providers: executable + model + per-role mapping (change with atl provider set ...)`,
    `${hk("s")}  sessions: provider session logs (Enter opens at the latest output)`,
    `${hk("f")}  open the full team feed; ↑↓ scroll, PgUp/PgDn jump`,
    `${hk("r")}  force a refresh (state.json + feed.jsonl are also re-read automatically)`,
    `${hk("Esc")}  back to the previous screen (works on every screen)`,
    `${hk("q")}  quit without changing state`,
    "",
    paint("Live: the room re-reads state.json + feed.jsonl every ~2s, and every 1s while a run is active.", "muted", plain),
    paint("Dispatch boundary: a confirmed run is sequential, bounded, and uses per-role providers.", "muted", plain),
    paint("The run screen shows queue progress and the active session-log tail while it works.", "muted", plain),
    "",
    paint("Source of truth", "violet", plain),
    ".trust/manager/state.json   portfolio and gate state",
    ".trust/manager/queue.json   execution queue membership",
    ".trust/manager/drafts/      immutable composed drafts",
    ".trust/manager/feed.jsonl   team narration",
    ".trust/manager/overnight/   provider session logs",
  ];
  return panel("HELP", body, width, height, { accent: "violet", plain }).join("\n");
}

export function renderCommandScreen(ui, width, height, plain) {
  const inner = Math.max(20, width - 4);
  const command = ui.command || { input: "", output: [] };
  const output = [];
  for (const line of command.output || []) output.push(...wrap(String(line), inner));
  const visible = Math.max(4, height - 8);
  const maxOffset = Math.max(0, output.length - visible);
  const offset = Math.min(Math.max(0, Number(command.outputScroll) || 0), maxOffset);
  const page = output.slice(offset, offset + visible);
  const history = (ui.commandHistory || []).length;
  const inputWidth = Math.max(10, inner - 2);
  const rawInput = String(command.input || "");
  // Keep the insertion end visible while a long ATL command is being typed.
  // The previous leading truncate made the TUI appear to stop accepting input
  // once the command crossed the right edge.
  const input = widthOf(rawInput) <= inputWidth
    ? rawInput
    : `…${rawInput.slice(-(inputWidth - 1))}`;
  const lines = [
    paint("ATL command console · accepts `atl <command>` · no shell execution", "muted", plain),
    paint("Use ? or help for commands. Mutations use the same audited runtime as the CLI.", "faint", plain),
    "",
    ...(page.length ? page : [paint("No command output yet. Try: why T-001", "muted", plain)]),
    "",
    `${paint(":", "coral", plain)} ${input}`,
    paint(`history ${history} · output ${output.length ? `${offset + 1}-${Math.min(output.length, offset + page.length)} / ${output.length}` : "empty"} · Enter run · ↑↓ history/scroll · PgUp/PgDn output · Esc back`, "faint", plain),
  ];
  return panel("COMMAND CONSOLE", lines, width, height, { accent: "violet", plain }).join("\n");
}

const TEAM_PHASE_COLOR = {
  blocked: "amber",
  escalated: "coral",
  in_progress: "mint",
  in_review: "violet",
  verifying: "mint",
  done: "mint",
};

const TEAM_PHASE_COMPACT = {
  "awaiting assignment": "WAITING",
  "ready to start": "READY",
  working: "WORKING",
  "independent review": "REVIEW",
  verification: "VERIFYING",
  "blocked — manager action": "BLOCKED",
  "escalated to owner": "ESCALATED",
  shipped: "SHIPPED",
  idle: "IDLE",
};

export function renderTeamScreen(snapshot, ui, width, height, plain) {
  const plane = snapshot.controlPlane || snapshot;
  const inner = Math.max(20, width - 6);
  const compact = width < 70;
  const team = Array.isArray(plane.team) && plane.team.length ? plane.team : null;
  const lines = [paint("TEAM · five role contracts over one authoritative state", "muted", plain)];
  if (team?.[0]?.latestBrief) lines.push(paint(`latest brief ${team[0].latestBrief.name}`, "faint", plain));
  lines.push("");
  if (!team) {
    const roles = [
      ["mira", "coordinates, assigns, unblocks, escalates"],
      ["pip", "frames intake into bounded tasks"],
      ["rowan", "builds in isolated workspaces"],
      ["sage", "reviews independently"],
      ["beacon", "verifies and watches the gates"],
    ];
    const tasks = plane.state?.tasks || Object.fromEntries((snapshot.tasks || []).map((task) => [task.id, task]));
    const events = plane.state?.log_tail || snapshot.state?.log || [];
    for (const [role, mission] of roles) {
      const assigned = Object.values(tasks).filter((task) => task.assigned_worker === role && !["done", "rejected", "archived"].includes(task.status));
      const last = [...events].reverse().find((event) => event.actor === role || (role === "mira" && event.actor === "manager"));
      const activeRun = (ui.runTasks || []).find((entry) => entry.role === role && ["running", "gate"].includes(entry.state));
      const state = activeRun ? activeRun.state : assigned[0]?.status || "idle";
      lines.push(`${paint("▸", role === "mira" ? "coral" : "violet", plain)} ${paint(role.padEnd(7), "ink", plain)} ${statusLine(state, plain, true)} ${paint(mission, "muted", plain)}`);
      lines.push(`    task ${assigned[0]?.id || activeRun?.taskId || "-"} · provider ${activeRun?.provider || "not running"} · last ${last ? `${last.event} ${timeOf(last.at)}` : "no event"}`);
    }
  } else {
    for (const card of team) {
      const phaseText = card.phase.toUpperCase();
      const phase = compact ? (TEAM_PHASE_COMPACT[card.phase] || phaseText.slice(0, 8)) : phaseText;
      const color = TEAM_PHASE_COLOR[card.taskStatus] || "muted";
      const missionRoom = compact ? 0 : Math.max(12, inner - card.role.length - phase.length - 8);
      const mission = missionRoom > 12 ? paint(truncate(card.mission, missionRoom), "muted", plain) : "";
      lines.push(`${paint("▸", card.role === "mira" ? "coral" : "violet", plain)} ${paint(card.role.padEnd(7), "ink", plain)} ${paint(phase, color, plain)}${mission ? " " + mission : ""}`);
      const facts = [
        `task ${card.taskId || "-"}`,
        `queue ${card.queueId || "-"}`,
        `provider ${card.provider ? `${card.provider}${card.model ? `/${card.model}` : ""}` : "not running"}`,
      ];
      lines.push(truncate(`    ${facts.join(" · ")}`, inner));
      if (card.session) {
        lines.push(truncate(paint(`    session ${card.session.n ?? "?"} · ${path.basename(String(card.session.logPath || ""))}`, "faint", plain), inner));
      }
      if (card.feedback) {
        // Safety-relevant state gets its own line: it must survive narrow
        // widths instead of being clipped off a shared truncated tail.
        lines.push(truncate(paint(`    feedback ${card.feedback.pending} pending (${card.feedback.latest.slice(0, 13)})`, "amber", plain), inner));
      }
      if (!card.session && !card.feedback) {
        lines.push(paint("    no session yet · Enter/: inspect · L logs", "faint", plain));
      }
    }
  }
  lines.push("", paint("Enter/: inspect with the command console · L logs · Esc back", "faint", plain));
  return panel("TEAM", lines, width, height, { accent: "mint", plain }).join("\n");
}

export function renderNotificationsScreen(snapshot, width, height, plain) {
  const plane = snapshot.controlPlane || snapshot;
  const items = plane.notifications?.items || [];
  const inner = Math.max(20, width - 4);
  const lines = [paint("Manager notifications · deduplicated state, run, blocker, and usage signals", "muted", plain), ""];
  if (!items.length) lines.push(paint("No notifications yet. The room is quiet.", "muted", plain));
  for (const item of items.slice(0, Math.max(1, height - 7))) {
    const color = item.severity === "danger" ? "coral" : item.severity === "warning" ? "amber" : "mint";
    const badge = item.count > 1 ? paint(` ×${item.count}`, color, plain) : "";
    lines.push(`${paint(item.state === "unread" ? "●" : "○", color, plain)} ${paint(item.severity, color, plain)}${badge} ${timeOf(item.at)} · ${item.title}`);
    lines.push(...wrap(truncate(item.message, inner), inner));
    // Source-object links: every notification names the object it came from.
    const links = [item.taskId ? `→ ${item.taskId}` : null, item.queueId ? `queue ${item.queueId}` : null, item.runId ? `run ${item.runId}` : null].filter(Boolean).join(" · ");
    if (links) lines.push(paint(`  ${links}`, "faint", plain));
    if (item.action) lines.push(paint(`  action: ${item.action}`, "faint", plain));
    if (item.state === "snoozed" && item.snoozed_until) lines.push(paint(`  snoozed until ${item.snoozed_until}`, "faint", plain));
  }
  lines.push("", paint("N opens this panel · : notify list|ack <id>|snooze <id> [minutes] · Esc back", "faint", plain));
  return panel("NOTIFICATIONS", lines, width, height, { accent: "amber", plain }).join("\n");
}

export function renderUsageScreen(snapshot, ui, width, height, plain) {
  const plane = snapshot.controlPlane || snapshot;
  const latest = plane.usage?.latest;
  const lines = [paint("Usage and capacity · local budgets are authoritative; provider quota may be unknown", "muted", plain), ""];
  const budget = ui.launchBudget || { maxMinutes: 120, maxSessions: 8 };
  lines.push(`${paint("LOCAL RUN BUDGET", "violet", plain)}  ${budget.maxMinutes} minutes · ${budget.maxSessions} sessions · explicit launch policy`);
  lines.push(`${paint("OBSERVED USAGE", "mint", plain)}  ${latest ? `${latest.provider || "provider"} · ${latest.model || "model"} · ${latest.status} · ${latest.source}` : "no provider snapshot recorded yet"}`);
  if (latest) {
    const freshness = usageFreshness(latest, { maxAgeMs: ui.usageMaxAgeMs ?? 60 * 60000 });
    lines.push(`  freshness: ${freshness.fresh ? paint(freshness.label, "mint", plain) : paint(freshness.label, "amber", plain)} · confidence ${latest.confidence || "low"}${latest.detail ? ` · ${truncate(latest.detail, Math.max(12, inner - 20))}` : ""}`);
  }
  if (latest?.used) lines.push(`  used: ${JSON.stringify(latest.used)} · captured ${timeOf(latest.captured_at)}`);
  lines.push(`${paint("REMOTE REMAINING", latest?.remaining == null ? "faint" : "amber", plain)}  ${latest?.remaining == null ? "unknown — provider adapter/auth did not expose a verified quota" : JSON.stringify(latest.remaining)}`);
  if (latest?.reset_at) lines.push(`  reset: ${latest.reset_at}`);
  lines.push("", paint("Forecasts must be labeled estimates and never replace the provider's authoritative value.", "faint", plain));
  lines.push("", paint("U opens this panel · : usage/queue commands · Esc back", "faint", plain));
  return panel("USAGE", lines, width, height, { accent: "violet", plain }).join("\n");
}

export function renderPlanStudioScreen(root, ui, width, height, plain) {
  const inner = Math.max(20, width - 4);
  const studioDir = path.join(path.dirname(paths(root).state), "plan-studio");
  let drafts = [];
  try {
    drafts = fs.existsSync(studioDir)
      ? fs.readdirSync(studioDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
        try { return loadPlanDraft(root, entry.name); } catch { return null; }
      }).filter(Boolean).sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)))
      : [];
  } catch { drafts = []; }
  const current = ui.planStudio?.draft || drafts[0] || null;
  const lines = [
    paint("Plan Studio · intent → ATL SDD/TDD artifact → manager approval", "muted", plain),
    paint("Provider planning is an explicit action; this screen never silently spends quota or starts work.", "faint", plain),
    "",
  ];
  if (ui.planStudio?.intent) {
    lines.push(`${paint("WORKING INTENT", "coral", plain)}  ${truncate(ui.planStudio.intent, inner - 15)}`);
    lines.push(paint("deterministic frame ready · c edit intent · f save frame · : command console", "mint", plain), "");
  }
  if (!current) {
    lines.push(paint("No plan drafts yet.", "muted", plain), "", paint("c start an intent · : plan frame ... · Esc back", "faint", plain));
  } else {
    lines.push(`${paint("DRAFT", "violet", plain)} ${truncate(current.id, inner - 8)} · stage ${current.stage}`);
    lines.push(`${paint("title", "faint", plain)} ${truncate(current.artifact?.title || "intent-only draft", inner - 8)}`);
    lines.push(`${paint("objective", "faint", plain)} ${truncate(current.artifact?.objective || current.intent, inner - 11)}`);
    lines.push(`${paint("skills", "faint", plain)} ${(current.artifact?.selected_skills || []).join(", ") || "select through ATL route"}`);
    lines.push("", paint("Stages: intent → frame → specify → route → plan → review → approved", "muted", plain));
    if (current.artifact?.implementation_steps?.length) lines.push(`${paint("steps", "faint", plain)} ${current.artifact.implementation_steps.length} · ${current.artifact.verifier_commands.length} verifier command(s)`);
    lines.push("", paint("c edit intent · f save deterministic frame · a approve a complete provider plan · : commands · Esc back", "faint", plain));
  }
  if (drafts.length > 1) lines.push("", paint(`${drafts.length} saved draft(s) · newest shown`, "faint", plain));
  return panel("PLAN STUDIO", lines, width, height, { accent: "violet", plain }).join("\n");
}

export function renderSettingsScreen(root, ui, width, height, plain) {
  const cfg = configSafe(root);
  const queuePolicy = ui.snapshot.controlPlane?.queues?.items?.find((queue) => queue.id === ui.snapshot.controlPlane?.queues?.active_queue)?.policy || {};
  const lines = [
    paint("Settings · explicit policies and local-only controls", "muted", plain),
    "",
    `${paint("workspace", "faint", plain)} ${root}`,
    `${paint("active queue", "faint", plain)} ${ui.snapshot.controlPlane?.queues?.active_queue || "default"}`,
    `${paint("concurrency", "faint", plain)} ${queuePolicy.maxConcurrent || 1} active session(s) by default`,
    `${paint("run budget", "faint", plain)} ${queuePolicy.maxMinutes || 120}m · ${queuePolicy.maxSessions || 5} sessions`,
    `${paint("provider default", "faint", plain)} ${cfg.providers?.use || "configured role/default"}`,
    `${paint("remote quota", "faint", plain)} unknown unless a provider adapter verifies it`,
    "",
    paint("SAFETY", "violet", plain),
    "provider planning requires explicit confirmation",
    "archive/restore is recoverable; hard deletion is not exposed by default",
    "launch stays behind preview + Enter/y confirmation",
    "",
    paint("KEYBOARD", "violet", plain),
    "Tab sidebar/pane · : command console · c new task · w why · u unblock",
    "Q queues · L logs · Shift+R run · Shift+U usage · ? help · Esc back",
    "",
    paint("Settings are read-only in this first control-plane slice; policy mutations remain CLI/domain actions until their approval contract is added.", "faint", plain),
  ];
  return panel("SETTINGS", lines, width, height, { accent: "mint", plain }).join("\n");
}

function controlPlaneRouteForScreen(screen) {
  return {
    dashboard: "dashboard",
    tasks: "tasks",
    compose: "tasks",
    queue: "queue",
    launch: "queue",
    plan: "plan",
    team: "team",
    logs: "activity",
    notifications: "activity",
    usage: "usage",
    settings: "settings",
    providers: "settings",
  }[screen] || null;
}

function controlPlaneDimensions(width, height) {
  const safeWidth = Math.max(60, Number(width) || 120);
  const safeHeight = Math.max(14, Number(height) || 34);
  const shell = layoutFor(safeWidth, safeHeight);
  const wide = shell.mode === "wide";
  const routeRows = wide ? 0 : routeSwitcherLayout(safeWidth).length;
  const headerRows = 1;
  const dockRows = 2;
  const contentWidth = wide ? safeWidth - TUI_SIDEBAR_WIDTH - 1 : safeWidth;
  const contentHeight = Math.max(8, safeHeight - headerRows - routeRows - dockRows - 2);
  return { safeWidth, safeHeight, shell, wide, routeRows, contentWidth: Math.max(24, contentWidth), contentHeight };
}

function controlPlaneContentOrigin(dims) {
  return 2 + dims.routeRows + (dims.routeRows ? 1 : 0);
}

function renderedItemIndexAtLine(lines, items, line, { column = null, maxColumn = Infinity } = {}) {
  const candidates = items.map((item, index) => {
    const needles = [item?.id, item?.name, item].filter(Boolean).map((value) => String(value).toLowerCase());
    const matches = lines.map((value, row) => ({ value, row })).filter(({ value, row }) => row > 0 && needles.some((needle) => value.toLowerCase().includes(needle)));
    const match = matches.find(({ value }) => column === null || needles.some((needle) => {
      const at = value.toLowerCase().indexOf(needle);
      return at >= 0 && at < maxColumn;
    }));
    return { index, line: match?.row ?? -1 };
  }).filter((item) => item.line >= 0);
  const hit = candidates.find((item) => item.line === line);
  return hit ? hit.index : -1;
}

export function renderControlPlaneShell(snapshot, { route = "dashboard", body = "", width = 120, height = 34, plain = false, interactive = true, syncedAt = null, loading = false, spinner = 0 } = {}) {
  const dims = controlPlaneDimensions(width, height);
  const header = renderHeader(snapshot, dims.safeWidth, { plain, loading, spinner, interactive, syncedAt, routeLabel: TUI_NAV_ITEMS.find((item) => item[0] === route)?.[1] || "Overview" });
  const routeLines = dims.wide ? [] : renderRouteSwitcher(route, dims.safeWidth, plain);
  const content = String(body || "").split("\n").slice(0, dims.contentHeight).map((line) => fit(line, dims.contentWidth));
  while (content.length < dims.contentHeight) content.push("");
  const center = content.map((line) => fit(line, dims.contentWidth));
  const main = dims.wide
    ? joinPanels([renderSidebar(route, TUI_SIDEBAR_WIDTH, dims.contentHeight, plain), center])
    : center;
  const dock = interactive
    ? [
      `${paint("atl ›", "mint", plain)} ${paint(": commands", "ink", plain)}  ${paint("Ctrl-K palette", "faint", plain)}  ${paint("n new task", "mint", plain)}  ${paint("6 activity", "muted", plain)}  ${paint("q quit", "muted", plain)}`,
      `${paint("●", "mint", plain)} ${paint("LIVE", "mint", plain)}  ${paint("state-backed control plane", "faint", plain)}${snapshot.controlPlane?.usage?.latest ? `  ·  ${paint("usage observed", "violet", plain)}` : ""}`,
    ]
    : [paint("SNAPSHOT · read-only · run `atl ui` for keyboard navigation", "faint", plain)];
  const lines = [header, paint("─".repeat(dims.safeWidth), "line", plain), ...routeLines, ...(routeLines.length ? [""] : []), ...main, "", ...dock];
  return lines.slice(0, dims.safeHeight).join("\n");
}

function readTaskFile(root, task) {
  const filePath = resolveTaskSource(root, task);
  if (!filePath) {
    return {
      root,
      taskId: task?.id,
      filePath: null,
      lines: [],
      scroll: 0,
      error: `Could not resolve a local source file. Checked: ${resolveSourceCandidates(root, task).map((item) => path.relative(root, item)).join(", ") || "no path supplied"}`,
    };
  }
  try {
    return { root, taskId: task.id, filePath, lines: fs.readFileSync(filePath, "utf8").split(/\r?\n/), scroll: 0, error: null };
  } catch (error) {
    return { root, taskId: task.id, filePath, lines: [], scroll: 0, error: `Could not read ${filePath}: ${error.message}` };
  }
}

// ---------- control-room screens (spec 014)
//
// The TUI may create, shape, queue, and explicitly run tasks through the same
// bounded runner functions the CLI uses. There is no implicit launch: the
// launch screen is a confirmation gate and the run screen owns progress.

function configSafe(root) {
  try {
    return JSON.parse(fs.readFileSync(paths(root).config, "utf8"));
  } catch {
    return {};
  }
}

function writeManagerConfig(root, config) {
  const file = paths(root).config;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n");
  try {
    fs.renameSync(temp, file);
  } catch {
    // Windows cannot rename onto an existing file; copy keeps the write whole.
    fs.copyFileSync(temp, file);
    fs.rmSync(temp, { force: true });
  }
}

const PROVIDER_WORKER_OPTIONS = [
  { key: "c", label: "claude — run it through the Claude Code CLI", note: "Anthropic-compatible endpoints (Z.ai GLM, bigmodel.cn, any /api/anthropic)." },
  { key: "x", label: "codex — run it through the Codex CLI", note: "OpenAI-compatible endpoints (Z.ai coding API, any /v4 chat endpoint)." },
];

export function scanSessions(root) {
  const base = path.join(root, ".trust", "manager", "overnight");
  const out = [];
  let taskDirs = [];
  try {
    taskDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out;
  }
  for (const taskId of taskDirs.sort()) {
    const dir = path.join(base, taskId);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.startsWith("session-") && f.endsWith(".log")).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const stat = fs.statSync(full);
        let summary = null;
        const summaryFile = full.replace(/\.log$/i, ".json");
        try { summary = JSON.parse(fs.readFileSync(summaryFile, "utf8")); } catch { /* session still running */ }
        out.push({ taskId, file: full, name: file, size: stat.size, mtime: stat.mtime.toISOString(), summary });
      } catch { /* raced with a delete; skip */ }
    }
  }
  return out;
}

function newEditor({ kind, taskId = null, title, hint, text = "", multiline = false, mask = false, onSubmit }) {
  const initial = String(text || "").split("\n");
  return { kind, taskId, title, hint, multiline, mask, lines: initial.length ? initial : [""], row: Math.max(0, initial.length - 1), col: initial.at(-1)?.length || 0, onSubmit };
}

function editorText(editor) {
  return editor.lines.join("\n");
}

function renderEditorScreen(ui, width, height, plain) {
  const e = ui.editor;
  const inner = Math.max(16, width - 4);
  const display = (line) => (e.mask ? "•".repeat(line.length) : line);
  const lines = [
    paint(e.title, "violet", plain),
    ...wrap(e.hint || "", inner),
    "",
    ...e.lines.map((line, index) => {
      const shownLine = display(line);
      const shown = index === e.row ? `${shownLine.slice(0, e.col)}${paint("▌", "coral", plain)}${shownLine.slice(e.col)}` : shownLine;
      return ` ${shown}`;
    }),
    "",
    paint(e.multiline
      ? "Enter newline · Ctrl+S submit · Esc cancel"
      : "Enter submit · Esc cancel", "muted", plain),
  ];
  return panel(`COMPOSE · ${e.kind.toUpperCase()}`, lines, width, height, { accent: "coral", plain }).join("\n");
}

const COMPOSE_INTENTS = [
  { key: "f", label: "Fix a problem", note: "Repair an observed failure, mismatch, or regression." },
  { key: "b", label: "Build a capability", note: "Add behavior, a workflow, or a user-facing feature." },
  { key: "d", label: "Document or explain", note: "Make a system, decision, or process understandable." },
  { key: "o", label: "Operate or recover", note: "Run, diagnose, contain, or restore a system." },
];

const COMPOSE_AUDIENCES = [
  { key: "r", label: "Repository / code", note: "The primary change is in source, tests, or tooling." },
  { key: "u", label: "User experience", note: "The result should improve what a person sees or does." },
  { key: "t", label: "Team / process", note: "The result changes coordination, policy, or a handoff." },
  { key: "s", label: "System / operations", note: "The result affects runtime health, deployment, or recovery." },
];

function composeOptionRows(options, selected, width, plain) {
  const inner = Math.max(18, width - 4);
  const rows = [];
  for (const [index, option] of options.entries()) {
    const active = index === selected;
    const prefix = `${option.key}  ${option.label}`;
    const row = `${active ? "▸" : " "} ${prefix}`;
    rows.push(active ? focusRow(row, inner, plain) : row);
    rows.push(`    ${paint(truncate(option.note, inner - 4), "faint", plain)}`);
  }
  return rows;
}

function composeStepLabel(step) {
  return step === "intent" ? "1/4" : step === "audience" ? "2/4" : step === "body" ? "3/4" : "4/4";
}

export function renderComposeScreen(ui, width, height, plain) {
  const flow = ui.composeFlow || { step: "intent", intentIndex: 0, audienceIndex: 0 };
  const inner = Math.max(18, width - 4);
  const selectedIntent = COMPOSE_INTENTS[flow.intentIndex] || COMPOSE_INTENTS[0];
  const selectedAudience = COMPOSE_AUDIENCES[flow.audienceIndex] || COMPOSE_AUDIENCES[0];
  const lines = [
    paint("NOT SURE WHAT TO WRITE?", "faint", plain),
    paint("Start from the outcome, not an ATL field.", "ink", plain),
    paint("Choose a shape for the work, then describe it in your own words. ATL keeps the raw draft and prepares a reviewable packet.", "muted", plain),
    "",
  ];

  if (flow.step === "intent") {
    lines.push(paint("What should change?", "violet", plain), "", ...composeOptionRows(COMPOSE_INTENTS, flow.intentIndex, width, plain));
    lines.push("", paint("↑↓ / j k move · Enter choose · 1-4 jump · Esc cancel", "muted", plain));
  } else if (flow.step === "audience") {
    lines.push(`${paint("OUTCOME", "faint", plain)}  ${paint(selectedIntent.label, "coral", plain)}`, "");
    lines.push(paint("Where will the result land?", "violet", plain), "", ...composeOptionRows(COMPOSE_AUDIENCES, flow.audienceIndex, width, plain));
    lines.push("", paint("↑↓ / j k move · Enter choose · 1-4 jump · Esc back", "muted", plain));
  } else if (flow.step === "preview" && flow.preview) {
    const preview = flow.preview;
    lines.push(paint("RECOMMENDED ATL TASK", "mint", plain));
    lines.push(paint(truncate(preview.title, inner), "ink", plain), "");
    lines.push(`${paint("intent", "faint", plain)}    ${selectedIntent.label}`);
    lines.push(`${paint("surface", "faint", plain)}   ${selectedAudience.label}`);
    lines.push(`${paint("route", "faint", plain)}     ${(preview.route?.selected_skills || []).join(", ") || "unresolved"} → ${preview.route?.proposed_worker || "Pip triage"}`);
    lines.push(`${paint("priority", "faint", plain)}  ${preview.priority || "normal"}    ${paint("risk", "faint", plain)} ${preview.risk || "normal"}`, "");
    lines.push(paint("OBJECTIVE HINT", "violet", plain), ...wrap(preview.objective_hint || "Pip will shape the objective during triage.", inner));
    lines.push("", paint(`CHECKS · ${preview.completion_checks?.length || 0}`, "violet", plain));
    if (preview.completion_checks?.length) {
      for (const check of preview.completion_checks.slice(0, 4)) lines.push(` · ${truncate(check, inner - 3)}`);
    } else {
      lines.push(paint(" · Add observable checks in packet review after creation.", "amber", plain));
    }
    lines.push("", paint("Enter create candidate · e edit wording · Esc cancel", "muted", plain));
  } else {
    lines.push(`${paint("OUTCOME", "faint", plain)}  ${selectedIntent.label}`);
    lines.push(`${paint("SURFACE", "faint", plain)}  ${selectedAudience.label}`, "");
    lines.push(paint("Now describe the task", "violet", plain));
    lines.push(paint("The first line becomes the title. Add context, constraints, or Checks: bullets below it.", "muted", plain));
    lines.push("", paint("Ctrl+S opens the generated ATL packet before anything is saved.", "mint", plain));
    lines.push("", paint("Esc back", "muted", plain));
  }
  return panel(`COMPOSE · ${flow.step.toUpperCase()} · ${composeStepLabel(flow.step)}`, lines, width, height, { accent: "coral", plain }).join("\n");
}

const IMPORT_SOURCES = [
  { key: "f", label: "file inbox", note: "markdown files in .trust/manager/inbox" },
  { key: "g", label: "GitHub issues", note: "read-only; enable with: atl intake enable github --repo owner/name" },
  { key: "a", label: "Azure Boards", note: "read-only; enable with: atl intake enable azure (needs the PAT env var)" },
];

function renderImportScreen(ui, width, height, plain) {
  const inner = Math.max(16, width - 4);
  const imp = ui.importState;
  const lines = [paint("Read-only import — nothing is ever written back to the source.", "muted", plain), ""];
  if (!imp || (!imp.loading && !imp.candidates)) {
    lines.push(paint("Pick a source:", "ink", plain));
    for (const s of IMPORT_SOURCES) {
      lines.push(`  ${paint(s.key, "coral", plain)}  ${paint(s.label, "ink", plain)}`);
      lines.push(`     ${paint(s.note, "faint", plain)}`);
    }
  } else if (imp.loading) {
    lines.push(paint(`Reading ${imp.sourceLabel}…`, "amber", plain));
  } else if (imp.error) {
    lines.push(paint(`Could not read ${imp.sourceLabel}:`, "coral", plain));
    lines.push(...wrap(imp.error, inner));
    lines.push("", paint("Esc back · pick another source (f/g/a)", "muted", plain));
  } else {
    const known = new Set(ui.snapshot.tasks.map((t) => t.intake_key).filter(Boolean));
    lines.push(paint(`${imp.candidates.length} candidate(s) from ${imp.sourceLabel} — ↑↓ move · Enter import · a import all`, "ink", plain));
    imp.candidates.forEach((cand, index) => {
      const seen = known.has(cand.intake_key);
      const mark = index === (imp.selected || 0) ? paint("▸", "coral", plain) : " ";
      const badge = seen ? paint(" already imported", "muted", plain) : "";
      lines.push(`${mark} ${truncate(cand.title, Math.max(12, inner - 4))}${badge}`);
      if (cand.labels?.length) lines.push(`    ${paint(truncate(cand.labels.join(", "), inner - 6), "faint", plain)}`);
    });
    lines.push("", paint("Esc back", "muted", plain));
  }
  return panel("IMPORT", lines, width, height, { accent: "mint", plain }).join("\n");
}

export function renderReviewScreen(snapshot, ui, width, height, plain) {
  const inner = Math.max(16, width - 4);
  const task = snapshot.tasks.find((t) => t.id === ui.reviewTaskId);
  if (!task) return panel("PACKET REVIEW", [paint("Task no longer exists.", "coral", plain)], width, height, { accent: "violet", plain }).join("\n");
  const queued = (snapshot.queue || []).some((q) => q.id === task.id);
  const lines = [
    `${paint(task.id, "ink", plain)}  ${statusLine(task.status, plain)}  ${queued ? paint("⌁ queued", "mint", plain) : paint("not queued", "muted", plain)}`,
    ...wrap(task.title, inner),
    "",
    ...(task.objective
      ? wrap(`${paint("OBJECTIVE", "violet", plain)} ${task.objective}`, inner)
      : wrap(`${paint("proposed objective", "amber", plain)} (not yet set) ${task.objective_hint || "—"}`, inner)),
    "",
    paint(`CHECKS · ${task.completion_checks.length}  (n add · d+digit remove)`, "faint", plain),
    ...(task.completion_checks.length
      ? task.completion_checks.map((c, i) => ` ${paint(`${i + 1}`, "coral", plain)} ${truncate(c, Math.max(10, inner - 5))}`)
      : [paint(" (no observable checks yet — Pip or you must define them)", "amber", plain)]),
    "",
    paint(`RESOURCES · ${task.resources?.length || 0}  (a add link/file/image)`, "faint", plain),
    ...(task.resources?.length
      ? task.resources.slice(0, 5).flatMap((resource) => wrap(`[${resource.kind}] ${resource.label}: ${resource.ref}`, inner))
      : [paint(" (none — paste a URL or local screenshot path with a)", "muted", plain)]),
    "",
    `${paint("priority", "faint", plain)} ${task.priority} (p cycles)   ${paint("risk", "faint", plain)} ${task.risk}${task.review_required ? paint(" · review required", "amber", plain) : ""} (k toggles)`,
    `${paint("route", "faint", plain)} ${(task.selected_skills || []).join(", ") || "unresolved"} → ${task.proposed_worker || "-"} (t reroutes)`,
    task.resources?.length
      ? `${paint("resources", "faint", plain)} ${task.resources.length} attached (a adds link/file/image)`
      : `${paint("resources", "faint", plain)} none attached (a adds link/file/image)`,
    task.composition
      ? `${paint("framed", "faint", plain)} ${task.composition.intent} · ${task.composition.audience}`
      : "",
    `${paint("source", "faint", plain)} ${truncate(task.source?.url || task.source?.type || "manual", inner)}`,
    "",
    task.status === "blocked"
      ? paint("u resolve blocker (write what changed) → assigned/triaged · x queue · l run preview", "amber", plain)
      : paint("o edit objective · a add resource · x queue toggle · T approve packet → triaged (manager override)", "muted", plain),
    paint("Esc back — l opens the launch gate; Enter / y confirms the queued run", "faint", plain),
  ];
  return panel("PACKET REVIEW", lines, width, height, { accent: "violet", plain }).join("\n");
}

export function renderQueueScreen(snapshot, ui, width, height, plain) {
  const inner = Math.max(16, width - 4);
  const plan = ui.launchPlan?.items?.length ? ui.launchPlan : null;
  const entries = plan ? plan.items : [];
  const live = new Map(snapshot.tasks.map((t) => [t.id, t]));
  const queueBook = snapshot.controlPlane?.queues;
  const runs = new Map((ui.runTasks || []).map((t) => [t.taskId, t]));
  const lines = [
    paint(`Execution queue — active: ${queueBook?.active_queue || "default"}. Membership, not focus; stored in .trust/manager/queue.json.`, "muted", plain),
    "",
  ];
  if (queueBook?.items?.length) {
    lines.push(paint("QUEUES", "faint", plain));
    for (const queue of queueBook.items) {
      const marker = queue.id === queueBook.active_queue ? "▸" : " ";
      const statusTag = queue.status === "paused" ? paint(" · paused", "amber", plain) : "";
      lines.push(`${marker} ${queue.id} · ${queue.items.length} task(s) · ${queue.policy.maxMinutes}m/${queue.policy.maxSessions} sessions${statusTag}`);
    }
    lines.push("");
  }
  if (!entries.length) {
    lines.push(paint("Queue is empty. Select work with x on a task (here or in packet review).", "muted", plain));
  } else {
    entries.forEach((item, index) => {
      const mark = index === (ui.queueSelected || 0) ? paint("▸", "coral", plain) : " ";
      const task = live.get(item.taskId);
      const run = runs.get(item.taskId);
      const state = run?.state === "running" ? "in_progress" : (task?.status || item.status);
      lines.push(`${mark} ${paint(String(index + 1), "faint", plain)} ${paint(item.taskId, "ink", plain)} ${statusLine(state, plain, true)} ${paint(`→ ${item.role || "-"}`, "faint", plain)} ${paint(`${item.provider.worker} · ${item.provider.model || "provider default"} · ${item.provider.auth}`, "violet", plain)}`);
      lines.push(`    ${truncate(item.title, Math.max(10, inner - 4))}`);
      for (const b of item.blockers) lines.push(`    ${paint(`BLOCKED: ${truncate(b, Math.max(10, inner - 12))}`, "coral", plain)}`);
    });
    lines.push("", paint("d remove highlighted · l launch preview · gate states refresh live · Esc back", "muted", plain));
  }
  return panel("EXECUTION QUEUE", lines, width, height, { accent: "coral", plain }).join("\n");
}

export function renderLaunchPreviewScreen(ui, width, height, plain) {
  const inner = Math.max(16, width - 4);
  const plan = ui.launchPlan;
  const lines = [paint("Launch preview — confirmation gate. Nothing starts until Enter / y.", "amber", plain), ""];
  if (!plan || !plan.items.length) {
    lines.push(paint("Queue is empty — nothing to launch.", "muted", plain));
  } else {
    lines.push(`${paint(plan.items.length, "ink", plain)} queued · ${paint(plan.readyCount, "mint", plain)} ready · ${paint(plan.blockedCount, "coral", plain)} blocked · sequential · budget ${plan.budget.maxMinutes}m / ${plan.budget.maxSessions} sessions ${paint("· SHARED by the whole queue", "faint", plain)}`);
    for (const item of plan.items) {
      lines.push("");
      lines.push(`${paint(item.taskId, "ink", plain)} [${item.status} → ${item.role || "-"}] ${paint(`${item.provider.worker} · ${item.provider.model || "provider default"} · ${item.provider.auth}`, "violet", plain)} (${item.provider.source})`);
      lines.push(...wrap(truncate(item.title, inner), inner));
      lines.push(paint(`  ws: ${truncate(item.workspace || item.workspaceNote || "-", inner - 6)} · logs: ${item.sessionLogs}`, "faint", plain));
      if (item.command) lines.push(paint(`  cmd: ${truncate(item.command, inner - 6)}`, "faint", plain));
      for (const b of item.blockers) lines.push(...wrap(paint(`  BLOCKED: ${b}`, "coral", plain), inner));
    }
    lines.push("");
    lines.push(paint(`Press Enter / y to run now:  ${plan.confirmCommand}`, "mint", plain));
  }
  lines.push("", paint(`p ${ui.pauseAfterBot ? "disable" : "enable"} pause-after-bot · +/− more/fewer sessions · [ ] less/more minutes · Enter / y confirm run · r rebuild · Esc back`, "muted", plain));
  return panel("LAUNCH PREVIEW", lines, width, height, { accent: "amber", plain }).join("\n");
}

const RUN_STATE_STYLE = {
  queued: { icon: "○", color: "muted" },
  running: { icon: "●", color: "mint" },
  gate: { icon: "◉", color: "violet" },
  done: { icon: "◆", color: "mint" },
  blocked: { icon: "×", color: "amber" },
  failed: { icon: "!", color: "coral" },
  skipped: { icon: "–", color: "muted" },
};

export function renderRunScreen(ui, width, height, plain) {
  const inner = Math.max(16, width - 4);
  const current = ui.runCurrent;
  const tasks = ui.runTasks || [];
  const now = Date.now();
  const total = ui.runStartedAt ? elapsedOf((ui.runEndedAt || now) - ui.runStartedAt) : "-";
  const lines = [
    paint(ui.running ? `Queue is running · total ${total} — raw provider output stays in session logs.` : `Queue run finished · total ${total} — inspect the feed and session logs for evidence.`, ui.running ? "amber" : "mint", plain),
  ];
  if (current) {
    const sessionElapsed = current.startedAt ? elapsedOf(now - current.startedAt) : null;
    lines.push(`${paint("CURRENT", "faint", plain)}  ${paint(current.taskId, "ink", plain)} · ${current.role} · ${current.provider}${current.model ? ` · ${current.model}` : ""}${current.sessionMax ? ` · session ${current.session}/${current.sessionMax}` : ""}${sessionElapsed ? ` · ${sessionElapsed}` : ""}`);
    lines.push(`${paint("PHASE", "faint", plain)}    ${current.phase}`);
  }
  if (ui.reviewPause) {
    lines.push("", paint("HUMAN REVIEW GATE", "amber", plain), paint("a Accept and continue · b Revise with checkpoint feedback · i Interrupt and restart · s Stop queue", "ink", plain));
  }
  if (tasks.length) {
    lines.push("", paint("QUEUE PROGRESS", "faint", plain));
    for (const entry of tasks) {
      const style = RUN_STATE_STYLE[entry.state] || RUN_STATE_STYLE.queued;
      const bits = [entry.state === "gate" ? `at gate · ${entry.status || "gate"}` : style.icon === "○" ? "queued" : entry.state];
      if (entry.provider) bits.push(`${entry.role || "?"}/${entry.provider}`);
      if (entry.state === "running" && entry.session) bits.push(`session ${entry.session}${entry.sessionMax ? `/${entry.sessionMax}` : ""}`);
      if (entry.state === "running" && entry.startedAt) bits.push(elapsedOf(now - entry.startedAt));
      if (entry.exit != null && entry.state !== "running") bits.push(`exit ${entry.exit}`);
      if (entry.reason) bits.push(truncate(entry.reason, Math.max(12, inner - 34)));
      const active = entry.state === "running" ? paint("▸ ", "coral", plain) : "  ";
      lines.push(`${active}${paint(style.icon, style.color, plain)} ${paint(entry.taskId, "ink", plain)}  ${paint(bits.join(" · "), style.color, plain)}`);
    }
  }
  const timeline = (ui.runLines || []).slice(-6);
  if (timeline.length) {
    lines.push("", paint("STRUCTURED TIMELINE", "faint", plain));
    for (const event of timeline) {
      const text = String(event);
      const color = /failed|error|blocked|timeout/i.test(text) ? "coral"
        : /BRIEF|finished|done|success|evidence/i.test(text) ? "mint"
          : /feedback|interrupt|paused|warning/i.test(text) ? "amber" : "ink";
      lines.push(paint(text, color, plain));
    }
  }
  const tail = ui.runLogLines?.length ? ui.runLogLines : (ui.runLogTail || []);
  if (ui.runLogName) {
    const rawMode = ui.runLogMode === "raw";
    lines.push("", paint(`${rawMode ? "RAW TRANSCRIPT" : "SESSION LOG"} · ${ui.runLogName}${ui.running ? (tail.length ? "" : " (waiting for output)") : " (final)"}`, "faint", plain));
    if (tail.length) {
      const fixed = lines.length + 2;
      const tailRoom = Math.max(1, Math.min(tail.length, height - 7 - fixed));
      const maxScroll = Math.max(0, tail.length - tailRoom);
      const scroll = Math.min(Math.max(0, Number(ui.runLogScroll) || 0), maxScroll);
      const start = Math.max(0, tail.length - tailRoom - scroll);
      for (const line of tail.slice(start, start + tailRoom)) lines.push(...wrap(line, inner).map((part) => paint(part, rawMode ? "ink" : "muted", plain)));
      lines.push(paint(`${start + 1}-${Math.min(tail.length, start + tailRoom)} / ${tail.length} lines`, "faint", plain));
    } else {
      lines.push(paint("  (no provider output recorded yet)", "muted", plain));
    }
  }
  lines.push("", paint(ui.running ? "L logs · v raw/structured · ↑↓/wheel transcript · Shift+R reopen · Esc back — run continues" : "r refresh · v raw/structured · ↑↓/wheel transcript · L logs · Esc back", "muted", plain));
  return panel("RUN QUEUE", lines, width, height, { accent: ui.running ? "amber" : "mint", plain }).join("\n");
}

export function renderProvidersScreen(snapshot, ui, width, height, plain) {
  const inner = Math.max(16, width - 4);
  const flow = ui.providerFlow || null;
  const lines = [];

  if (flow) {
    // Add-provider wizard: template → name → worker → base URL → key → model.
    if (flow.step === "template") {
      lines.push(paint("Add a provider — start from a template:", "violet", plain), "");
      lines.push(...composeOptionRows(
        PROVIDER_TEMPLATES.map((t) => ({
          key: t.id[0],
          label: `${t.id} — ${t.label}`,
          note: `claude → ${t.baseUrl.claude || "you supply the endpoint"}`,
        })),
        flow.templateIndex, width, plain,
      ));
      lines.push("", paint("↑↓ / j k move · Enter choose · Esc cancel", "muted", plain));
    } else if (flow.step === "worker") {
      lines.push(`${paint("PROVIDER", "faint", plain)}  ${paint(flow.fields.id || "-", "coral", plain)}`, "");
      lines.push(paint("Which CLI should run it?", "violet", plain), "");
      lines.push(...composeOptionRows(PROVIDER_WORKER_OPTIONS, flow.workerIndex, width, plain));
      lines.push("", paint("↑↓ / j k move · Enter choose · Esc back", "muted", plain));
    } else if (flow.step === "confirm") {
      const f = flow.fields;
      lines.push(paint("Save this provider?", "violet", plain), "");
      lines.push(`  ${paint("name", "faint", plain)}  ${paint(f.id || "-", "ink", plain)}`);
      lines.push(`  ${paint("runs on", "faint", plain)}  ${f.worker || "-"}`);
      lines.push(`  ${paint("base", "faint", plain)}   ${truncate(f.base_url || "-", inner - 8)}`);
      lines.push(`  ${paint("key", "faint", plain)}   ${paint(maskKey(f.api_key), "mint", plain)} ${paint("→ ~/.atl/providers.json (outside every repo)", "faint", plain)}`);
      lines.push(`  ${paint("model", "faint", plain)}  ${f.model || "-"}`);
      lines.push("", paint("Enter save · u save + make it this project's default · Esc cancel", "mint", plain));
    } else {
      const value = flow.step === "key" ? maskKey(flow.fields.api_key || "") : (flow.fields[flow.step === "name" ? "id" : flow.step === "base" ? "base_url" : "model"] || "");
      lines.push(paint(`Add a provider — ${flow.step}`, "violet", plain));
      lines.push(`  ${paint(value || "(press Enter to fill in)", "muted", plain)}`, "");
      lines.push(paint("Enter edit · Esc cancel", "muted", plain));
    }
  } else {
    const entries = Object.values(snapshot.userProviders || {});
    const projectDefault = snapshot.providerProfile.use || null;
    lines.push(paint("Your providers — stored once per machine in ~/.atl/providers.json; keys never enter a repo.", "muted", plain), "");
    if (!entries.length) {
      lines.push(paint("No providers yet. Press a to add one — template, paste key, model, done.", "amber", plain));
      lines.push(paint("Example: Z.ai GLM → claude worker → paste key → glm-4.6. Launches then run on GLM.", "faint", plain));
    }
    entries.forEach((entry, index) => {
      const mark = index === (ui.providerSelected || 0) ? paint("▸", "coral", plain) : " ";
      const isDefault = projectDefault === entry.id;
      lines.push(`${mark} ${paint(entry.id.padEnd(12), "ink", plain)} ${paint(`${entry.worker} · ${entry.model || "no model"} · ${maskKey(entry.api_key)}`, isDefault ? "mint" : "violet", plain)}${isDefault ? paint("  ● project default", "mint", plain) : ""}`);
      lines.push(`    ${paint(truncate(entry.base_url || "(no base URL)", Math.max(10, inner - 4)), "faint", plain)}`);
    });
    lines.push("", paint("Built-in workers (subscription auth — no key stored):", "muted", plain));
    for (const [builtinIndex, name] of ["codex", "claude"].entries()) {
      const spec = providerSpec(snapshot.providerProfile, name);
      const disc = discoverProvider(name, { command: spec.command });
      const index = entries.length + builtinIndex;
      const mark = index === (ui.providerSelected || 0) ? paint("▸", "coral", plain) : " ";
      const model = spec.model || "CLI default";
      lines.push(`${mark} ${disc.available ? paint("✓", "mint", plain) : paint("×", "coral", plain)} ${paint(name.padEnd(12), "ink", plain)} ${paint(model, "violet", plain)} ${paint(truncate(`· ${disc.available ? disc.path : disc.error}`, Math.max(10, inner - 34)), disc.available ? "muted" : "coral", plain)}`);
    }
    lines.push("", paint("Per-role mapping (config/manager.json → providers):", "muted", plain));
    for (const role of ["pip", "mira", "rowan", "sage", "beacon"]) {
      const p = providerForRole(snapshot.providerProfile, role);
      lines.push(`  ${paint(role.padEnd(7), "ink", plain)} ${paint(`${p.worker} · ${p.model || "provider default"}`, "violet", plain)} ${paint(`· auth ${p.auth} · (${p.source})`, "faint", plain)}`);
    }
    lines.push("", paint("a add provider · u use highlighted · m change its model · d delete custom provider · r re-check · Esc back", "muted", plain));
  }
  return panel("PROVIDERS", lines, width, height, { accent: "violet", plain }).join("\n");
}

function renderSessionsScreen(ui, width, height, plain) {
  const sessions = ui.sessions || [];
  const inner = Math.max(16, width - 4);
  const lines = [paint("Provider session logs (.trust/manager/overnight/<task>/):", "muted", plain), ""];
  if (!sessions.length) {
    lines.push(paint("No session logs yet. A confirmed launch writes them.", "muted", plain));
  } else {
    sessions.forEach((s, index) => {
      const mark = index === (ui.sessionsSelected || 0) ? paint("▸", "coral", plain) : " ";
      const brief = s.summary ? ` · ${s.summary.statusBefore || "?"} → ${s.summary.statusAfter || "?"} · exit ${s.summary.exitCode}` : " · running";
      lines.push(`${mark} ${paint(s.taskId, "ink", plain)} ${paint(s.name, "violet", plain)}  ${paint(`${Math.max(1, Math.round(s.size / 1024))}KB · ${ageOf(s.mtime)}${brief}`, s.summary ? "mint" : "amber", plain)}`);
    });
    lines.push("", paint("Enter open log at the latest output · Esc back", "muted", plain));
  }
  return panel("SESSIONS", lines.slice(0, Math.max(4, height - 2)), width, height, { accent: "mint", plain }).join("\n");
}

export function renderLogsScreen(snapshot, ui, width, height, plain) {
  const inner = Math.max(20, width - 4);
  const visible = Math.max(4, height - 8);
  const TIME_W = 8;
  const WHO_W = 13;
  const rows = [];
  for (const entry of mergedLogEntries(snapshot)) {
    const label = entry.kind === "state" ? `⚙ ${entry.who}` : `${AVATARS[entry.who] || "·"} ${NAMES[entry.who] || entry.who}`;
    const who = paint(fit(label, WHO_W), entry.kind === "state" ? "violet" : "ink", plain);
    const text = [entry.task, entry.text].filter(Boolean).join(" · ");
    rows.push(`${paint(timeOfSec(entry.at).padStart(TIME_W), "faint", plain)} ${who}  ${paint(truncate(text, inner - TIME_W - WHO_W - 4), entry.kind === "state" ? "muted" : "ink", plain)}`);
  }
  const follow = ui.logsFollow !== false;
  const maxOffset = Math.max(0, rows.length - visible);
  const offset = follow ? 0 : Math.min(Math.max(0, Number(ui.logsScroll) || 0), maxOffset);
  const start = Math.max(0, rows.length - visible - offset);
  const page = rows.slice(start, start + visible);
  const lines = [
    paint("Everything the room did — ⚙ state decisions and team narration — oldest first.", "muted", plain),
    "",
    ...(page.length ? page : [paint("No events yet.", "muted", plain)]),
    "",
    paint(`LOGS · ${follow ? "FOLLOWING latest" : `history −${offset}`} · ${rows.length} entries · ↑↓ scroll · End follow · F follow on/off · r refresh · Esc back`, "faint", plain),
  ];
  return panel("LOGS", lines, width, height, { accent: "violet", plain }).join("\n");
}

export async function runDashboard(root, { once = false, plain = false } = {}) {
  let snapshot;
  try {
    snapshot = createDashboardSnapshot(root);
  } catch (error) {
    if (once || !process.stdin.isTTY || !process.stdout.isTTY) throw error;
    console.error(`dashboard error: ${error.message}`);
    return;
  }
  if (once || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(renderDashboard(snapshot, {
      width: process.stdout.columns || 120,
      height: process.stdout.rows || 34,
      plain: !process.stdin.isTTY || !process.stdout.isTTY || plain,
      selected: 0,
      interactive: false,
    }));
    return;
  }

  return new Promise((resolve) => {
    const ui = {
      snapshot,
      selected: 0,
      screen: "dashboard",
      loading: true,
      spinner: 0,
      view: null,
      feedScroll: 0,
      // Start on the route map so the first Tab/Enter interaction is
      // discoverable and matches the visible control-plane navigation.
      panelFocus: "nav",
      navSelected: 0,
      taskScroll: 0,
      portfolioScroll: 0,
      error: null,
      notice: null,
      editor: null,
      command: null,
      commandHistory: [],
      reviewTaskId: null,
      reviewDigit: null,
      tasksFilter: "All",
      tasksQuery: "",
      tasksSelected: 0,
      importState: null,
      launchPlan: null,
       launchBudget: { maxMinutes: 120, maxSessions: 8 },
       pauseAfterBot: false,
      queueSelected: 0,
      queuePageSelected: 0,
      providerSelected: 0,
      providerFlow: null,
      sessions: null,
      sessionsSelected: 0,
      composeFlow: null,
      running: false,
      runLines: [],
      runCurrent: null,
      runTasks: [],
      runStartedAt: null,
      runEndedAt: null,
       runLogPath: null,
       runLogName: null,
       runLogTail: [],
       runLogLines: [],
       runLogScroll: 0,
       runLogMode: "structured",
       runSessionSummary: null,
       reviewPause: false,
       reviewResolve: null,
      lastSyncAt: Date.now(),
      logsFollow: true,
      logsScroll: 0,
      screenStack: [],
       // Interactive mode is the default. Shift+M hands capture back to the
       // terminal so native selection/copy remains available on demand.
       mouseMode: true,
    };
    let closed = false;
    let ignoreMouseProtocolKey = false;
    let mouseProtocolBuffer = "";

    const flash = (text) => { ui.notice = text; };

    // Navigation with a back stack: every screen entered through gotoScreen
    // remembers where it came from, and Esc pops back one level. goHome is
    // for deliberate jumps to the dashboard — it clears the stack so a later
    // Esc can never land on a stale half-finished flow.
    const gotoScreen = (screen, prepare = null) => {
      if (ui.screen !== screen) {
        ui.screenStack.push(ui.screen);
        if (ui.screenStack.length > 16) ui.screenStack.shift();
      }
      if (prepare) prepare();
      ui.screen = screen;
    };
    const goBack = () => {
      ui.screen = ui.screenStack.pop() || "dashboard";
    };
    const goHome = () => {
      ui.screenStack.length = 0;
      ui.screen = "dashboard";
    };

    const openCommandConsole = (initial = "") => {
      ui.command = { input: initial, output: [], outputScroll: 0, historyIndex: -1 };
      gotoScreen("command");
    };

    const submitCommand = () => {
      const input = String(ui.command?.input || "").trim();
      if (!input) return;
      ui.commandHistory = [...ui.commandHistory.filter((item) => item !== input), input].slice(-50);
      ui.command.historyIndex = -1;
      const selectedTaskId = ui.snapshot.tasks[ui.selected]?.id || null;
      const outcome = dispatchTuiCommand(root, input, { selectedTaskId });
      ui.command.output = outcome.lines || [];
      ui.command.outputScroll = 0;
      ui.command.input = "";
      if (outcome.refresh) refreshSnapshot();
      if (outcome.selectedTaskId) {
        const index = ui.snapshot.tasks.findIndex((task) => task.id === outcome.selectedTaskId);
        if (index >= 0) ui.selected = index;
      }
      if (outcome.launchPlan) ui.launchPlan = outcome.launchPlan;
      if (outcome.effect === "launch-preview") gotoScreen("launch");
      if (outcome.ok) flash("Command completed in the ATL runtime.");
      else ui.error = "Command was not applied.";
    };

    const handleCommandKey = (_input, key = {}) => {
      const command = ui.command || (ui.command = { input: "", output: [], outputScroll: 0, historyIndex: -1 });
      const name = key.name || _input;
      if (name === "escape") {
        goBack();
        return;
      }
      const outputLength = command.output.reduce((total, line) => total + wrap(String(line), Math.max(20, (process.stdout.columns || 120) - 8)).length, 0);
      if (name === "pageup") { command.outputScroll = Math.min(outputLength, command.outputScroll + 10); return; }
      if (name === "pagedown") { command.outputScroll = Math.max(0, command.outputScroll - 10); return; }
      if (name === "home" && !command.input) { command.outputScroll = outputLength; return; }
      if (name === "end" && !command.input) { command.outputScroll = 0; return; }
      if (name === "return") { submitCommand(); return; }
      if (name === "up" || name === "down") {
        if (!command.input && ui.commandHistory.length) {
          const delta = name === "up" ? 1 : -1;
          command.historyIndex = Math.min(Math.max(-1, command.historyIndex + delta), ui.commandHistory.length - 1);
          command.input = command.historyIndex < 0 ? "" : ui.commandHistory[ui.commandHistory.length - 1 - command.historyIndex];
        } else {
          command.outputScroll = Math.min(Math.max(0, outputLength), Math.max(0, command.outputScroll + (name === "up" ? 1 : -1)));
        }
        return;
      }
      if (name === "backspace") { command.input = command.input.slice(0, -1); return; }
      if (key.ctrl && name === "u") { command.input = ""; return; }
      if (name === "tab") {
        const word = command.input.trim().split(/\s+/)[0] || "";
        const matches = TUI_COMMANDS.filter((item) => item.name.startsWith(word.toLowerCase()));
        if (matches.length === 1 && !command.input.includes(" ")) command.input = `${matches[0].name} `;
        else if (matches.length) command.output = matches.map((item) => `${item.usage} · ${item.summary}`);
        return;
      }
      const insert = typeof _input === "string" ? _input : key.sequence;
      if (typeof insert === "string" && insert && !insert.startsWith("\x1b")) {
        command.input += insert.replace(/[\r\n]/g, "");
      }
    };

    const refreshSnapshot = () => {
      try {
        ui.snapshot = createDashboardSnapshot(root);
        const before = ui.selected;
        ui.selected = Math.min(ui.selected, Math.max(0, ui.snapshot.tasks.length - 1));
        if (ui.selected !== before) ui.taskScroll = 0;
        ui.portfolioScroll = Math.max(0, Math.min(ui.portfolioScroll, Math.max(0, ui.snapshot.tasks.length - 1)));
        ui.lastSyncAt = Date.now();
      } catch (error) {
        ui.error = error.message;
      }
    };

    // Every control-room mutation goes through the same runner functions the
    // CLI uses (state.json authoritative, honest actor, logged, narrated).
    const mutateTask = (taskId, fn, { event = "control-room", detail = "", actor = "manager" } = {}) => {
      const state = loadState(root);
      const task = state.tasks[taskId];
      if (!task) return null;
      fn(task);
      task.updated_at = new Date().toISOString();
      logEvent(state, { task: taskId, actor, event, detail });
      saveState(root, state);
      refreshSnapshot();
      return ui.snapshot.tasks.find((t) => t.id === taskId);
    };

    const openLaunchPlan = () => {
      try {
        ui.launchPlan = buildLaunchPlan(root, {
          taskIds: queueIds(root),
          maxMinutes: ui.launchBudget?.maxMinutes ?? 120,
          maxSessions: ui.launchBudget?.maxSessions ?? 5,
        });
      } catch (error) {
        ui.launchPlan = null;
        ui.error = error.message;
      }
    };

    // Launch budget controls: the queue shares ONE budget across all tasks,
    // so a 4-task run at the default 5 sessions starves. +/− moves sessions,
    // [ ] moves minutes; the plan and confirm command rebuild each change.
    const adjustLaunchBudget = (deltaSessions, deltaMinutes) => {
      const budget = ui.launchBudget || { maxMinutes: 120, maxSessions: 8 };
      budget.maxSessions = Math.min(20, Math.max(1, budget.maxSessions + deltaSessions));
      budget.maxMinutes = Math.min(1440, Math.max(15, budget.maxMinutes + deltaMinutes));
      ui.launchBudget = budget;
      openLaunchPlan();
    };

    const runQueuedLaunch = async () => {
      if (ui.running) return;
      if (!ui.launchPlan) openLaunchPlan();
      if (!ui.launchPlan?.items?.length) {
        flash("The queue is empty — select a task with x first.");
        draw();
        return;
      }
      ui.running = true;
      ui.runLines = [`Starting ${ui.launchPlan.items.length} queued task(s)…`];
      ui.runCurrent = null;
      ui.runTasks = ui.launchPlan.items.map((item) => ({
        taskId: item.taskId,
        role: item.role || null,
        provider: item.provider ? `${item.provider.worker}/${item.provider.auth}` : null,
        state: "queued",
        status: null,
        session: 0,
        sessionMax: null,
        startedAt: null,
        exit: null,
        reason: null,
      }));
      ui.runStartedAt = Date.now();
      ui.runEndedAt = null;
      try {
        const runDir = path.join(root, ".trust", "manager", "overnight");
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ startedAt: new Date(ui.runStartedAt).toISOString(), pauseAfterBot: ui.pauseAfterBot, budget: ui.launchBudget }, null, 2) + "\n");
      } catch { /* telemetry must not prevent a confirmed run */ }
       ui.runLogPath = null;
       ui.runLogName = null;
       ui.runLogTail = [];
       ui.runLogLines = [];
       ui.runLogScroll = 0;
       ui.runSessionSummary = null;
       ui.reviewPause = false;
       ui.reviewResolve = null;
      ui.error = null;
      ui.notice = null;
      gotoScreen("run");
      draw();
      const runEntry = (taskId) => ui.runTasks.find((t) => t.taskId === taskId);
      try {
        const result = await executeLaunchQueue(root, {
          confirm: true,
          maxMinutes: ui.launchBudget?.maxMinutes ?? 120,
          maxSessions: ui.launchBudget?.maxSessions ?? 5,
          onSession: (summary) => {
            ui.runSessionSummary = summary;
            ui.runLines.push(`BRIEF · ${summary.taskId} ${summary.role} · exit ${summary.exitCode} · ${summary.statusBefore} → ${summary.statusAfter}`);
            draw();
          },
          pauseAfterSession: ui.pauseAfterBot,
          onReview: (summary) => new Promise((resolve) => {
            ui.runSessionSummary = summary;
            ui.reviewPause = true;
            ui.reviewResolve = (decision) => {
              ui.reviewPause = false;
              ui.reviewResolve = null;
              resolve(decision);
            };
            draw();
          }),
          onProgress: (line) => {
            const text = String(line);
            ui.runLines.push(text);
            const session = text.match(/^\[(T-\d+)\] session (\d+)\/(\d+) · ([^·]+) · ([^·]+) · (.+)$/);
            if (session) {
              ui.runCurrent = { taskId: session[1], role: session[4].trim(), provider: session[5].trim(), model: session[6].trim(), session: Number(session[2]), sessionMax: Number(session[3]), startedAt: Date.now(), phase: "agent session started" };
              const entry = runEntry(session[1]);
              if (entry) {
                entry.state = "running";
                entry.role = session[4].trim();
                entry.provider = session[5].trim();
                entry.session = Number(session[2]);
                entry.sessionMax = Number(session[3]);
                entry.startedAt = Date.now();
                entry.reason = null;
                entry.exit = null;
              }
            }
            else if (/session finished/.test(text) && ui.runCurrent) {
              ui.runCurrent.phase = "session finished — reading the next gate";
              const fin = text.match(/^\[(T-\d+)\] \S+ session finished · exit (\d+)( · timed out)?$/);
              if (fin) {
                const entry = runEntry(fin[1]);
                if (entry) {
                  entry.exit = Number(fin[2]);
                  if (fin[3]) entry.reason = "worker timed out";
                }
              }
            }
            else if (/workspace:/.test(text) && ui.runCurrent) ui.runCurrent.phase = "working in isolated workspace";
            else if (/^\s*transcript:\s*(.+)$/.test(text) && ui.runCurrent) {
              ui.runCurrent.phase = "recording transcript";
              ui.runLogPath = text.match(/^\s*transcript:\s*(.+)$/)[1].trim();
              ui.runLogName = path.basename(ui.runLogPath);
              ui.runLogLines = readLogLines(ui.runLogPath);
              ui.runLogTail = ui.runLogLines.slice(-6);
            }
            else if (/preview only/.test(text) && ui.runCurrent) ui.runCurrent.phase = "preview only — no agent started";
            draw();
          },
        });
        ui.runLines.push(`Queue run complete after ${result.budget.sessions} session(s).`);
        for (const item of result.results || []) {
          ui.runLines.push(`${item.id}: ${item.status} — ${item.reason}`);
          const entry = runEntry(item.id);
          if (entry) {
            entry.status = item.status;
            entry.reason = item.reason;
            entry.state = item.status === "done" ? "done"
              : item.status === "blocked" ? "blocked"
              : item.status === "queued" ? "skipped"
              : item.status === "unknown" ? "failed"
              : "gate";
          }
        }
        ui.runEndedAt = Date.now();
        ui.runLogLines = readLogLines(ui.runLogPath);
        ui.runLogTail = ui.runLogLines.slice(-6);
        refreshSnapshot();
        openLaunchPlan();
      } catch (error) {
        ui.error = error.message;
        ui.runLines.push(`Run failed: ${error.message}`);
        ui.runEndedAt = Date.now();
      } finally {
        ui.running = false;
        draw();
      }
    };

    const toggleQueue = (taskId) => {
      const queued = (ui.snapshot.queue || []).some((q) => q.id === taskId);
      if (queued) {
        queueRemove(root, taskId);
        feedPost(root, { from: "manager", text: `${taskId} out of the execution queue.`, task: taskId });
        flash(`${taskId} removed from the execution queue.`);
      } else {
        queueAdd(root, taskId, { by: "manager" });
        feedPost(root, { from: "manager", text: `${taskId} queued for execution — waiting for a launch preview.`, task: taskId });
        flash(`${taskId} queued for execution (l previews the launch).`);
      }
      refreshSnapshot();
    };

    const openRecoveryEditor = (task) => {
      if (task?.status !== "blocked") {
        ui.notice = task ? `${task.id} is ${task.status}; only blocked tasks need recovery.` : "Select a task first.";
        return;
      }
      ui.editor = newEditor({
        kind: "recovery",
        taskId: task.id,
        title: `Resolve blocker for ${task.id}`,
        hint: `Blocker: ${task.blocker?.reason || "No blocker reason recorded."} Write what changed or what approval/input is now available. This note is required before ATL reopens the task.`,
        multiline: true,
      });
    };

    const openCompose = () => {
      ui.composeFlow = { step: "intent", intentIndex: 0, audienceIndex: 0, text: "", preview: null };
      ui.editor = null;
      gotoScreen("compose");
    };

    const openResourceEditor = (task) => {
      if (!task) return;
      ui.editor = newEditor({
        kind: "resource",
        taskId: task.id,
        title: `Attach a resource to ${task.id}`,
        hint: "Paste a URL or local screenshot/file path. Optional format: Label | URL-or-path. Local files are copied into .trust/manager/attachments/.",
      });
    };

    const openFeedbackEditor = (taskId, mode = "checkpoint") => {
      if (!taskId) { ui.error = "No active task is selected for feedback."; return; }
      ui.editor = newEditor({
        kind: "feedback",
        taskId,
        title: `${mode === "interrupt" ? "Interrupt and revise" : "Queue feedback"} for ${taskId}`,
        hint: `${mode === "interrupt" ? "The current provider session will stop safely." : "The next applicable bot session will receive this."} Write the change or review instruction in plain language.`,
        multiline: true,
      });
      ui.editor.feedbackMode = mode;
    };

    const cancelCompose = () => {
      ui.editor = null;
      ui.composeFlow = null;
      goHome();
    };

    // ---------- providers page: registry list + add wizard (z.ai-style form)

    const openProviderWizard = () => {
      ui.providerFlow = { step: "template", templateIndex: 0, workerIndex: 0, fields: {} };
    };

    const openProviderEditor = (field, { title, hint, text = "", mask = false }) => {
      ui.editor = newEditor({ kind: "provider-field", field, title, hint, text, mask });
    };

    const providerWizardTextField = (flow) => {
      const f = flow.fields;
      const template = templateById(f.template);
      if (flow.step === "name") {
        openProviderEditor("name", {
          title: "Name this provider",
          hint: "Short lowercase id you will select by — zai, work-glm, bigmodel…",
          text: f.id || (template && template.id !== "custom" ? template.id : ""),
        });
      } else if (flow.step === "base") {
        openProviderEditor("base", {
          title: "API base URL",
          hint: "The endpoint the worker CLI calls. Prefilled from the template — edit only if your endpoint differs.",
          text: f.base_url || (template ? template.baseUrl[f.worker] || "" : ""),
        });
      } else if (flow.step === "key") {
        openProviderEditor("key", {
          title: "API key / token",
          hint: "Pasted once, stored in ~/.atl/providers.json outside every repo, masked everywhere, injected into worker sessions at spawn.",
          mask: true,
        });
      } else if (flow.step === "model") {
        openProviderEditor("model", {
          title: "Default model id",
          hint: "The exact id your provider serves — e.g. glm-4.6. Changeable later with atl provider set or here.",
          text: f.model || (template ? template.models[0] || "" : ""),
        });
      }
    };

    const submitProviderField = () => {
      const e = ui.editor;
      const flow = ui.providerFlow;
      const text = editorText(e).trim();
      ui.editor = null;
      if (!flow) return;
      if (e.field === "name") {
        if (!text) { ui.error = "A provider name is required."; return; }
        flow.fields.id = text.toLowerCase();
        flow.step = "worker";
      } else if (e.field === "base") {
        if (!/^https?:\/\//.test(text)) { ui.error = "The base URL must start with http:// or https://."; return; }
        flow.fields.base_url = text;
        flow.step = "key";
        providerWizardTextField(flow);
      } else if (e.field === "key") {
        if (!text) { ui.error = "The API key is required — paste it and press Enter."; return; }
        flow.fields.api_key = text;
        flow.step = "model";
        providerWizardTextField(flow);
      } else if (e.field === "model") {
        flow.fields.model = text;
        flow.step = "confirm";
      } else if (e.field === "project-model") {
        const target = e.providerId;
        if (!text) { ui.error = "A model id is required."; return; }
        if (e.builtin) {
          const cfg = configSafe(root);
          cfg.providers = cfg.providers || {};
          cfg.providers.use = target;
          cfg.providers.model = text;
          writeManagerConfig(root, cfg);
        } else {
          const registry = loadUserProviders();
          const provider = registry.providers?.[target];
          if (!provider) { ui.error = `Provider \"${target}\" no longer exists.`; return; }
          upsertProvider(registry, target, { ...provider, model: text });
          saveUserProviders(registry);
        }
        flash(`Model for \"${target}\" is now \"${text}\".`);
        refreshSnapshot();
      }
    };

    const setProjectProvider = (id) => {
      try {
        const cfg = configSafe(root);
        cfg.providers = cfg.providers || {};
        cfg.providers.use = id;
        writeManagerConfig(root, cfg);
        feedPost(root, { from: "manager", text: `project default provider → "${id}".` });
        flash(`"${id}" is now this project's default provider — l / launch / run will use it.`);
        refreshSnapshot();
      } catch (error) {
        ui.error = error.message;
      }
    };

    const saveProviderWizard = (alsoUse) => {
      const flow = ui.providerFlow;
      if (!flow) return;
      const f = flow.fields;
      try {
        if (!f.id || !f.base_url || !f.api_key) throw new Error("The form is incomplete — name, base URL, and API key are required.");
        const wireProblems = wireMismatches(f.worker || "claude", f.base_url);
        if (wireProblems.length) throw new Error(`This provider cannot work as configured — ${wireProblems.join("; ")}`);
        const registry = loadUserProviders();
        const template = templateById(f.template);
        upsertProvider(registry, f.id, {
          label: template && template.id !== "custom" ? template.label : f.id,
          worker: f.worker || "claude",
          base_url: f.base_url,
          api_key: f.api_key,
          model: f.model || "",
          models: template ? template.models : [],
        });
        saveUserProviders(registry);
        ui.providerFlow = null;
        if (alsoUse) setProjectProvider(f.id);
        else flash(`Provider "${f.id}" saved. Select it with u to make it this project's default.`);
        refreshSnapshot();
      } catch (error) {
        ui.error = error.message;
      }
    };

    const removeProviderById = (id) => {
      try {
        const registry = loadUserProviders();
        removeProvider(registry, id);
        saveUserProviders(registry);
        const cfg = configSafe(root);
        if (cfg.providers?.use === id) {
          delete cfg.providers.use;
          writeManagerConfig(root, cfg);
          flash(`Provider "${id}" deleted — it was this project's default, so the default is cleared.`);
        } else {
          flash(`Provider "${id}" deleted from ~/.atl/providers.json.`);
        }
        ui.providerSelected = 0;
        refreshSnapshot();
      } catch (error) {
        ui.error = error.message;
      }
    };

    const handleProvidersKey = (name) => {
      const flow = ui.providerFlow;
      if (flow) {
        if (name === "escape") {
          if (!ui.editor && ["name", "base", "key", "model"].includes(flow.step)) {
            flow.step = flow.step === "name" ? "template"
              : flow.step === "base" ? "worker"
              : flow.step === "key" ? "base" : "key";
          } else {
            ui.providerFlow = null;
          }
          return;
        }
        if (flow.step === "template") {
          if (name === "up" || name === "k") flow.templateIndex = Math.max(0, flow.templateIndex - 1);
          else if (name === "down" || name === "j") flow.templateIndex = Math.min(PROVIDER_TEMPLATES.length - 1, flow.templateIndex + 1);
          else if (name === "return") {
            const template = PROVIDER_TEMPLATES[flow.templateIndex] || PROVIDER_TEMPLATES[0];
            flow.fields.template = template.id;
            flow.fields.worker = template.worker;
            flow.step = "name";
            providerWizardTextField(flow);
          }
        } else if (flow.step === "worker") {
          if (name === "up" || name === "k") flow.workerIndex = Math.max(0, flow.workerIndex - 1);
          else if (name === "down" || name === "j") flow.workerIndex = Math.min(PROVIDER_WORKER_OPTIONS.length - 1, flow.workerIndex + 1);
          else if (name === "return") {
            flow.fields.worker = PROVIDER_WORKER_OPTIONS[flow.workerIndex]?.key === "x" ? "codex" : "claude";
            flow.step = "base";
            providerWizardTextField(flow);
          }
        } else if (flow.step === "confirm") {
          if (name === "return") saveProviderWizard(false);
          else if (name === "u") saveProviderWizard(true);
        } else if (name === "return") {
          providerWizardTextField(flow);
        }
        return;
      }
      const entries = Object.values(ui.snapshot.userProviders || {});
      const selectable = [...entries, ...["codex", "claude"].map((id) => ({ id, builtin: true }))];
      if (name === "escape") goBack();
      else if (name === "r") refresh();
      else if (name === "a") openProviderWizard();
      else if (name === "up" || name === "k") ui.providerSelected = Math.max(0, ui.providerSelected - 1);
      else if (name === "down" || name === "j") ui.providerSelected = Math.min(Math.max(0, selectable.length - 1), ui.providerSelected + 1);
      else if (name === "u" && selectable[ui.providerSelected || 0]) setProjectProvider(selectable[ui.providerSelected || 0].id);
      else if (name === "m" && selectable[ui.providerSelected || 0]) {
        const selected = selectable[ui.providerSelected || 0];
        const spec = providerSpec(ui.snapshot.providerProfile, selected.id);
        const known = selected.builtin ? providerModels(selected.id).map((model) => model.id) : (spec.models || []);
        openProviderEditor("project-model", {
          title: `Set model for ${selected.id}`,
          hint: known.length ? `Available locally: ${known.join(", ")}. Enter an exact model id.` : "Enter the exact model id exposed by this provider.",
          text: spec.model || "",
        });
        ui.editor.providerId = selected.id;
        ui.editor.builtin = Boolean(selected.builtin);
      }
      else if (name === "d" && entries[ui.providerSelected || 0]) removeProviderById(entries[ui.providerSelected || 0].id);
    };

    const buildComposePreview = (text) => {
      const candidate = normalizeDraftText(text, { source: "manual" });
      const probe = {
        ...candidate,
        objective: candidate.objective_hint,
        decision_log: [],
      };
      const route = applyDeterministicRoute(root, probe);
      return { ...candidate, route };
    };

    const submitCompose = () => {
      const text = editorText(ui.editor).trim();
      ui.editor = null;
      if (!text) return;
      try {
        ui.composeFlow.text = text;
        ui.composeFlow.preview = buildComposePreview(text);
        ui.composeFlow.step = "preview";
        ui.screen = "compose";
        draw();
      } catch (error) {
        ui.error = error.message;
      }
    };

    const commitCompose = () => {
      const flow = ui.composeFlow;
      if (!flow?.text) return;
      try {
        const state = loadState(root);
        const { task, created, draftPath } = composeTask(root, state, flow.text, { source: "manual", cfg: configSafe(root) });
        if (created) {
          task.composition = {
            intent: COMPOSE_INTENTS[flow.intentIndex]?.label || "unspecified",
            audience: COMPOSE_AUDIENCES[flow.audienceIndex]?.label || "unspecified",
          };
        }
        saveState(root, state);
        if (created) {
          feedPost(root, { from: "manager", text: `composed ${task.id} in the control room: "${task.title}".`, task: task.id });
          flash(`${task.id} composed — review the packet. Draft: ${path.relative(root, draftPath)}`);
        } else {
          flash(`${task.id} already exists — compose is idempotent by content.`);
        }
        ui.reviewTaskId = task.id;
        ui.composeFlow = null;
        goHome();
        ui.screen = "review";
        refreshSnapshot();
      } catch (error) {
        ui.error = error.message;
      }
    };

    const submitReviewEdit = () => {
      const e = ui.editor;
      const text = editorText(e).trim();
      ui.editor = null;
      if (!e.taskId) return;
      if (e.kind === "objective") {
        if (!text) return;
        mutateTask(e.taskId, (task) => { task.objective = text; }, { event: "update", detail: "objective set from the control room" });
        feedPost(root, { from: "manager", text: `objective set on ${e.taskId}: ${text}`, task: e.taskId });
      } else if (e.kind === "check") {
        if (!text) return;
        mutateTask(e.taskId, (task) => { if (!task.completion_checks.includes(text)) task.completion_checks.push(text); }, { event: "update", detail: `check added: ${text}` });
        feedPost(root, { from: "manager", text: `check added on ${e.taskId}: ${text}`, task: e.taskId });
      } else if (e.kind === "resource") {
        if (!text) return;
        const split = text.match(/^(.+?)\s*\|\s*(.+)$/s);
        const label = split ? split[1].trim() : "";
        const ref = split ? split[2].trim() : text;
        try {
          let added = null;
          mutateTask(e.taskId, (task) => {
            added = addResourceToTask(root, task, ref, { label, source: "manager" });
          }, { event: "resource", detail: `${label || "resource"}: ${ref}` });
          if (added?.added) {
            feedPost(root, { from: "manager", text: `resource attached to ${e.taskId}: ${added.resource.label}.`, task: e.taskId, detail: added.resource.ref });
            flash(`${e.taskId} resource attached: ${added.resource.label}.`);
          } else {
            ui.notice = `${e.taskId}: that resource is already attached.`;
          }
        } catch (error) {
          ui.error = error.message;
        }
      } else if (e.kind === "recovery") {
        if (!text) {
          ui.error = "Write the resolution or approval before reopening this task.";
          ui.editor = e;
          return;
        }
        try {
          const result = unblockTask(root, e.taskId, { note: text });
          feedPost(root, { from: "manager", text: `${e.taskId} unblocked → ${result.to}${result.worker ? ` and routed to ${result.worker}` : " — ready for assignment"}.`, task: e.taskId, detail: text });
          flash(result.to === "assigned"
            ? `${e.taskId} is assigned again. Press x to queue it, then l to run.`
            : `${e.taskId} is back in triage. Edit/assign a worker before queuing it.`);
          refreshSnapshot();
        } catch (error) {
          ui.error = error.message;
        }
      } else if (e.kind === "feedback") {
        if (!text) { ui.error = "Feedback cannot be empty."; ui.editor = e; return; }
        try {
          const item = submitFeedback(root, { taskId: e.taskId, prompt: text, mode: e.feedbackMode || "checkpoint" });
          feedPost(root, { from: "manager", text: `feedback queued for ${e.taskId} (${item.mode}).`, task: e.taskId, detail: item.id });
          if (item.mode === "interrupt" && ui.running) requestSessionInterrupt();
          if (ui.reviewPause && ui.reviewResolve) ui.reviewResolve("continue");
          flash(`${e.taskId} feedback saved — ${item.mode === "interrupt" ? "stopping the current session is requested" : "next session will receive it"}.`);
        } catch (error) {
          ui.error = error.message;
        }
      }
    };

    const submitFromEditor = () => {
      if (!ui.editor) return;
      if (ui.editor.kind === "compose") submitCompose();
      else if (ui.editor.kind === "provider-field") submitProviderField();
      else if (ui.editor.kind === "plan-intent") {
        const text = editorText(ui.editor).trim();
        ui.editor = null;
        if (text) {
          ui.planStudio = { ...(ui.planStudio || {}), intent: text, draft: ui.planStudio?.draft || null };
          ui.screen = "plan";
        }
      } else if (ui.editor.kind === "task-filter") {
        ui.tasksQuery = editorText(ui.editor).trim();
        ui.tasksSelected = 0;
        ui.editor = null;
        ui.screen = "tasks";
      } else if (ui.editor.kind === "task-edit") {
        const [title, ...rest] = editorText(ui.editor).split(/\r?\n/);
        if (!title.trim()) { ui.error = "Task title cannot be empty."; return; }
        const taskId = ui.editor.taskId;
        try {
          editTaskInWorkspace(root, taskId, { title: title.trim(), objective: rest.join("\n").trim() });
          feedPost(root, { from: "manager", text: `edited ${taskId} in the Tasks page.`, task: taskId });
          ui.editor = null;
          refreshSnapshot();
          ui.screen = "tasks";
          flash(`${taskId} saved.`);
        } catch (error) { ui.error = error.message; }
      } else if (ui.editor.kind === "queue-create" || ui.editor.kind === "queue-rename") {
        const value = editorText(ui.editor).trim();
        if (!value) { ui.error = "Queue name cannot be empty."; return; }
        try {
          if (ui.editor.kind === "queue-create") {
            const id = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || `queue-${Date.now()}`;
            queueCreate(root, id, { name: value });
            flash(`Queue ${value} created.`);
          } else {
            const queue = ui.snapshot.controlPlane?.queues?.items?.[ui.queuePageSelected];
            if (!queue) throw new Error("Select a queue before renaming it.");
            queueRename(root, queue.id, value);
            flash(`Queue ${queue.id} renamed.`);
          }
          ui.editor = null;
          refreshSnapshot();
          ui.screen = "queue";
        } catch (error) { ui.error = error.message; }
      } else submitReviewEdit();
    };

    const openImport = (sourceKey) => {
      const entry = IMPORT_SOURCES.find((s) => s.key === sourceKey);
      if (!entry) return;
      ui.importState = { loading: true, sourceLabel: entry.label, candidates: null, error: null, selected: 0 };
      draw();
      const cfg = configSafe(root);
      Promise.resolve().then(async () => {
        if (sourceKey === "f") {
          return intakeFromFiles({ inbox_dir: path.resolve(root, cfg.inbox_dir || ".trust/manager/inbox") });
        }
        const sourceCfg = (cfg.intake || {})[sourceKey === "g" ? "github" : "azure"];
        if (!sourceCfg || sourceCfg.enabled === false || !sourceCfg.enabled) {
          throw new Error(`${entry.label} intake is disabled — enable it with: atl intake enable ${sourceKey === "g" ? "github --repo owner/name" : "azure"}${sourceKey === "a" ? " (after putting the PAT in the environment)" : ""}`);
        }
        return sourceKey === "g" ? intakeFromGitHub(sourceCfg) : intakeFromAzure(sourceCfg);
      }).then((candidates) => {
        ui.importState = { loading: false, sourceLabel: entry.label, candidates, error: null, selected: 0 };
        draw();
      }).catch((error) => {
        ui.importState = { loading: false, sourceLabel: entry.label, candidates: null, error: error.message, selected: 0 };
        draw();
      });
    };

    const importOne = (cand) => {
      try {
        const state = loadState(root);
        const { created } = importCandidates(root, state, [cand], { cfg: configSafe(root) });
        saveState(root, state);
        if (created.length) {
          flash(`${created[0].task.id} imported from ${ui.importState.sourceLabel}.`);
          refreshSnapshot();
        } else {
          flash("Already imported (dedup by source key) — nothing added.");
        }
      } catch (error) {
        ui.error = error.message;
      }
    };

    const openSessions = () => {
      ui.sessions = scanSessions(root);
      ui.sessionsSelected = 0;
      gotoScreen("sessions");
    };

    const openLogs = () => {
      ui.logsFollow = true;
      ui.logsScroll = 0;
      gotoScreen("logs");
    };

    const openPlanStudio = () => {
      ui.planStudio = ui.planStudio || { intent: "", draft: null };
      gotoScreen("plan");
    };

    const openPlanIntentEditor = () => {
      ui.planStudio = ui.planStudio || { intent: "", draft: null };
      ui.editor = newEditor({
        kind: "plan-intent",
        title: "Plan Studio intent",
        hint: "Describe the outcome. ATL will frame it first; provider planning remains an explicit confirmed action.",
        text: ui.planStudio.intent || "",
        multiline: true,
      });
    };

    const openTaskEditEditor = (task) => {
      if (!task) return;
      ui.editor = newEditor({
        kind: "task-edit",
        taskId: task.id,
        title: `Edit ${task.id}`,
        hint: "First line is the title. Following lines are the objective. Ctrl+S saves through task-workspace.",
        text: `${task.title || ""}\n${task.objective || ""}`,
        multiline: true,
      });
    };

    const openTaskFilterEditor = () => {
      ui.editor = newEditor({
        kind: "task-filter",
        title: "Filter tasks",
        hint: "Type a task id, title, objective, worker, priority, or leave empty to show all.",
        text: ui.tasksQuery || "",
      });
    };

    const openQueueEditor = (kind, queue = null) => {
      ui.editor = newEditor({
        kind,
        title: kind === "queue-create" ? "Create queue" : `Rename ${queue?.id || "queue"}`,
        hint: "Use a short stable name. Queue changes are persisted through the named-queue domain module.",
        text: kind === "queue-rename" ? (queue?.name || queue?.id || "") : "",
      });
    };

    const saveDeterministicPlan = () => {
      const intent = String(ui.planStudio?.intent || "").trim();
      if (!intent) { ui.error = "Plan Studio needs an intent first. Press c."; return; }
      try {
        const artifact = frameIntent(intent, { skills: ["atl-frame", "atl-specify", "atl-plan", "atl-verify"] });
        ui.planStudio.draft = savePlanDraft(root, { intent, artifact, stage: "frame" });
        flash("Deterministic frame saved. Provider planning is still an explicit next step.");
      } catch (error) { ui.error = error.message; }
    };

    const openRoute = (route) => {
      if (route === "dashboard") return goHome();
      if (route === "tasks") return gotoScreen("tasks", () => { ui.tasksFilter = "All"; ui.tasksQuery = ""; });
      if (route === "queue") return gotoScreen("queue", () => { ui.queuePageSelected = ui.queuePageSelected || 0; });
      if (route === "plan") return openPlanStudio();
      if (route === "team") return gotoScreen("team");
      if (route === "activity") return openLogs();
      if (route === "usage") return gotoScreen("usage");
      if (route === "settings") return gotoScreen("settings");
    };

    // The frame currently on screen; null forces the next paint (resize).
    let lastFrameWritten = null;
    const onResize = () => {
      lastFrameWritten = null;
      draw();
    };

    const applyMouseMode = () => {
      // 1000/1006 = SGR wheel reporting. Enabled only while ui.mouseMode is
      // on; close() always releases the capture.
      process.stdout.write(ui.mouseMode ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1000l\x1b[?1006l");
    };

    const toggleMouseMode = () => {
      ui.mouseMode = !ui.mouseMode;
      applyMouseMode();
      flash(ui.mouseMode
        ? "Mouse capture ON — wheel pans the panes; hold Shift while dragging to select text."
        : "Mouse capture OFF — drag to select and copy text freely (Shift+M brings wheel panning back).");
      draw();
    };

    const drawNow = () => {
      if (closed) return;
      const width = Math.max(60, process.stdout.columns || 120);
      const height = Math.max(14, process.stdout.rows || 34);
      const pageRoute = controlPlaneRouteForScreen(ui.screen);
      const pageDims = pageRoute && ui.screen !== "dashboard" && !ui.editor ? controlPlaneDimensions(width, height) : null;
      const pageWidth = pageDims?.contentWidth || width;
      const pageHeight = pageDims?.contentHeight || height;
      let output;
      if (ui.editor) output = renderEditorScreen(ui, width, height, plain);
      else if (ui.screen === "command") output = renderCommandScreen(ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "compose") output = renderComposeScreen(ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "tasks") output = renderTasksScreen(ui.snapshot, ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "import") output = renderImportScreen(ui, width, height, plain);
      else if (ui.screen === "review") output = renderReviewScreen(ui.snapshot, ui, width, height, plain);
      else if (ui.screen === "queue") output = renderQueuesScreen(ui.snapshot, ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "launch") output = renderLaunchPreviewScreen(ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "run") output = renderRunScreen(ui, width, height, plain);
      else if (ui.screen === "providers") output = renderProvidersScreen(ui.snapshot, ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "sessions") output = renderSessionsScreen(ui, width, height, plain);
      else if (ui.screen === "logs") output = renderLogsScreen(ui.snapshot, ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "team") output = renderTeamScreen(ui.snapshot, ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "notifications") output = renderNotificationsScreen(ui.snapshot, pageWidth, pageHeight, plain);
      else if (ui.screen === "usage") output = renderUsageScreen(ui.snapshot, ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "plan") output = renderPlanStudioScreen(root, ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "settings") output = renderSettingsScreen(root, ui, pageWidth, pageHeight, plain);
      else if (ui.screen === "file") output = renderFileView(ui.view, width, height, plain);
      else if (ui.screen === "feed") output = renderFeedView(ui.snapshot, width, height, ui.feedScroll, plain);
      else if (ui.screen === "help") output = renderHelp(width, height, plain);
      else output = renderDashboard(ui.snapshot, { width, height, plain, loading: ui.loading, spinner: ui.spinner, selected: ui.selected, feedScroll: ui.feedScroll, panelFocus: ui.panelFocus, navSelected: ui.navSelected, taskScroll: ui.taskScroll, portfolioScroll: ui.portfolioScroll, syncedAt: ui.lastSyncAt });
      if (!ui.editor && pageRoute && ui.screen !== "dashboard") {
        output = renderControlPlaneShell(ui.snapshot, { route: pageRoute, body: output, width, height, plain, interactive: true, syncedAt: ui.lastSyncAt, loading: ui.loading, spinner: ui.spinner });
      }
      const status = ui.error
        ? paint(`Error: ${ui.error}`, "coral", plain)
        : ui.notice
          ? paint(ui.notice, "mint", plain)
          : null;
      const frame = output.split("\n");
      if (status) {
        if (frame.length < height) frame.push(status);
        else frame[height - 1] = fit(status, width);
      }
      const stableFrame = frame.slice(0, height);
      // Clear in-place and never write more rows than the terminal owns. The
      // previous implementation appended notices and repainted on a timer;
      // both behaviors made PowerShell scroll a second dashboard into view.
      const nextFrame = stableFrame.join("\n");
      // Repainting wipes whatever text the user is selecting with the mouse,
      // so an identical frame is never rewritten: idle ticks and quiet runs
      // leave the screen — and any in-progress selection — untouched.
      if (nextFrame === lastFrameWritten) return;
      lastFrameWritten = nextFrame;
      readline.cursorTo(process.stdout, 0, 0);
      readline.clearScreenDown(process.stdout);
      process.stdout.write("\x1b[?25l" + nextFrame);
    };

    // A full-frame paint goes through ConPTY and costs real milliseconds, and
    // mouse-wheel panning arrives as bursts of events. Coalescing to one paint
    // per frame keeps scrolling smooth and collapses the double-draws in the
    // key handlers (moveScroll plus the trailing draw) into a single repaint.
    let drawTimer = null;
    const draw = () => {
      if (drawTimer || closed) return;
      drawTimer = setTimeout(() => {
        drawTimer = null;
        drawNow();
      }, 16);
      if (typeof drawTimer.unref === "function") drawTimer.unref();
    };

    const refresh = () => {
      if (closed) return;
      ui.loading = true;
      ui.error = null;
      try {
        ui.snapshot = createDashboardSnapshot(root);
        ui.selected = Math.min(ui.selected, Math.max(0, ui.snapshot.tasks.length - 1));
        ui.lastSyncAt = Date.now();
        flash("Refreshed from state.json and feed.jsonl.");
      } catch (error) {
        ui.error = error.message;
      } finally {
        ui.loading = false;
      }
    };

    // Auto-refresh: the control room is a projection of files other processes
    // write (workers, `atl overnight`, the runner), so it must poll. A cheap
    // signature keeps idle redraws flicker-free; a run gets a 1s cadence so
    // elapsed times and the session-log tail move. Editors are never touched.
    let tickCount = 0;
    let lastSignature = null;
    const signatureOf = (s) => JSON.stringify([
      s.updatedAt,
      s.tasks.map((t) => [t.id, t.status, t.assigned_worker, t.attempt_count, t.updated_at]),
      (s.queue || []).map((q) => q.id),
      s.feed.length ? [s.feed.length, s.feed[s.feed.length - 1].at] : 0,
      s.actions.map((a) => [a.task, a.what]),
    ]);
    const tick = () => {
      if (closed || ui.editor) return;
      tickCount += 1;
      if (ui.running) {
        refreshSnapshot();
         ui.runLogLines = readLogLines(ui.runLogPath);
         ui.runLogTail = ui.runLogLines.slice(-6);
        draw();
        return;
      }
      if (ui.screen === "run") return; // finished run screen is static until r
      if (tickCount % 2 !== 0) return; // ~2s cadence when idle
      const before = lastSignature;
      refreshSnapshot();
      if (ui.screen === "sessions") ui.sessions = scanSessions(root);
      if (ui.screen === "launch") openLaunchPlan();
      lastSignature = signatureOf(ui.snapshot);
      if (lastSignature !== before) draw();
    };
    const tickTimer = setInterval(tick, 1000);
    if (typeof tickTimer.unref === "function") tickTimer.unref();

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(tickTimer);
      process.stdin.removeListener("keypress", onKey);
      process.stdin.removeListener("data", markMouseProtocol);
      process.stdin.removeListener("data", onMouseData);
      process.stdout.removeListener("resize", onResize);
      process.removeListener("SIGINT", close);
      try { process.stdin.setRawMode(false); } catch { /* stdin may already be closed */ }
      process.stdin.pause();
      process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[0m\n");
      resolve();
    };

    const moveScroll = (delta) => {
      if (ui.screen === "file" && ui.view) {
        ui.view.scroll = Math.max(0, Math.min(Math.max(0, ui.view.lines.length - 1), ui.view.scroll + delta));
      } else if (ui.screen === "feed") {
        // Feed scroll is distance from the latest message. Up means older,
        // so its direction is the inverse of the file viewport's offset.
        ui.feedScroll = Math.max(0, ui.feedScroll - delta);
      }
      draw();
    };

    const terminalSize = () => ({
      width: Math.max(60, process.stdout.columns || 120),
      height: Math.max(14, process.stdout.rows || 34),
    });

    const portfolioWindow = () => {
      const { width, height } = terminalSize();
      const panelHeight = Math.max(7, dashboardRemainingRows(ui.snapshot, width, height));
      // Content rows (panel minus borders), matching renderPortfolio's input.
      return portfolioWindowSize(panelHeight - 2);
    };

    const selectTask = (index) => {
      const max = Math.max(0, ui.snapshot.tasks.length - 1);
      const next = Math.max(0, Math.min(max, index));
      if (next !== ui.selected) {
        ui.selected = next;
        ui.taskScroll = 0;
      }
      // Keep the selection visible in the scrolled portfolio list.
      const visible = portfolioWindow();
      if (ui.selected < ui.portfolioScroll) ui.portfolioScroll = ui.selected;
      else if (ui.selected >= ui.portfolioScroll + visible) ui.portfolioScroll = ui.selected - visible + 1;
    };

    const cyclePanelFocus = (step) => {
      const PANEL_ORDER = layoutFor(terminalSize().width, terminalSize().height).showSidebar
        ? ["nav", "portfolio", "task", "feed"]
        : ["portfolio", "task", "feed"];
      const at = Math.max(0, PANEL_ORDER.indexOf(ui.panelFocus));
      ui.panelFocus = PANEL_ORDER[(at + (step < 0 ? PANEL_ORDER.length - 1 : 1)) % PANEL_ORDER.length];
    };

    // Pane-aware scrolling for the dashboard. Wheel events name the hovered
    // pane; keyboard events act on ui.panelFocus (Tab cycles it). Portfolio
    // wheeling moves the list window; the selection only changes via keys.
    const scrollDashboard = (delta, panelName = null) => {
      ui.panelFocus = panelName || ui.panelFocus;
      if (ui.panelFocus === "portfolio") {
        // One task per wheel notch; a wheel delta of 3 is still one notch.
        const notch = delta > 0 ? Math.ceil(delta / 3) : -Math.ceil(-delta / 3);
        const maxScroll = Math.max(0, ui.snapshot.tasks.length - portfolioWindow());
        ui.portfolioScroll = Math.max(0, Math.min(ui.portfolioScroll + notch, maxScroll));
      } else if (ui.panelFocus === "task") {
        const { width, height } = terminalSize();
        const panelHeight = Math.max(7, dashboardRemainingRows(ui.snapshot, width, height));
        const total = renderTaskDetail(ui.snapshot, ui.selected, dashboardPanelLayout(width).centerWidth, true).length;
        const pageRows = Math.max(1, panelHeight - 3); // content rows minus the hint line
        ui.taskScroll = Math.max(0, Math.min(ui.taskScroll + delta, Math.max(0, total - pageRows)));
      } else {
        ui.feedScroll = Math.max(0, ui.feedScroll - delta);
      }
      draw();
    };

    const onMouseData = (chunk) => {
      if (!ui.mouseMode) return; // capture is off: the terminal owns the mouse
      // PTYs are allowed to split an SGR packet across data events. The old
      // single-chunk regex dropped the first half, then readline interpreted
      // the remainder as keyboard input. Keep only the incomplete packet
      // suffix and parse complete packets from the shared buffer.
      mouseProtocolBuffer += String(chunk);
      const parsed = consumeSgrMousePackets(mouseProtocolBuffer);
      mouseProtocolBuffer = parsed.remainder;
      for (const packet of parsed.packets) {
        const { button, x, y } = packet;
        if (!(button & 64) && packet.type === "M") {
          // Every prototype page keeps the same sidebar and route switcher.
          // Resolve those clicks before page-specific hit maps so navigation
          // remains usable after entering Tasks, Queues, or any other page.
          if (ui.screen !== "dashboard") {
            const route = controlPlaneRouteForScreen(ui.screen);
            if (route) {
              const dims = controlPlaneDimensions(terminalSize().width, terminalSize().height);
              const contentOrigin = controlPlaneContentOrigin(dims);
              if (dims.wide && x < TUI_SIDEBAR_WIDTH + 1 && y >= contentOrigin && y < contentOrigin + dims.contentHeight) {
                const sidebarRoute = sidebarRouteAtPanelRow(y - contentOrigin - 1, dims.contentHeight);
                if (sidebarRoute) {
                  ui.navSelected = Math.max(0, TUI_NAV_ITEMS.findIndex((item) => item[0] === sidebarRoute));
                  ui.panelFocus = "nav";
                  openRoute(sidebarRoute);
                  draw();
                  continue;
                }
              } else if (!dims.wide && dims.routeRows && y >= 2 && y < 2 + dims.routeRows) {
                const switchRoute = routeAtSwitcherPosition(dims.safeWidth, y - 2, x);
                if (switchRoute) {
                  ui.navSelected = Math.max(0, TUI_NAV_ITEMS.findIndex((item) => item[0] === switchRoute));
                  ui.panelFocus = "nav";
                  openRoute(switchRoute);
                  draw();
                  continue;
                }
              }
              if ((dims.wide ? x >= TUI_SIDEBAR_WIDTH + 1 : true) && y >= contentOrigin && y < contentOrigin + dims.contentHeight) {
                const pageRow = y - contentOrigin;
                if (ui.screen === "tasks") {
                  const tasks = taskPageItems(ui.snapshot, ui);
                  const rendered = renderTasksScreen(ui.snapshot, ui, dims.contentWidth, dims.contentHeight, true).split("\n");
                  const listWidth = Math.max(30, Math.floor(Math.max(20, dims.contentWidth - 2) * 0.58));
                  const contentX = dims.wide ? x - TUI_SIDEBAR_WIDTH - 1 : x;
                  const hit = contentX >= 0 && contentX < listWidth
                    ? renderedItemIndexAtLine(rendered, tasks, pageRow, { column: contentX, maxColumn: listWidth })
                    : -1;
                  if (hit >= 0) {
                    ui.tasksSelected = hit;
                    ui.panelFocus = "tasks";
                    draw();
                    continue;
                  }
                } else if (ui.screen === "queue") {
                  const queues = ui.snapshot.controlPlane?.queues?.items || [];
                  const rendered = renderQueuesScreen(ui.snapshot, ui, dims.contentWidth, dims.contentHeight, true).split("\n");
                  const hit = renderedItemIndexAtLine(rendered, queues, pageRow, { column: dims.wide ? x - TUI_SIDEBAR_WIDTH - 1 : x, maxColumn: dims.contentWidth });
                  if (hit >= 0) {
                    ui.queuePageSelected = hit;
                    ui.panelFocus = "queues";
                    draw();
                    continue;
                  }
                }
              }
            }
          }
          if (ui.screen === "dashboard") {
            const { width, height } = terminalSize();
            const origin = dashboardPanelOrigin(ui.snapshot, width);
            const panelHeight = Math.max(7, dashboardRemainingRows(ui.snapshot, width, height));
            const shell = layoutFor(width, height);
            const routeRows = shell.mode === "wide" ? 0 : routeSwitcherLayout(width).length;
            const routeOrigin = origin - routeRows - 1;
            if (routeRows && y >= routeOrigin && y < routeOrigin + routeRows) {
              const route = routeAtSwitcherPosition(width, y - routeOrigin, x);
              if (route) {
                const index = TUI_NAV_ITEMS.findIndex((item) => item[0] === route);
                if (index >= 0) {
                  ui.navSelected = index;
                  ui.panelFocus = "nav";
                  openRoute(route);
                  draw();
                }
              }
              continue;
            }
            if (y >= origin && y < origin + panelHeight) {
              if (width >= 105) {
                const layout = dashboardPanelLayout(width);
                const offset = layout.contentWidth < width ? TUI_SIDEBAR_WIDTH + 1 : 0;
                if (offset && x < offset) {
                  const route = sidebarRouteAtPanelRow(y - origin - 1, panelHeight);
                  if (route) {
                    const index = TUI_NAV_ITEMS.findIndex((item) => item[0] === route);
                    if (index >= 0) {
                      ui.navSelected = index;
                      ui.panelFocus = "nav";
                      openRoute(route);
                    }
                  }
                } else if (x - offset < layout.leftWidth) {
                  const row = dashboardTaskIndexAtPoint(ui.snapshot, { x, y, width, height, portfolioScroll: ui.portfolioScroll });
                  if (row >= 0) {
                    selectTask(row);
                    ui.panelFocus = "portfolio";
                  }
                } else if (x - offset < layout.leftWidth + layout.centerWidth + 1) ui.panelFocus = "task";
                else ui.panelFocus = "feed";
              } else {
                const row = dashboardTaskIndexAtPoint(ui.snapshot, { x, y, width, height, portfolioScroll: ui.portfolioScroll });
                if (row >= 0) {
                  selectTask(row);
                  ui.panelFocus = "portfolio";
                } else if (y >= origin + panelHeight) {
                  ui.panelFocus = "task";
                }
              }
            }
          } else if (ui.screen === "sessions") {
            const index = Math.max(0, y - 3);
            if (index < (ui.sessions || []).length) ui.sessionsSelected = index;
          } else if (ui.screen === "run" && ui.reviewPause) {
            // The review gate is rendered as four left-to-right actions.
            // Keep the hit map intentionally coarse and keyboard-equivalent.
            if (y >= Math.max(0, terminalSize().height - 6) && ui.reviewResolve) {
              if (x < 25) ui.reviewResolve("continue");
              else if (x < 55) openFeedbackEditor(ui.runSessionSummary?.taskId, "checkpoint");
              else if (x < 85) openFeedbackEditor(ui.runSessionSummary?.taskId, "interrupt");
              else ui.reviewResolve("stop");
            }
          }
          draw();
          continue;
        }
        if (!(button & 64)) continue;
        const delta = button === 64 ? -3 : 3;
        if (ui.screen !== "dashboard") {
          moveScroll(delta);
          continue;
        }
        // The wheel scrolls only the pane the mouse is actually inside: the
        // event row must land in the panel block, not the header or footer.
        // SGR rows/columns are 1-based. Wide layouts map by column; narrow
        // layouts stack the two panels, so the upper half is the portfolio.
        const { width, height } = terminalSize();
        const row = y;
        const origin = dashboardPanelOrigin(ui.snapshot, width);
        const panelHeight = Math.max(7, dashboardRemainingRows(ui.snapshot, width, height));
        const shell = layoutFor(width, height);
        const routeRows = shell.mode === "wide" ? 0 : routeSwitcherLayout(width).length;
        const routeOrigin = origin - routeRows - 1; // one blank row separates routes from panels
        if (routeRows && row >= routeOrigin && row < routeOrigin + routeRows) {
          const route = routeAtSwitcherPosition(width, row - routeOrigin, x);
          if (route) {
            const index = TUI_NAV_ITEMS.findIndex((item) => item[0] === route);
            if (index >= 0) {
              ui.navSelected = index;
              ui.panelFocus = "nav";
              openRoute(route);
              draw();
            }
          }
          continue;
        }
        let hovered = null;
        if (row >= origin && row < origin + panelHeight) {
          hovered = width >= 105 ? panelFromColumn(width, x) : (row < origin + Math.floor(panelHeight / 2) ? "portfolio" : "task");
        }
        if (hovered) scrollDashboard(delta, hovered);
      }
    };

    function handleEditorKey(_input, key = {}) {
      const e = ui.editor;
      const name = key.name || "";
      if (key.ctrl && name === "s" && e.multiline) { submitFromEditor(); return; }
      if (name === "escape") {
        if (e.kind === "compose") {
          ui.editor = null;
          if (ui.composeFlow) ui.composeFlow.step = "audience";
          ui.screen = "compose";
        } else {
          ui.editor = null;
        }
        return;
      }
      if (name === "return") {
        if (e.multiline) {
          const line = e.lines[e.row];
          e.lines[e.row] = line.slice(0, e.col);
          e.lines.splice(e.row + 1, 0, line.slice(e.col));
          e.row += 1;
          e.col = 0;
        } else {
          submitFromEditor();
        }
        return;
      }
      if (name === "backspace") {
        if (e.col > 0) {
          e.lines[e.row] = e.lines[e.row].slice(0, e.col - 1) + e.lines[e.row].slice(e.col);
          e.col -= 1;
        } else if (e.row > 0) {
          e.col = e.lines[e.row - 1].length;
          e.lines[e.row - 1] += e.lines[e.row];
          e.lines.splice(e.row, 1);
          e.row -= 1;
        }
        return;
      }
      if (name === "delete") {
        e.lines[e.row] = e.lines[e.row].slice(0, e.col) + e.lines[e.row].slice(e.col + 1);
        return;
      }
      if (name === "left") {
        if (e.col > 0) e.col -= 1;
        else if (e.row > 0) { e.row -= 1; e.col = e.lines[e.row].length; }
        return;
      }
      if (name === "right") {
        if (e.col < e.lines[e.row].length) e.col += 1;
        else if (e.row < e.lines.length - 1) { e.row += 1; e.col = 0; }
        return;
      }
      if (name === "up") {
        if (e.row > 0) { e.row -= 1; e.col = Math.min(e.col, e.lines[e.row].length); }
        return;
      }
      if (name === "down") {
        if (e.row < e.lines.length - 1) { e.row += 1; e.col = Math.min(e.col, e.lines[e.row].length); }
        return;
      }
      if (name === "home") { e.col = 0; return; }
      if (name === "end") { e.col = e.lines[e.row].length; return; }
      if (key.ctrl || key.meta) return;
      const insert = key.sequence || _input;
      if (typeof insert === "string" && insert) {
        for (const ch of insert.replace(/\r\n/g, "\n")) {
          if (ch === "\n") {
            if (e.multiline) {
              const line = e.lines[e.row];
              e.lines[e.row] = line.slice(0, e.col);
              e.lines.splice(e.row + 1, 0, line.slice(e.col));
              e.row += 1;
              e.col = 0;
            } else {
              submitFromEditor();
              return;
            }
          } else {
            const line = e.lines[e.row];
            e.lines[e.row] = line.slice(0, e.col) + ch + line.slice(e.col);
            e.col += 1;
          }
        }
      }
    }

    // Leaving while a queue run is live requires a second press within 5 s:
    // the run is aborted (current session terminated, task keeps its gate
    // status, remaining tasks recorded as not reached) and the TUI exits.
    let quitArmedAt = 0;
    const confirmQuitWhileRunning = (label) => {
      if (Date.now() - quitArmedAt < 5000) {
        ui.notice = "Stopping the run and leaving…";
        draw();
        requestRunAbort();
        close();
        return;
      }
      quitArmedAt = Date.now();
      ui.notice = `A queue run is in progress — press ${label} again within 5 s to stop it and leave (the current session is terminated; the task keeps its gate status).`;
      draw();
    };

    function onKey(_input, key = {}) {
      // Mouse tracking is delivered through stdin as an escape sequence and
      // must never leak into the text editor or into task shortcuts.
      if (ignoreMouseProtocolKey) {
        const value = typeof _input === "string" ? _input : "";
        const name = key.name || "";
        const protocolFragment = value.includes("\x1b") || /^[\[<0-9;Mm]+$/.test(value) || name === "escape";
        if ((key.shift && name === "m") || protocolFragment) {
          if (key.shift && name === "m") ignoreMouseProtocolKey = false;
          return;
        }
        ignoreMouseProtocolKey = false;
      }
      // Some ConPTY/readline combinations expose the complete SGR packet on
      // keypress instead of forwarding it through the data listener. Feed it
      // into the same buffered parser rather than silently dropping the click.
      if (typeof _input === "string" && /\x1b\[</.test(_input)) {
        onMouseData(_input);
        return;
      }
      const name = key.name || _input;
      if (key.ctrl && name === "c") {
        if (ui.running) return confirmQuitWhileRunning("Ctrl+C");
        return close();
      }
      if (ui.editor) {
        handleEditorKey(_input, key);
        draw();
        return;
      }
      if (ui.screen === "command") {
        handleCommandKey(_input, key);
        draw();
        return;
      }
      if (name === "q" && !key.shift) {
        if (ui.running) return confirmQuitWhileRunning("q");
        return close();
      }
      // Match the prototype's persistent command-palette affordance while
      // keeping the audited ATL console as the single command surface.
      if (key.ctrl && name === "k") {
        openCommandConsole();
        draw();
        return;
      }
      if (name === "n") {
        openCompose();
        draw();
        return;
      }
      if (name === ":") {
        openCommandConsole();
        draw();
        return;
      }
      if (ui.screen !== "dashboard") {
        const keyedRoute = TUI_NAV_ITEMS.find((item) => item[2] === name);
        if (keyedRoute) {
          ui.navSelected = TUI_NAV_ITEMS.indexOf(keyedRoute);
          openRoute(keyedRoute[0]);
          draw();
          return;
        }
      }
      // Shift+L opens the LOGS stream and Shift+R the run view from any
      // screen (including mid-run); Esc goes back one screen.
      if (name === "l" && key.shift) {
        openLogs();
        draw();
        return;
      }
      if (name === "r" && key.shift) {
        gotoScreen("run");
        draw();
        return;
      }
      // ConPTY can surface the final `M` of every SGR click as Shift+M. Do
      // not let that synthetic keypress disable capture while it is active.
      // Ctrl+M is the deterministic toggle; Shift+M re-enables capture after
      // it has been turned off.
      if (name === "m" && key.shift) {
        if (!ui.mouseMode) toggleMouseMode();
        return;
      }
      if (name === "m" && key.ctrl) {
        toggleMouseMode();
        return;
      }
      ui.error = null;
      ui.notice = null;
      if (ui.screen === "dashboard") {
        if (name === "escape" && key.ctrl) return close();
        if (name === "tab") {
          cyclePanelFocus(key.shift ? -1 : 1);
        } else if (ui.panelFocus === "nav") {
          if (name === "up" || name === "k") ui.navSelected = Math.max(0, ui.navSelected - 1);
          else if (name === "down" || name === "j") ui.navSelected = Math.min(TUI_NAV_ITEMS.length - 1, ui.navSelected + 1);
          else if (name === "return" || name === "o") {
            openRoute(TUI_NAV_ITEMS[ui.navSelected]?.[0]);
            draw();
            return;
          }
        } else if (ui.panelFocus === "task") {
          if (name === "up" || name === "k") scrollDashboard(-1);
          else if (name === "down" || name === "j") scrollDashboard(1);
          else if (name === "pageup") scrollDashboard(-10);
          else if (name === "pagedown") scrollDashboard(10);
          else if (name === "home") scrollDashboard(-1000000);
          else if (name === "end") scrollDashboard(1000000);
          else if (/^[1-9]$/.test(name)) selectTask(Number(name) - 1);
        } else if (ui.panelFocus === "feed") {
          if (name === "up" || name === "k") scrollDashboard(-1);
          else if (name === "down" || name === "j") scrollDashboard(1);
          else if (name === "pageup") scrollDashboard(-10);
          else if (name === "pagedown") scrollDashboard(10);
          else if (name === "home") scrollDashboard(-1000000);
          else if (name === "end") scrollDashboard(1000000);
        } else {
          if (name === "up" || name === "k") selectTask(ui.selected - 1);
          else if (name === "down" || name === "j") selectTask(ui.selected + 1);
          else if (name === "pageup") selectTask(ui.selected - 10);
          else if (name === "pagedown") selectTask(ui.selected + 10);
          else if (name === "home") selectTask(0);
          else if (name === "end") selectTask(ui.snapshot.tasks.length - 1);
          else if (/^[1-9]$/.test(name)) selectTask(Number(name) - 1);
        }
        if (name === "return" || name === "o") {
          const task = ui.snapshot.tasks[ui.selected];
          if (task) {
            ui.view = readTaskFile(root, task);
            gotoScreen("file");
          }
        } else if (name === "c") {
          openCompose();
        } else if (name === "i") {
          gotoScreen("import", () => { ui.importState = null; });
        } else if (name === "v") {
          const task = ui.snapshot.tasks[ui.selected];
          if (task) {
            ui.reviewTaskId = task.id;
            ui.reviewDigit = null;
            gotoScreen("review");
          }
        } else if (name === "x") {
          const task = ui.snapshot.tasks[ui.selected];
          if (task) toggleQueue(task.id);
        } else if (name === "e") {
          const task = ui.snapshot.tasks[ui.selected];
          if (task) {
            ui.reviewTaskId = task.id;
            ui.reviewDigit = null;
            gotoScreen("review");
          }
        } else if (name === "a") {
          openResourceEditor(ui.snapshot.tasks[ui.selected]);
        } else if (name === "n") {
          gotoScreen("notifications");
        } else if (name === "t") {
          gotoScreen("team");
        } else if (name === "u" && key.shift) {
          gotoScreen("usage");
        } else if (name === "u") {
          openRecoveryEditor(ui.snapshot.tasks[ui.selected]);
        } else if (name === "w") {
          const task = ui.snapshot.tasks[ui.selected];
          if (task) openCommandConsole(`why ${task.id}`);
        } else if (name === ":") {
          openCommandConsole();
        } else if (name === "l" && !key.shift) {
          openLaunchPlan();
          gotoScreen("launch");
        } else if (name === "q" && key.shift) {
          openLaunchPlan();
          gotoScreen("queue");
        } else if (name === "p") {
          gotoScreen("providers");
        } else if (name === "s") {
          openSessions();
        } else if (name === "f") gotoScreen("feed");
        else if (name === "?") gotoScreen("help");
        else if (name === "r") refresh();
        draw();
      } else if (ui.screen === "tasks") {
        const pageTasks = taskPageItems(ui.snapshot, ui);
        const selectedTask = pageTasks[Math.min(Math.max(0, ui.tasksSelected || 0), Math.max(0, pageTasks.length - 1))];
        if (name === "escape") goBack();
        else if (name === "up" || name === "k") ui.tasksSelected = Math.max(0, (ui.tasksSelected || 0) - 1);
        else if (name === "down" || name === "j") ui.tasksSelected = Math.min(Math.max(0, pageTasks.length - 1), (ui.tasksSelected || 0) + 1);
        else if (name === "f") {
          const index = TASK_FILTERS.indexOf(ui.tasksFilter || "All");
          ui.tasksFilter = TASK_FILTERS[(index + 1) % TASK_FILTERS.length];
          ui.tasksSelected = 0;
        } else if (name === "/") openTaskFilterEditor();
        else if (name === "c") openCompose();
        else if (name === "e") openTaskEditEditor(selectedTask);
        else if (name === "d" && selectedTask) {
          try {
            archiveTask(root, selectedTask.id, { note: "archived from the ATL Tasks page" });
            feedPost(root, { from: "manager", text: `archived ${selectedTask.id} from the Tasks page.`, task: selectedTask.id });
            flash(`${selectedTask.id} archived; it remains recoverable via the Archived filter.`);
            refreshSnapshot();
          } catch (error) { ui.error = error.message; }
        } else if (name === "r" && key.shift && selectedTask?.status === "archived") {
          try {
            restoreTask(root, selectedTask.id, { note: "restored from the ATL Tasks page" });
            feedPost(root, { from: "manager", text: `restored ${selectedTask.id} from the Tasks page.`, task: selectedTask.id });
            flash(`${selectedTask.id} restored to New.`);
            refreshSnapshot();
          } catch (error) { ui.error = error.message; }
        } else if (name === "x" && selectedTask) toggleQueue(selectedTask.id);
        else if (name === "return" || name === "o") {
          if (selectedTask) {
            ui.reviewTaskId = selectedTask.id;
            gotoScreen("review");
          }
        } else if (name === ":") openCommandConsole();
        else if (name === "r") refresh();
        draw();
      } else if (ui.screen === "team" || ui.screen === "notifications" || ui.screen === "usage") {
        if (name === "escape") goBack();
        else if (name === "r") refresh();
        else if (name === ":") openCommandConsole();
        draw();
      } else if (ui.screen === "settings") {
        if (name === "escape") goBack();
        else if (name === ":") openCommandConsole();
        else if (name === "?") gotoScreen("help");
        draw();
      } else if (ui.screen === "plan") {
        if (name === "escape") goBack();
        else if (name === "c") openPlanIntentEditor();
        else if (name === "f") saveDeterministicPlan();
        else if (name === "a" && ui.planStudio?.draft) {
          try {
            const result = approvePlanDraft(root, ui.planStudio.draft);
            flash(result.created ? `${result.task.id} created from the approved plan.` : `${result.task.id} already exists for this draft.`);
            refreshSnapshot();
          } catch (error) { ui.error = error.message; }
        } else if (name === ":") openCommandConsole();
        draw();
      } else if (ui.screen === "compose") {
        const flow = ui.composeFlow;
        if (!flow) {
          goHome();
        } else if (name === "escape") {
          if (flow.step === "audience") flow.step = "intent";
          else if (flow.step === "preview") cancelCompose();
          else cancelCompose();
        } else if (flow.step === "intent") {
          if (name === "up" || name === "k") flow.intentIndex = Math.max(0, flow.intentIndex - 1);
          else if (name === "down" || name === "j") flow.intentIndex = Math.min(COMPOSE_INTENTS.length - 1, flow.intentIndex + 1);
          else if (/^[1-4]$/.test(name)) flow.intentIndex = Number(name) - 1;
          else if (name === "return") flow.step = "audience";
        } else if (flow.step === "audience") {
          if (name === "up" || name === "k") flow.audienceIndex = Math.max(0, flow.audienceIndex - 1);
          else if (name === "down" || name === "j") flow.audienceIndex = Math.min(COMPOSE_AUDIENCES.length - 1, flow.audienceIndex + 1);
          else if (/^[1-4]$/.test(name)) flow.audienceIndex = Number(name) - 1;
          else if (name === "return") {
            flow.step = "body";
            ui.editor = newEditor({
              kind: "compose",
              title: "Describe the task in plain language",
              hint: `${COMPOSE_INTENTS[flow.intentIndex].label} · ${COMPOSE_AUDIENCES[flow.audienceIndex].label}. First line becomes the title; add context or Checks: bullets below it.`,
              text: flow.text || "",
              multiline: true,
            });
          }
        } else if (flow.step === "preview") {
          if (name === "return") commitCompose();
          else if (name === "e") {
            flow.step = "body";
            ui.editor = newEditor({
              kind: "compose",
              title: "Edit the task wording",
              hint: `${COMPOSE_INTENTS[flow.intentIndex].label} · ${COMPOSE_AUDIENCES[flow.audienceIndex].label}. Ctrl+S refreshes the ATL packet preview.`,
              text: flow.text,
              multiline: true,
            });
          }
        }
        draw();
      } else if (ui.screen === "review") {
        const task = ui.snapshot.tasks.find((t) => t.id === ui.reviewTaskId);
        if (!task) {
          goHome();
          draw();
          return;
        }
        if (name === "escape") {
          goBack();
          ui.reviewDigit = null;
        } else if (ui.reviewDigit === "remove" && /^[1-9]$/.test(name)) {
          const index = Number(name) - 1;
          const removed = task.completion_checks[index];
          if (removed) {
            mutateTask(task.id, (t) => t.completion_checks.splice(index, 1), { event: "update", detail: `check removed: ${removed}` });
            feedPost(root, { from: "manager", text: `check removed on ${task.id}: ${removed}`, task: task.id });
          }
          ui.reviewDigit = null;
        } else if (name === "o") {
          ui.editor = newEditor({
            kind: "objective",
            taskId: task.id,
            title: `Objective for ${task.id}`,
            hint: "One bounded sentence. Required before the packet can be approved.",
            text: task.objective || task.objective_hint || "",
          });
        } else if (name === "n") {
          ui.editor = newEditor({
            kind: "check",
            taskId: task.id,
            title: `New completion check for ${task.id}`,
            hint: "Observable and checkable — Beacon will need evidence for it.",
          });
        } else if (name === "a") {
          openResourceEditor(task);
        } else if (name === "d") {
          ui.reviewDigit = "remove";
        } else if (name === "p") {
          mutateTask(task.id, (t) => {
            const order = ["low", "normal", "high", "urgent"];
            t.priority = order[(order.indexOf(t.priority || "normal") + 1) % order.length];
          }, { event: "update", detail: "priority cycled from the control room" });
          const after = ui.snapshot.tasks.find((t) => t.id === task.id);
          feedPost(root, { from: "manager", text: `${task.id} priority → ${after?.priority || "?"}`, task: task.id });
        } else if (name === "k") {
          const nextRisk = task.risk === "risky" ? "normal" : "risky";
          mutateTask(task.id, (t) => {
            t.risk = nextRisk;
            if (t.risk === "risky") t.review_required = true;
          }, { event: "update", detail: `risk → ${nextRisk}` });
          feedPost(root, { from: "manager", text: `${task.id} risk → ${nextRisk}`, task: task.id });
        } else if (name === "t") {
          mutateTask(task.id, (t) => { applyDeterministicRoute(root, t); }, { event: "route", detail: "deterministic route re-run from the control room" });
        } else if (name === "u") {
          openRecoveryEditor(task);
        } else if (name === "x") {
          toggleQueue(task.id);
        } else if (name === "T") {
          if (task.status === "new") {
            try {
              const state = loadState(root);
              transition(state, task.id, "triaged", { actor: "manager", note: "packet approved in the control room (manager override)" });
              saveState(root, state);
              feedPost(root, { from: "manager", text: `${task.id} packet approved → triaged (manager override). objective + ${task.completion_checks.length} check(s).`, task: task.id });
              flash(`${task.id} → triaged (manager override).`);
              refreshSnapshot();
            } catch (error) {
              ui.error = error.message;
            }
          } else {
            ui.notice = `T approves a new task — ${task.id} is ${task.status}.`;
          }
        }
        draw();
      } else if (ui.screen === "queue") {
        const queues = ui.snapshot.controlPlane?.queues?.items || [];
        const selectedQueue = queues[Math.min(Math.max(0, ui.queuePageSelected || 0), Math.max(0, queues.length - 1))];
        if (name === "escape") goBack();
        else if (name === "up" || name === "k") ui.queuePageSelected = Math.max(0, (ui.queuePageSelected || 0) - 1);
        else if (name === "down" || name === "j") ui.queuePageSelected = Math.min(Math.max(0, queues.length - 1), (ui.queuePageSelected || 0) + 1);
        else if (name === "n") openQueueEditor("queue-create");
        else if (name === "r" && selectedQueue) openQueueEditor("queue-rename", selectedQueue);
        else if (name === "p" && selectedQueue) {
          try { (selectedQueue.status === "paused" ? queueResume : queuePause)(root, selectedQueue.id); refreshSnapshot(); flash(`${selectedQueue.id} ${selectedQueue.status === "paused" ? "resumed" : "paused"}.`); } catch (error) { ui.error = error.message; }
        } else if (name === "u" && selectedQueue) {
          try { queueSetActive(root, selectedQueue.id); refreshSnapshot(); flash(`${selectedQueue.id} is now the active queue.`); } catch (error) { ui.error = error.message; }
        } else if (name === "a" && selectedQueue) {
          try { queueArchive(root, selectedQueue.id); refreshSnapshot(); flash(`${selectedQueue.id} archived.`); } catch (error) { ui.error = error.message; }
        } else if (name === "l" && selectedQueue) {
          try { queueSetActive(root, selectedQueue.id); openLaunchPlan(); gotoScreen("launch"); } catch (error) { ui.error = error.message; }
        } else if (name === ":") openCommandConsole();
        draw();
      } else if (ui.screen === "launch") {
        if (name === "escape") goBack();
        else if (name === "r") openLaunchPlan();
        else if (name === "return" || name === "y") runQueuedLaunch();
        else if (name === "+" || name === "=") adjustLaunchBudget(1, 0);
        else if (name === "-") adjustLaunchBudget(-1, 0);
        else if (name === "]") adjustLaunchBudget(0, 15);
        else if (name === "[") adjustLaunchBudget(0, -15);
        else if (name === "p") { ui.pauseAfterBot = !ui.pauseAfterBot; flash(`Pause after every bot ${ui.pauseAfterBot ? "enabled" : "disabled"}.`); }
        draw();
      } else if (ui.screen === "run") {
        // Esc leaves the run view; a run in progress keeps running and
        // Shift+R reopens it from anywhere.
        if (name === "escape") goBack();
        else if (name === "r" && !ui.running) {
          refreshSnapshot();
          openLaunchPlan();
        }
        else if (name === "v") ui.runLogMode = ui.runLogMode === "raw" ? "structured" : "raw";
        else if (name === "b") openFeedbackEditor(ui.runCurrent?.taskId || ui.runSessionSummary?.taskId || ui.runTasks.find((entry) => entry.state === "running")?.taskId, "checkpoint");
        else if (name === "i") openFeedbackEditor(ui.runCurrent?.taskId || ui.runSessionSummary?.taskId || ui.runTasks.find((entry) => entry.state === "running")?.taskId, "interrupt");
        else if (name === "up" || name === "k") ui.runLogScroll = (ui.runLogScroll || 0) + 1;
        else if (name === "down" || name === "j") ui.runLogScroll = Math.max(0, (ui.runLogScroll || 0) - 1);
        else if (name === "pageup") ui.runLogScroll = (ui.runLogScroll || 0) + 10;
        else if (name === "pagedown") ui.runLogScroll = Math.max(0, (ui.runLogScroll || 0) - 10);
        else if (name === "end") ui.runLogScroll = 0;
        else if (ui.reviewPause && name === "a" && ui.reviewResolve) ui.reviewResolve("continue");
        else if (ui.reviewPause && name === "s" && ui.reviewResolve) ui.reviewResolve("stop");
        else if (ui.reviewPause && name === "b") openFeedbackEditor(ui.runSessionSummary?.taskId, "checkpoint");
        else if (ui.reviewPause && name === "i") openFeedbackEditor(ui.runSessionSummary?.taskId, "interrupt");
        draw();
      } else if (ui.screen === "providers") {
        handleProvidersKey(name);
        draw();
      } else if (ui.screen === "sessions") {
        const sessions = ui.sessions || [];
        if (name === "escape") goBack();
        else if (name === "up" || name === "k") ui.sessionsSelected = Math.max(0, ui.sessionsSelected - 1);
        else if (name === "down" || name === "j") ui.sessionsSelected = Math.min(Math.max(0, sessions.length - 1), ui.sessionsSelected + 1);
        else if (name === "return" && sessions[ui.sessionsSelected]) {
          const s = sessions[ui.sessionsSelected];
          try {
            const lines = fs.readFileSync(s.file, "utf8").split(/\r?\n/);
            const rows = Math.max(4, (process.stdout.rows || 34) - 7);
            // Provider transcripts grow at the end: open at the latest output.
            ui.view = { root, taskId: s.taskId, filePath: s.file, lines, scroll: Math.max(0, lines.length - rows), error: null };
            gotoScreen("file");
          } catch (error) {
            ui.error = error.message;
          }
        }
        draw();
      } else if (ui.screen === "logs") {
        if (name === "escape") goBack();
        else if (name === "up" || name === "k") { ui.logsFollow = false; ui.logsScroll = (ui.logsScroll || 0) + 1; }
        else if (name === "down" || name === "j") {
          const next = (ui.logsScroll || 0) - 1;
          if (next <= 0) { ui.logsScroll = 0; ui.logsFollow = true; }
          else ui.logsScroll = next;
        }
        else if (name === "pageup") { ui.logsFollow = false; ui.logsScroll = (ui.logsScroll || 0) + 10; }
        else if (name === "pagedown") { ui.logsFollow = false; ui.logsScroll = Math.max(0, (ui.logsScroll || 0) - 10); }
        else if (name === "end") { ui.logsFollow = true; ui.logsScroll = 0; }
        else if (name === "f") { ui.logsFollow = !ui.logsFollow; ui.logsScroll = 0; }
        else if (name === "r") refresh();
        draw();
      } else if (ui.screen === "import") {
        if (name === "escape") {
          goBack();
          ui.importState = null;
        } else if (["f", "g", "a"].includes(name) && !(ui.importState && ui.importState.candidates)) {
          openImport(name);
        } else if (ui.importState && ui.importState.candidates && ui.importState.candidates.length) {
          if (name === "up" || name === "k") ui.importState.selected = Math.max(0, ui.importState.selected - 1);
          else if (name === "down" || name === "j") ui.importState.selected = Math.min(ui.importState.candidates.length - 1, ui.importState.selected + 1);
          else if (name === "return") {
            const cand = ui.importState.candidates[ui.importState.selected];
            if (cand) importOne(cand);
          } else if (name === "a") {
            try {
              const state = loadState(root);
              const { added, skipped } = importCandidates(root, state, ui.importState.candidates, { cfg: configSafe(root) });
              saveState(root, state);
              flash(`${added} imported, ${skipped} already known.`);
              refreshSnapshot();
            } catch (error) {
              ui.error = error.message;
            }
          }
        }
        draw();
      } else if (ui.screen === "file") {
        if (name === "escape") goBack();
        else if (name === "up" || name === "k") moveScroll(-1);
        else if (name === "down" || name === "j") moveScroll(1);
        else if (name === "pageup") moveScroll(-10);
        else if (name === "pagedown") moveScroll(10);
        else if (name === "home" && ui.view) { ui.view.scroll = 0; draw(); }
        else if (name === "end" && ui.view) {
          const rows = Math.max(4, (process.stdout.rows || 34) - 7);
          ui.view.scroll = Math.max(0, ui.view.lines.length - rows);
          draw();
        }
        draw();
      } else if (ui.screen === "feed") {
        if (name === "escape") goBack();
        else if (name === "up" || name === "k") moveScroll(-1);
        else if (name === "down" || name === "j") moveScroll(1);
        else if (name === "pageup") moveScroll(-10);
        else if (name === "pagedown") moveScroll(10);
        else if (name === "r") refresh();
        draw();
      } else if (ui.screen === "help" && (name === "escape" || name === "?")) {
        goBack();
        draw();
      }
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    // ConPTY may expose the final `M` of an SGR mouse packet as a synthetic
    // Shift+M keypress as well as a data event. Mark the packet before the
    // readline keypress listener sees it so a click can never toggle capture.
    const markMouseProtocol = (chunk) => {
      // Mark prefixes as well as complete packets. On Windows ConPTY the
      // final M can be surfaced as a synthetic Shift+M keypress, and a
      // split packet can otherwise leak digits/semicolons into the active UI.
      if (/\x1b\[<|\x1b\[<\d+;\d+;\d+[mM]/.test(String(chunk))) ignoreMouseProtocolKey = true;
    };
    process.stdin.prependListener("data", markMouseProtocol);
    process.stdin.on("keypress", onKey);
    process.stdin.on("data", onMouseData);
    process.stdout.on("resize", onResize);
    process.once("SIGINT", close);
    // Capture starts on for click and wheel interaction. The explicit write
    // also clears reporting left behind by an earlier crashed TUI on toggle/exit.
    applyMouseMode();
    ui.loading = false;
    lastSignature = signatureOf(ui.snapshot);
    draw();
  });
}
