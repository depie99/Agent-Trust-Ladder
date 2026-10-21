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
import { loadQueue, queueAdd, queueIds, queueRemove } from "./queue.mjs";
import { buildLaunchPlan, executeLaunchQueue } from "./launch.mjs";
import { unblockTask } from "./recovery.mjs";
import { addResourceToTask } from "./resources.mjs";
import { intakeFromFiles, intakeFromAzure, intakeFromGitHub } from "./intake.mjs";
import { discoverProvider, providerForRole, providerNames, providerProfile, providerSpec } from "./providers.mjs";
import { loadUserProviders, maskKey, PROVIDER_TEMPLATES, removeProvider, saveUserProviders, templateById, upsertProvider } from "./userProviders.mjs";

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
};

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const SPINNER = ["◐", "◓", "◑", "◒"];
const RESET = "\x1b[0m";
const COLORS = {
  ink: [245, 245, 247],
  muted: [150, 152, 168],
  faint: [111, 113, 129],
  violet: [155, 140, 255],
  mint: [95, 224, 194],
  amber: [244, 198, 126],
  coral: [250, 143, 131],
  line: [36, 37, 48],
  panel: [18, 19, 26],
  panel2: [23, 24, 33],
};
const SURFACES = {
  coral: [30, 23, 31],
  violet: [25, 24, 41],
  mint: [20, 31, 32],
};
const FOCUS_SURFACE = [57, 43, 78];

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
  const topTitle = `─ ${title} `;
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
  };
}

function renderHeader(snapshot, width, { plain, loading, spinner, interactive, syncedAt }) {
  const age = Math.max(0, Math.round((Date.now() - (syncedAt || Date.now())) / 1000));
  const live = loading
    ? `${SPINNER[spinner % SPINNER.length]} SYNCING`
    : interactive
      ? `● LIVE · synced ${age}s ago`
      : `SNAPSHOT · state of ${timeOf(snapshot.updatedAt)}`;
  const left = `${paint("▌", "coral", plain)} ${paint("ATL", "ink", plain)} ${paint("CONTROL ROOM", "muted", plain)}`;
  const right = paint(live, loading ? "amber" : "mint", plain);
  const gap = Math.max(1, width - widthOf(left) - widthOf(right));
  return `${left}${" ".repeat(gap)}${right}`;
}

function renderSummary(snapshot, plain) {
  const total = snapshot.tasks.length;
  const active = snapshot.active.length;
  const done = snapshot.counts.done || 0;
  const blocked = snapshot.counts.blocked || 0;
  const escalated = snapshot.counts.escalated || 0;
  const queued = (snapshot.queue || []).length;
  return [
    `${paint("PORTFOLIO", "faint", plain)}  ${paint(total, "ink", plain)} tasks  ·  ${paint(done, "mint", plain)} shipped  ·  ${paint(active, "violet", plain)} active  ·  ${paint(blocked, "amber", plain)} blocked  ·  ${paint(escalated, "coral", plain)} escalated  ·  ${paint("⌁", "mint", plain)} ${paint(queued, "mint", plain)} queued`,
    `${paint("last decision", "faint", plain)} ${snapshot.lastEvent ? `${timeOf(snapshot.lastEvent.at)} · ${snapshot.lastEvent.event}` : "no events yet"}  ·  ${paint("L logs", "faint", plain)} for the full history`,
  ];
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
  const compact = `${paint("ACTIONS", "faint", plain)}  ${paint("c", "coral", plain)} new · ${paint("e", "coral", plain)} edit · ${paint("a", "coral", plain)} files · ${paint("x", "coral", plain)} queue · ${paint("l", "coral", plain)} run${recovery ? ` · ${paint("u", "amber", plain)} fix` : ""} · ${paint("r", "coral", plain)} refresh · ${paint("?", "coral", plain)} help`;
  const full = `${paint("ACTIONS", "faint", plain)}  ${paint("c", "coral", plain)} create task   ${paint("e", "coral", plain)} edit selected   ${paint("a", "coral", plain)} resources   ${paint("x", "coral", plain)} ${selectedQueued ? "remove from" : "add to"} queue   ${paint("l", "coral", plain)} run queue${recovery}   ${paint("r", "coral", plain)} refresh`;
  return truncate(width < 105 ? compact : full, width);
}

function renderPortfolio(snapshot, selected, width, plain) {
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
    lines.push(isSelected ? focusRow(`${isSelected ? "▸" : " "} ${priorityChar} ${task.id} ${queuedMark} ${title}`, rowWidth, plain) : row);
    const worker = task.assigned_worker ? `${AVATARS[task.assigned_worker] || "·"} ${task.assigned_worker}` : "unassigned";
    const extra = task.status === "blocked" && task.blocker?.reason
      ? truncate(task.blocker.reason, Math.max(10, rowWidth - 14))
      : `${worker} · ${ageOf(task.updated_at)}`;
    lines.push(`    ${statusLine(task.status, plain, true)}  ${paint(extra, task.status === "blocked" ? "amber" : "faint", plain)}`);
  });
  return lines;
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
  const leftWidth = Math.floor(safeWidth * 0.27);
  const rightWidth = Math.floor(safeWidth * 0.29);
  const centerWidth = Math.max(20, safeWidth - leftWidth - rightWidth - 2);
  return { leftWidth, centerWidth, rightWidth };
}

export function panelFromColumn(safeWidth, column) {
  const { leftWidth, centerWidth } = dashboardPanelLayout(safeWidth);
  if (column < leftWidth) return "portfolio";
  if (column < leftWidth + 1 + centerWidth) return "task";
  return "feed";
}

// Rows the renderer spends above the panels (header, divider, summary,
// pipeline, action bar, blank). Shared so input handlers can clamp scroll
// offsets with the same panel height the next paint will use.
function dashboardRemainingRows(snapshot, safeWidth, safeHeight) {
  const before = 4 + renderSummary(snapshot, false).length + renderPipeline(snapshot, safeWidth, false).length;
  return Math.max(8, safeHeight - before - 2);
}

export { dashboardPanelLayout, dashboardRemainingRows, renderTaskDetail };

export function renderDashboard(snapshot, {
  width = 120,
  height = 34,
  plain = false,
  loading = false,
  spinner = 0,
  selected = 0,
  feedScroll = 0,
  panelFocus = "portfolio",
  taskScroll = 0,
  interactive = true,
  syncedAt = null,
} = {}) {
  const safeWidth = Math.max(60, Number(width) || 120);
  const safeHeight = Math.max(14, Number(height) || 34);
  const lines = [
    renderHeader(snapshot, safeWidth, { plain, loading, spinner, interactive, syncedAt }),
    paint("─".repeat(safeWidth), "line", plain),
    ...renderSummary(snapshot, plain),
    ...renderPipeline(snapshot, safeWidth, plain),
    interactive ? renderActionBar(snapshot, selected, safeWidth, plain) : "",
    "",
  ];
  const remaining = dashboardRemainingRows(snapshot, safeWidth, safeHeight);
  if (safeWidth >= 105) {
    const { leftWidth, centerWidth, rightWidth } = dashboardPanelLayout(safeWidth);
    const panelHeight = Math.max(7, remaining);
    const mark = (name) => interactive && panelFocus === name ? "▸ " : "";
    const panels = [
      panel(`${mark("portfolio")}PORTFOLIO · FOCUS ${snapshot.tasks.length ? Math.min(selected + 1, snapshot.tasks.length) : 0}/${snapshot.tasks.length}`, renderPortfolio(snapshot, selected, leftWidth, plain), leftWidth, panelHeight, { accent: "coral", plain }),
      panel(`${mark("task")}SELECTED TASK`, renderTaskDetail(snapshot, selected, centerWidth, plain, taskScroll, panelHeight - 2), centerWidth, panelHeight, { accent: "violet", plain }),
      panel(`${mark("feed")}LIVE FEED`, renderFeedPanel(snapshot, rightWidth, plain, feedScroll, panelHeight - 2), rightWidth, panelHeight, { accent: "mint", plain }),
    ];
    lines.push(...joinPanels(panels));
  } else {
    const panelHeight = Math.max(6, Math.floor(remaining / 2));
    lines.push(...panel(interactive ? `PORTFOLIO · FOCUS ${snapshot.tasks.length ? Math.min(selected + 1, snapshot.tasks.length) : 0}/${snapshot.tasks.length}` : "PORTFOLIO", renderPortfolio(snapshot, selected, safeWidth, plain), safeWidth, panelHeight, { accent: "coral", plain }));
    lines.push(...panel("SELECTED TASK", renderTaskDetail(snapshot, selected, safeWidth, plain, taskScroll, panelHeight - 2), safeWidth, panelHeight, { accent: "violet", plain }));
  }
  const footerChoices = interactive
    ? [
        "Tab pane · ↑↓/jk pane · Enter open · c create · x queue · l run · u unblock · s sess · f feed · ? help · q quit",
        "Tab pane · ↑↓ scroll pane · Enter open · c create · x queue · l run · ? help · q quit",
        "Tab pane · ↑↓ scroll · ? help · q quit",
      ]
    : ["SNAPSHOT · read-only · run `atl ui` for keyboard navigation"];
  const footer = footerChoices.find((choice) => widthOf(choice) <= safeWidth - 2) || footerChoices[footerChoices.length - 1];
  const footerLine = `${paint("⌁", "coral", plain)} ${paint(footer, "muted", plain)}`;
  const output = [...lines, "", truncate(footerLine, safeWidth)];
  return output.slice(0, safeHeight).join("\n");
}

function renderFileView(view, width, height, plain) {
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

function renderFeedView(snapshot, width, height, scroll, plain) {
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
  const body = [paint("FULL TEAM FEED", "faint", plain), ...all.slice(start, start + visible), "", paint(`Esc back   ↑↓ / j k / wheel scroll   PgUp/PgDn jump   · ${hint}`, "muted", plain)];
  return panel("FEED", body, width, height, { accent: "mint", plain }).join("\n");
}

function renderHelp(width, height, plain) {
  const body = [
    paint("A calm view of the work — and the room where it starts.", "ink", plain),
    "",
    `${paint("↑↓ / j k", "coral", plain)}  act on the focused pane (move tasks, scroll task detail or feed)`,
    `${paint("Tab", "coral", plain)}        choose the focused pane: portfolio → task detail → live feed`,
    `${paint("wheel", "coral", plain)}      scrolls the pane under the mouse and focuses it`,
    `${paint("PgUp/PgDn", "coral", plain)}  bigger jumps · Home/End: top/last (pane-aware)`,
    `${paint("Enter / o", "coral", plain)}  read the task source file`,
    `${paint("c", "coral", plain)}        create: choose outcome + surface, write freely, preview packet, create candidate`,
    `${paint("i", "coral", plain)}        import: read-only candidates from inbox / GitHub / Azure`,
    `${paint("e / v", "coral", plain)}    edit/review the canonical packet (objective, checks, priority, risk, route)`,
    `${paint("a", "coral", plain)}        attach a URL or local screenshot/file; local files are copied into the task packet`,
    `${paint("x", "coral", plain)}        add/remove the selected task in the execution queue`,
    `${paint("l", "coral", plain)}        launch preview; Enter / y confirms the queued run`,
    `${paint("Q", "coral", plain)}        execution queue: live gate state per queued task (d remove · l launch)`,
    `${paint("L", "coral", plain)}        logs: state decisions + feed narration in one stream (F follow · End latest)`,
    `${paint("u", "amber", plain)}        unblock the selected blocked task; then x queue and l run`,
    `${paint("p", "coral", plain)}        providers: executable + model + per-role mapping (change with atl provider set ...)`,
    `${paint("s", "coral", plain)}        sessions: provider session logs (Enter opens at the latest output)`,
    `${paint("f", "coral", plain)}        open the full team feed; ↑↓/wheel scroll, PgUp/PgDn jump`,
    `${paint("r", "coral", plain)}        force a refresh (state.json + feed.jsonl are also re-read automatically)`,
    `${paint("Esc", "coral", plain)}      return to the dashboard`,
    `${paint("q", "coral", plain)}        quit without changing state`,
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
        out.push({ taskId, file: full, name: file, size: stat.size, mtime: stat.mtime.toISOString() });
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
  { key: "g", label: "GitHub issues", note: "read-only; set intake.github.enabled in config/manager.json" },
  { key: "a", label: "Azure Boards", note: "read-only; set intake.azure.enabled + PAT in the environment" },
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
  const runs = new Map((ui.runTasks || []).map((t) => [t.taskId, t]));
  const lines = [
    paint("Execution queue — membership, not focus. Stored in .trust/manager/queue.json.", "muted", plain),
    "",
  ];
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
    lines.push(`${paint(plan.items.length, "ink", plain)} queued · ${paint(plan.readyCount, "mint", plain)} ready · ${paint(plan.blockedCount, "coral", plain)} blocked · sequential · budget ${plan.budget.maxMinutes}m / ${plan.budget.maxSessions} sessions`);
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
  lines.push("", paint("Enter / y confirm run · r rebuild plan · Esc back", "muted", plain));
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
  const tail = ui.runLogTail || [];
  if (ui.runLogName) {
    lines.push("", paint(`SESSION LOG TAIL · ${ui.runLogName}${ui.running ? (tail.length ? "" : " (waiting for output)") : " (final)"}`, "faint", plain));
    if (tail.length) {
      const fixed = lines.length + 2;
      const tailRoom = Math.max(1, Math.min(tail.length, height - 7 - fixed));
      for (const line of tail.slice(-tailRoom)) lines.push(paint(truncate(line, inner), "muted", plain));
    } else {
      lines.push(paint("  (no provider output recorded yet)", "muted", plain));
    }
  }
  lines.push("", paint(ui.running ? "L logs · the frame stays stable while the run continues · Esc stays here" : "r refresh · L logs · Esc back", "muted", plain));
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
    for (const name of ["codex", "claude"]) {
      const spec = providerSpec(snapshot.providerProfile, name);
      const disc = discoverProvider(name, { command: spec.command });
      lines.push(`  ${disc.available ? paint("✓", "mint", plain) : paint("×", "coral", plain)} ${paint(name.padEnd(12), "ink", plain)} ${paint(truncate(`${disc.available ? disc.path : disc.error}`, Math.max(10, inner - 18)), disc.available ? "muted" : "coral", plain)}`);
    }
    lines.push("", paint("Per-role mapping (config/manager.json → providers):", "muted", plain));
    for (const role of ["pip", "mira", "rowan", "sage", "beacon"]) {
      const p = providerForRole(snapshot.providerProfile, role);
      lines.push(`  ${paint(role.padEnd(7), "ink", plain)} ${paint(`${p.worker} · ${p.model || "provider default"}`, "violet", plain)} ${paint(`· auth ${p.auth} · (${p.source})`, "faint", plain)}`);
    }
    lines.push("", paint("a add provider · u use highlighted here · d delete highlighted · r re-check · Esc back", "muted", plain));
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
      lines.push(`${mark} ${paint(s.taskId, "ink", plain)} ${paint(s.name, "violet", plain)}  ${paint(`${Math.max(1, Math.round(s.size / 1024))}KB · ${ageOf(s.mtime)}`, "faint", plain)}`);
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
      panelFocus: "portfolio",
      taskScroll: 0,
      error: null,
      notice: null,
      editor: null,
      reviewTaskId: null,
      reviewDigit: null,
      importState: null,
      launchPlan: null,
      queueSelected: 0,
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
      lastSyncAt: Date.now(),
      logsFollow: true,
      logsScroll: 0,
      logsReturn: "dashboard",
    };
    let closed = false;

    const flash = (text) => { ui.notice = text; };

    const refreshSnapshot = () => {
      try {
        ui.snapshot = createDashboardSnapshot(root);
        const before = ui.selected;
        ui.selected = Math.min(ui.selected, Math.max(0, ui.snapshot.tasks.length - 1));
        if (ui.selected !== before) ui.taskScroll = 0;
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
        ui.launchPlan = buildLaunchPlan(root, { taskIds: queueIds(root) });
      } catch (error) {
        ui.launchPlan = null;
        ui.error = error.message;
      }
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
      ui.runLogPath = null;
      ui.runLogName = null;
      ui.runLogTail = [];
      ui.error = null;
      ui.notice = null;
      ui.screen = "run";
      draw();
      const runEntry = (taskId) => ui.runTasks.find((t) => t.taskId === taskId);
      try {
        const result = await executeLaunchQueue(root, {
          confirm: true,
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
              ui.runLogTail = tailFileLines(ui.runLogPath, 6);
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
        ui.runLogTail = tailFileLines(ui.runLogPath, 6);
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
      ui.screen = "compose";
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

    const cancelCompose = () => {
      ui.editor = null;
      ui.composeFlow = null;
      ui.screen = "dashboard";
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
      }
    };

    const setProjectProvider = (id) => {
      try {
        const cfg = configSafe(root);
        cfg.providers = cfg.providers || {};
        cfg.providers.use = id;
        writeManagerConfig(root, cfg);
        feedPost(root, { from: "manager", text: `project default provider → "${id}" (API key from ~/.atl/providers.json, injected at spawn).` });
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
      if (name === "escape") ui.screen = "dashboard";
      else if (name === "r") refresh();
      else if (name === "a") openProviderWizard();
      else if (name === "up" || name === "k") ui.providerSelected = Math.max(0, ui.providerSelected - 1);
      else if (name === "down" || name === "j") ui.providerSelected = Math.min(Math.max(0, entries.length - 1), ui.providerSelected + 1);
      else if (name === "u" && entries[ui.providerSelected || 0]) setProjectProvider(entries[ui.providerSelected || 0].id);
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
      }
    };

    const submitFromEditor = () => {
      if (!ui.editor) return;
      if (ui.editor.kind === "compose") submitCompose();
      else if (ui.editor.kind === "provider-field") submitProviderField();
      else submitReviewEdit();
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
          throw new Error(`${entry.label} intake is disabled — set intake.${sourceKey === "g" ? "github" : "azure"}.enabled = true in config/manager.json${sourceKey === "a" ? " and put the PAT in the environment" : ""}`);
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
      ui.screen = "sessions";
    };

    const openLogs = () => {
      ui.logsReturn = ui.screen === "logs" ? ui.logsReturn : ui.screen;
      ui.logsFollow = true;
      ui.logsScroll = 0;
      ui.screen = "logs";
    };

    const drawNow = () => {
      if (closed) return;
      const width = Math.max(60, process.stdout.columns || 120);
      const height = Math.max(14, process.stdout.rows || 34);
      let output;
      if (ui.editor) output = renderEditorScreen(ui, width, height, plain);
      else if (ui.screen === "compose") output = renderComposeScreen(ui, width, height, plain);
      else if (ui.screen === "import") output = renderImportScreen(ui, width, height, plain);
      else if (ui.screen === "review") output = renderReviewScreen(ui.snapshot, ui, width, height, plain);
      else if (ui.screen === "queue") output = renderQueueScreen(ui.snapshot, ui, width, height, plain);
      else if (ui.screen === "launch") output = renderLaunchPreviewScreen(ui, width, height, plain);
      else if (ui.screen === "run") output = renderRunScreen(ui, width, height, plain);
      else if (ui.screen === "providers") output = renderProvidersScreen(ui.snapshot, ui, width, height, plain);
      else if (ui.screen === "sessions") output = renderSessionsScreen(ui, width, height, plain);
      else if (ui.screen === "logs") output = renderLogsScreen(ui.snapshot, ui, width, height, plain);
      else if (ui.screen === "file") output = renderFileView(ui.view, width, height, plain);
      else if (ui.screen === "feed") output = renderFeedView(ui.snapshot, width, height, ui.feedScroll, plain);
      else if (ui.screen === "help") output = renderHelp(width, height, plain);
      else output = renderDashboard(ui.snapshot, { width, height, plain, loading: ui.loading, spinner: ui.spinner, selected: ui.selected, feedScroll: ui.feedScroll, syncedAt: ui.lastSyncAt });
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
      readline.cursorTo(process.stdout, 0, 0);
      readline.clearScreenDown(process.stdout);
      process.stdout.write("\x1b[?25l" + stableFrame.join("\n"));
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
        ui.runLogTail = tailFileLines(ui.runLogPath, 6);
        draw();
        return;
      }
      if (ui.screen === "run") return; // finished run screen is static until r
      if (tickCount % 2 !== 0) return; // ~2s cadence when idle
      const before = lastSignature;
      refreshSnapshot();
      if (ui.screen === "sessions") ui.sessions = scanSessions(root);
      if (ui.screen === "launch" || ui.screen === "queue") openLaunchPlan();
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
      process.stdin.removeListener("data", onMouseData);
      process.stdout.removeListener("resize", draw);
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

    const selectTask = (index) => {
      const max = Math.max(0, ui.snapshot.tasks.length - 1);
      const next = Math.max(0, Math.min(max, index));
      if (next !== ui.selected) {
        ui.selected = next;
        ui.taskScroll = 0;
      }
    };

    const PANEL_ORDER = ["portfolio", "task", "feed"];
    const cyclePanelFocus = (step) => {
      const at = Math.max(0, PANEL_ORDER.indexOf(ui.panelFocus));
      ui.panelFocus = PANEL_ORDER[(at + (step < 0 ? PANEL_ORDER.length - 1 : 1)) % PANEL_ORDER.length];
    };

    // Pane-aware scrolling for the dashboard. Wheel events name the hovered
    // pane; keyboard events act on ui.panelFocus (Tab cycles it).
    const scrollDashboard = (delta, panelName = null) => {
      ui.panelFocus = panelName || ui.panelFocus;
      if (ui.panelFocus === "portfolio") {
        // One task per wheel notch; a wheel delta of 3 is still one notch.
        const notch = delta > 0 ? Math.ceil(delta / 3) : -Math.ceil(-delta / 3);
        selectTask(ui.selected + notch);
      } else if (ui.panelFocus === "task") {
        const width = Math.max(60, process.stdout.columns || 120);
        const height = Math.max(14, process.stdout.rows || 34);
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
      const text = String(chunk);
      for (const match of text.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([mM])/g)) {
        const button = Number(match[1]);
        if (!(button & 64)) continue;
        const delta = button === 64 ? -3 : 3;
        if (ui.screen !== "dashboard") {
          moveScroll(delta);
          continue;
        }
        // The wheel scrolls the pane under the mouse; SGR events carry the
        // 1-based column. Narrow layouts have no side-by-side panes, so the
        // wheel falls back to the Tab-focused pane there.
        const width = Math.max(60, process.stdout.columns || 120);
        const hovered = width >= 105 ? panelFromColumn(width, Number(match[2]) - 1) : null;
        scrollDashboard(delta, hovered);
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

    function onKey(_input, key = {}) {
      // Mouse tracking is delivered through stdin as an escape sequence and
      // must never leak into the text editor or into task shortcuts.
      if (typeof _input === "string" && /\x1b\[<\d+;\d+;\d+[mM]/.test(_input)) return;
      const name = key.name || _input;
      if (key.ctrl && name === "c") {
        if (ui.running) {
          ui.notice = "A confirmed queue run is still in progress; wait for the run screen to finish.";
          draw();
          return;
        }
        return close();
      }
      if (ui.editor) {
        handleEditorKey(_input, key);
        draw();
        return;
      }
      if (name === "q" && !key.shift) {
        if (ui.running) {
          ui.notice = "A confirmed queue run is still in progress; wait for the run screen to finish.";
          draw();
          return;
        }
        return close();
      }
      // Shift+L opens the LOGS stream from any screen (including mid-run);
      // the previous screen is restored with Esc.
      if (name === "l" && key.shift) {
        openLogs();
        draw();
        return;
      }
      ui.error = null;
      ui.notice = null;
      if (ui.screen === "dashboard") {
        if (name === "escape" && key.ctrl) return close();
        if (name === "tab") {
          cyclePanelFocus(key.shift ? -1 : 1);
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
            ui.screen = "file";
          }
        } else if (name === "c") {
          openCompose();
        } else if (name === "i") {
          ui.screen = "import";
          ui.importState = null;
        } else if (name === "v") {
          const task = ui.snapshot.tasks[ui.selected];
          if (task) {
            ui.reviewTaskId = task.id;
            ui.reviewDigit = null;
            ui.screen = "review";
          }
        } else if (name === "x") {
          const task = ui.snapshot.tasks[ui.selected];
          if (task) toggleQueue(task.id);
        } else if (name === "e") {
          const task = ui.snapshot.tasks[ui.selected];
          if (task) {
            ui.reviewTaskId = task.id;
            ui.reviewDigit = null;
            ui.screen = "review";
          }
        } else if (name === "a") {
          openResourceEditor(ui.snapshot.tasks[ui.selected]);
        } else if (name === "u") {
          openRecoveryEditor(ui.snapshot.tasks[ui.selected]);
        } else if (name === "l" && !key.shift) {
          openLaunchPlan();
          ui.screen = "launch";
        } else if (name === "q" && key.shift) {
          openLaunchPlan();
          ui.screen = "queue";
        } else if (name === "p") {
          ui.screen = "providers";
        } else if (name === "s") {
          openSessions();
        } else if (name === "f") ui.screen = "feed";
        else if (name === "?") ui.screen = "help";
        else if (name === "r") refresh();
        draw();
      } else if (ui.screen === "compose") {
        const flow = ui.composeFlow;
        if (!flow) {
          ui.screen = "dashboard";
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
          ui.screen = "dashboard";
          draw();
          return;
        }
        if (name === "escape") {
          ui.screen = "dashboard";
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
        const items = (ui.launchPlan && ui.launchPlan.items) || [];
        if (name === "escape") ui.screen = "dashboard";
        else if (name === "up" || name === "k") ui.queueSelected = Math.max(0, ui.queueSelected - 1);
        else if (name === "down" || name === "j") ui.queueSelected = Math.min(Math.max(0, items.length - 1), ui.queueSelected + 1);
        else if (name === "d" && items[ui.queueSelected]) {
          const victim = items[ui.queueSelected].taskId;
          queueRemove(root, victim);
          feedPost(root, { from: "manager", text: `${victim} removed from the execution queue.`, task: victim });
          refreshSnapshot();
          openLaunchPlan();
        } else if (name === "l") ui.screen = "launch";
        draw();
      } else if (ui.screen === "launch") {
        if (name === "escape") ui.screen = "dashboard";
        else if (name === "r") openLaunchPlan();
        else if (name === "return" || name === "y") runQueuedLaunch();
        draw();
      } else if (ui.screen === "run") {
        if (name === "escape" && !ui.running) ui.screen = "dashboard";
        else if (name === "r" && !ui.running) {
          refreshSnapshot();
          openLaunchPlan();
        }
        draw();
      } else if (ui.screen === "providers") {
        handleProvidersKey(name);
        draw();
      } else if (ui.screen === "sessions") {
        const sessions = ui.sessions || [];
        if (name === "escape") ui.screen = "dashboard";
        else if (name === "up" || name === "k") ui.sessionsSelected = Math.max(0, ui.sessionsSelected - 1);
        else if (name === "down" || name === "j") ui.sessionsSelected = Math.min(Math.max(0, sessions.length - 1), ui.sessionsSelected + 1);
        else if (name === "return" && sessions[ui.sessionsSelected]) {
          const s = sessions[ui.sessionsSelected];
          try {
            const lines = fs.readFileSync(s.file, "utf8").split(/\r?\n/);
            const rows = Math.max(4, (process.stdout.rows || 34) - 7);
            // Provider transcripts grow at the end: open at the latest output.
            ui.view = { root, taskId: s.taskId, filePath: s.file, lines, scroll: Math.max(0, lines.length - rows), error: null };
            ui.screen = "file";
          } catch (error) {
            ui.error = error.message;
          }
        }
        draw();
      } else if (ui.screen === "logs") {
        if (name === "escape") ui.screen = ui.logsReturn || "dashboard";
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
          ui.screen = "dashboard";
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
        if (name === "escape") ui.screen = "dashboard";
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
        if (name === "escape") ui.screen = "dashboard";
        else if (name === "up" || name === "k") moveScroll(-1);
        else if (name === "down" || name === "j") moveScroll(1);
        else if (name === "pageup") moveScroll(-10);
        else if (name === "pagedown") moveScroll(10);
        else if (name === "r") refresh();
        draw();
      } else if (ui.screen === "help" && (name === "escape" || name === "?")) {
        ui.screen = "dashboard";
        draw();
      }
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKey);
    process.stdin.on("data", onMouseData);
    process.stdout.on("resize", draw);
    process.once("SIGINT", close);
    // SGR mouse wheel events make the narrow feed panel usable without
    // forcing the user into a separate screen. They are disabled on close.
    process.stdout.write("\x1b[?1000h\x1b[?1006h");
    ui.loading = false;
    lastSignature = signatureOf(ui.snapshot);
    draw();
  });
}
