import fs from "node:fs";
import path from "node:path";
import { paths } from "./state.mjs";

export const NOTIFICATION_VERSION = 1;

function fileFor(root) {
  return paths(root).notifications;
}

function normalize(item) {
  return {
    id: item.id || `N-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: NOTIFICATION_VERSION,
    at: item.at || new Date().toISOString(),
    severity: item.severity || "info",
    title: item.title || "ATL notification",
    message: item.message || "",
    source: item.source || null,
    taskId: item.taskId || null,
    queueId: item.queueId || null,
    runId: item.runId || null,
    action: item.action || null,
    state: item.state || "unread",
    snoozed_until: item.snoozed_until || null,
    count: Number.isFinite(Number(item.count)) && item.count != null ? Number(item.count) : 1,
  };
}

function identity(item) {
  return `${item.severity}|${item.title}|${item.taskId || ""}|${item.queueId || ""}|${item.runId || ""}`;
}

export function listNotifications(root, { state = null, severity = null, taskId = null, queueId = null, runId = null, limit = 100, includeSnoozed = false } = {}) {
  const file = fileFor(root);
  if (!fs.existsSync(file)) return [];
  const rows = [];
  const now = Date.now();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = normalize(JSON.parse(line));
      if (state && item.state !== state) continue;
      // Default views hide snoozed items until their timer expires; the
      // explicit "snoozed" filter still finds them for management.
      if (!state && !includeSnoozed && item.state === "snoozed" && item.snoozed_until && new Date(item.snoozed_until).getTime() > now) continue;
      if (severity && item.severity !== severity) continue;
      if (taskId && item.taskId !== taskId) continue;
      if (queueId && item.queueId !== queueId) continue;
      if (runId && item.runId !== runId) continue;
      rows.push(item);
    } catch {
      // A malformed notification must not take down the control room.
    }
  }
  return rows.slice(-Math.max(1, Number(limit) || 100)).reverse();
}

export function postNotification(root, item, { dedupe = true, window = 10 * 60000 } = {}) {
  const file = fileFor(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = normalize(item);
  if (dedupe) {
    // Repeat signals (same severity/title/source object) fold into the
    // newest unread copy with a count instead of flooding the panel.
    const rows = listNotifications(root, { state: "unread", limit: 5000, includeSnoozed: true }).reverse();
    const twin = rows.find((row) => identity(row) === identity(normalized) && new Date(row.at).getTime() >= Date.now() - window);
    if (twin) {
      return updateNotification(root, twin.id, { at: normalized.at, count: (twin.count || 1) + 1, message: normalized.message || twin.message });
    }
  }
  fs.appendFileSync(file, JSON.stringify(normalized) + "\n");
  return normalized;
}

export function updateNotification(root, id, patch) {
  const file = fileFor(root);
  const rows = listNotifications(root, { limit: 5000, includeSnoozed: true }).reverse();
  const index = rows.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Unknown notification "${id}"`);
  rows[index] = normalize({ ...rows[index], ...patch, id });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((item) => JSON.stringify(item)).join("\n") + "\n");
  return rows[index];
}

export function snoozeNotification(root, id, minutes = 30) {
  const until = new Date(Date.now() + Math.max(1, Number(minutes) || 30) * 60000).toISOString();
  return updateNotification(root, id, { state: "snoozed", snoozed_until: until });
}

export function notificationUnreadCount(root) {
  return listNotifications(root, { state: "unread", limit: 5000 }).length;
}
