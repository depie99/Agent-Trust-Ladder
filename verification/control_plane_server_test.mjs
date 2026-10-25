import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-control-plane-server-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());
const running = await startControlPlaneServer(root);
try {
  const html = await fetch(running.url).then((response) => response.text());
  assert.match(html, /id="navA"/, "served artifact keeps the reference sidebar mount");
  assert.match(html, /<\/header><div id="mobile"/, "live shell closes the flex topbar before page content");
  assert.doesNotMatch(html, /ATL CLI demo ready/, "stale inline demo controller is not served beside the live client");
  assert.equal((html.match(/<script src="\.\/control-plane-client\.js"><\/script>/g) || []).length, 1, "served artifact has one live controller");
  assert.doesNotMatch(html, /Interactive mock/, "served surface does not carry the artifact's offline mock banner");
  assert.match(html, new RegExp(`Live · connected to ${path.basename(root)}<`), "served footer names the connected workspace");
  assert.doesNotMatch(html, /INTERACTIVE DEMO/, "served topbar does not advertise demo mode");
  assert.match(fs.readFileSync(new URL("../runtime/control-plane.html", import.meta.url), "utf8"), /Interactive mock/, "the standalone artifact keeps its honest mock banner");

  const client = await fetch(`${running.url}control-plane-client.js`).then((response) => response.text());
  assert.match(client, /let studioGoal = ""/, "Plan Studio preserves a user's in-progress objective across snapshot refreshes");
  assert.match(client, /selectedTaskId/, "task creation uses the API-returned id instead of a title lookup");
  assert.doesNotMatch(client, /stopImmediatePropagation/, "the live client does not suppress native input and click propagation");
  assert.match(client, /data-page/, "live client owns page navigation");
  assert.match(client, /\/api\/command/, "live client uses the ATL command bridge");
  assert.match(client, /Run active queue/, "browser exposes queue execution without a terminal handoff");
  assert.match(client, /Generate local preview/, "browser exposes the deterministic local planning flow");
  assert.match(client, /Generate with model/, "browser exposes the provider-backed planning mode");
  assert.match(client, /task-delete-confirm:/, "task deletion is available through a confirmed, recoverable archive action");
  assert.match(client, /queue-clear-confirm:/, "queues expose a confirmed clear action");
  assert.match(client, /Reset default queue/, "the protected default queue can be reset without being deleted");
  assert.match(client, /Review selected/, "multi-queue actions stay contextual instead of occupying the page header");
  assert.match(client, /Codebase navigation/, "Settings exposes the token-efficient navigation controls");
  assert.match(client, /navigation-save/, "Settings has an explicit save action for navigation configuration");
  assert.match(client, /usage-refresh/, "Usage page can request a provider telemetry refresh");
  assert.match(client, /Provider telemetry verified/, "Usage page distinguishes provider-verified telemetry from local observations");
  assert.match(client, /Save connection/, "sidebar provider modal exposes one save path for current connection settings");
  assert.match(client, /data-pm-current-thinking/, "sidebar provider modal exposes current-provider thinking/effort");
  assert.match(client, /data-pm-current-key/, "sidebar provider modal exposes safe API-key replacement");

  const health = await fetch(`${running.url}api/health`).then((response) => response.json());
  assert.equal(health.ok, true, "control-plane health is available");
  const navigation = await fetch(`${running.url}api/navigation`).then((response) => response.json());
  assert.equal(navigation.navigation.mode, "off", "navigation defaults safely off");
  const updatedNavigation = await fetch(`${running.url}api/navigation`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "on", max_tokens: 1200, build_on_launch: true }),
  }).then((response) => response.json());
  assert.deepEqual(updatedNavigation.navigation, { mode: "on", max_tokens: 1200, build_on_launch: true }, "browser saves validated navigation settings atomically");
  const snapshot = await fetch(`${running.url}api/snapshot`).then((response) => response.json());
  assert.equal(snapshot.version, 1, "browser receives the versioned ATL snapshot");
  const command = await fetch(`${running.url}api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "queue list" }),
  }).then((response) => response.json());
  assert.equal(command.ok, true, "browser command bridge executes an allowlisted ATL command");
  const created = await fetch(`${running.url}api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: 'task create --title "Queue from browser" --priority normal' }),
  }).then((response) => response.json());
  assert.equal(created.ok, true, `task creation succeeds: ${JSON.stringify(created)}`);
  assert.ok(created.selectedTaskId, `task creation returns its authoritative id to the browser: ${JSON.stringify(created)}`);
  const queued = await fetch(`${running.url}api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: `queue add ${created.selectedTaskId} --queue default` }),
  }).then((response) => response.json());
  assert.equal(queued.ok, true, "browser can persist queue membership for the created task");
  const queuedSnapshot = await fetch(`${running.url}api/snapshot`).then((response) => response.json());
  assert.ok(queuedSnapshot.queues.items.find((queue) => queue.id === "default").items.some((item) => item.id === created.selectedTaskId), "queued browser task appears in the live snapshot");
  const cleared = await fetch(`${running.url}api/command`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "queue clear --queue default" }),
  }).then((response) => response.json());
  assert.equal(cleared.ok, true, "the protected default queue can be reset through the browser command bridge");
  const clearedSnapshot = await fetch(`${running.url}api/snapshot`).then((response) => response.json());
  assert.equal(clearedSnapshot.queues.items.find((queue) => queue.id === "default").items.length, 0, "resetting default removes queue membership");
  assert.ok(clearedSnapshot.state.tasks[created.selectedTaskId], "resetting default keeps the task itself intact");
  const idleRun = await fetch(`${running.url}api/run`).then((response) => response.json());
  assert.equal(idleRun.status, "idle", "browser exposes truthful run status before execution");
  const refusedRun = await fetch(`${running.url}api/run`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: false }),
  });
  assert.equal(refusedRun.status, 400, "browser queue execution refuses missing confirmation");
} finally {
  await new Promise((resolve) => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS: control-plane server — reference shell, single controller, live snapshot and command bridge");
