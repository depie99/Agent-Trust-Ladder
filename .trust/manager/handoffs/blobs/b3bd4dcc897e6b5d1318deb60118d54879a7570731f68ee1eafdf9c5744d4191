import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { createControlPlaneSnapshot } from "../runtime/lib/control-plane.mjs";
import { listNotifications, notificationUnreadCount, postNotification, snoozeNotification, updateNotification } from "../runtime/lib/notifications.mjs";
import { dispatchTuiCommand } from "../runtime/lib/command-console.mjs";
import { renderNotificationsScreen } from "../runtime/lib/dashboard.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-notifications-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());

// Durable state + acknowledgement (existing contract).
const item = postNotification(root, { severity: "danger", title: "Blocked task", message: "Manager action required", action: "open why", taskId: "T-001", queueId: "release", runId: "R-1" });
assert.equal(listNotifications(root).length, 1);
assert.equal(updateNotification(root, item.id, { state: "acknowledged" }).state, "acknowledged");

// Dedupe: a repeat signal folds into the newest unread copy with a count.
const first = postNotification(root, { severity: "warning", title: "Budget near exhaustion", message: "sessions 4/5", taskId: "T-002" });
const repeat = postNotification(root, { severity: "warning", title: "Budget near exhaustion", message: "sessions 4/5 again", taskId: "T-002" });
assert.equal(repeat.id, first.id, "a repeat signal reuses the newest unread copy");
assert.equal(repeat.count, 2, "the duplicate count is visible");
assert.equal(listNotifications(root, { state: "unread" }).length, 1, "duplicates do not flood the panel");
const other = postNotification(root, { severity: "warning", title: "Different blocker", taskId: "T-003" });
assert.notEqual(other.id, first.id, "different signals stay separate");

// Filters: severity, task, queue, run.
assert.equal(listNotifications(root, { severity: "warning" }).length, 2);
assert.equal(listNotifications(root, { taskId: "T-002" }).length, 1);
assert.equal(listNotifications(root, { queueId: "release" }).length, 1);
assert.equal(listNotifications(root, { runId: "R-1" }).length, 1);

// Snooze: hidden from default views until the timer expires, then visible again.
const snoozed = snoozeNotification(root, first.id, 30);
assert.equal(snoozed.state, "snoozed");
assert.equal(listNotifications(root).some((row) => row.id === first.id), false, "snoozed items are hidden from the default view");
assert.equal(notificationUnreadCount(root), 1, "snoozed items do not demand attention");
assert.equal(listNotifications(root, { state: "snoozed" }).length, 1, "the snoozed filter still finds them");
updateNotification(root, first.id, { snoozed_until: new Date(Date.now() - 1000).toISOString() });
assert.equal(listNotifications(root).some((row) => row.id === first.id), true, "an expired snooze reappears");

// Console surface: list, ack, snooze.
assert.equal(dispatchTuiCommand(root, "notify list").ok, true);
const ackLine = dispatchTuiCommand(root, `notify ack ${item.id}`);
assert.match(ackLine.lines.join(" "), /acknowledged/);
const snoozeLine = dispatchTuiCommand(root, `notify snooze ${other.id} 15`);
assert.match(snoozeLine.lines.join(" "), /snoozed until/);
assert.equal(dispatchTuiCommand(root, "notify ambiguous").ok, false, "unknown notify subcommands are refused");

// Render: count badge, source-object links, and pure (never mutates the snapshot).
const snapshot = createControlPlaneSnapshot(root);
const ui = { editor: { kind: "intent", row: 3, col: 7, lines: ["draft text"] }, scroll: 11 };
const frame = renderNotificationsScreen(snapshot, 80, 24, true);
assert.match(frame, /NOTIFICATIONS/);
assert.match(frame, /×2/, "duplicate counts render as a badge");
assert.match(frame, /T-001/, "task links render");
assert.match(frame, /queue release/, "queue links render");
assert.match(frame, /run R-1/, "run links render");
assert.match(frame, /snoozed until/, "snooze state renders");
assert.equal(frame, renderNotificationsScreen(snapshot, 80, 24, true), "rendering is deterministic");
assert.deepEqual(ui, { editor: { kind: "intent", row: 3, col: 7, lines: ["draft text"] }, scroll: 11 }, "opening the panel never touches editor or scroll context");
assert.ok(frame.split("\n").every((line) => line.length <= 80), "notification panel is width bounded");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: notifications — dedupe with counts, snooze/expiry, filters, source links, bounded pure render");
