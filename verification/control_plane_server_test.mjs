import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { addClaim } from "../runtime/lib/brain.mjs";
import { validateOwnerSession } from "../runtime/lib/session-auth.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-control-plane-server-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());
const pendingClaim = addClaim(root, { text: "Control Plane approval test", source_id: "source-ui", source_content: "evidence" }).claim;
const running = await startControlPlaneServer(root);
try {
  const boot = await fetch(running.url);
  const html = await boot.text();
  const ownerCookie = boot.headers.get("set-cookie")?.split(";")[0] || "";
  const csrfToken = html.match(/name="atl-csrf" content="([^"]+)"/)?.[1] || "";
  assert.ok(ownerCookie.startsWith("atl_owner="), "page boot provides the owner session used for protected reads");
  assert.ok(csrfToken, "page boot provides the CSRF value paired with the owner session");
  assert.equal(validateOwnerSession(root, decodeURIComponent(ownerCookie.slice("atl_owner=".length)), csrfToken), true, "boot session token and CSRF pair validate on the owning project");
  const snapshotResponse = await fetch(`${running.url}api/snapshot`, { headers: { cookie: ownerCookie, "x-atl-csrf": csrfToken } });
  assert.equal(snapshotResponse.status, 200, `owner can read its snapshot: ${await snapshotResponse.clone().text()}`);
  const snapshot = await snapshotResponse.json();
  assert.match(html, /id="navA"/, "served artifact keeps the reference sidebar mount");
  assert.match(html, /<\/header><div id="mobile"/, "live shell closes the flex topbar before page content");
  assert.doesNotMatch(html, /ATL CLI demo ready/, "stale inline demo controller is not served beside the live client");
  assert.equal((html.match(/<script src="\.\/control-plane-client\.js"><\/script>/g) || []).length, 1, "served artifact has one live controller");
  assert.doesNotMatch(html, /Interactive mock/, "served surface does not carry the artifact's offline mock banner");
  assert.match(html, new RegExp(`Live - connected to ${path.basename(root)}<`), "served footer names the connected workspace");
  assert.doesNotMatch(html, /INTERACTIVE DEMO/, "served topbar does not advertise demo mode");
  assert.doesNotMatch(html, /Developer Control Plane Prototype/, "served title is production-ready");
  assert.doesNotMatch(html, /<span class="amber">3<\/span>/, "static demo unread count is removed");
  // The artifact itself ships without demo residue (#60): the served rewrites
  // fill neutral slots instead of stripping demo markers.
  const artifact = fs.readFileSync(new URL("../runtime/control-plane.html", import.meta.url), "utf8");
  for (const marker of [/Interactive mock/, /INTERACTIVE DEMO/, /ATL CLI demo ready/, /control-plane \/ demo/]) {
    assert.doesNotMatch(artifact, marker, `the shipped artifact carries no demo residue: ${marker}`);
  }
  assert.match(artifact, /data-ws-name/, "the artifact keeps the workspace-name slot for the served rewrite");

  // The live HTML rewrite must fail closed if an artifact carries more than
  // one copy of a slot the server fills.
  const driftDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-html-contract-"));
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-html-project-"));
  fs.mkdirSync(path.join(driftRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(driftRoot, "config", "manager.json"), JSON.stringify({ version: 1 }));
  saveState(driftRoot, emptyState());
  const liveLabel = artifact.match(/<span data-live-label>[\s\S]*?<\/span>/)?.[0];
  assert.ok(liveLabel, "fixture finds the live-label slot");
  fs.writeFileSync(path.join(driftDir, "control-plane.html"), artifact.replace(liveLabel, `${liveLabel}${liveLabel}`));
  const drift = await startControlPlaneServer(driftRoot, { assetRoot: driftDir });
  try {
    const response = await fetch(drift.url);
    assert.equal(response.status, 500, "duplicate live-label slot is rejected at render time");
    assert.match(await response.text(), /expected one live label marker/);
  } finally {
    await new Promise((resolve) => drift.server.close(resolve));
    fs.rmSync(driftDir, { recursive: true, force: true });
    fs.rmSync(driftRoot, { recursive: true, force: true });
  }

  const client = await fetch(`${running.url}control-plane-client.js`).then((response) => response.text());
  assert.match(client, /let studioGoal = ""/, "Plan Studio preserves a user's in-progress objective across snapshot refreshes");
  assert.match(client, /selectedTaskId/, "task creation uses the API-returned id instead of a title lookup");
  assert.doesNotMatch(client, /stopImmediatePropagation/, "the live client does not suppress native input and click propagation");
  assert.match(client, /data-page/, "live client owns page navigation");
  assert.match(client, /\/api\/command/, "live client uses the ATL command bridge");
  assert.match(client, /Run active queue/, "browser exposes queue execution without a terminal handoff");
  assert.match(client, /Generate local skeleton/, "browser exposes the deterministic local skeleton flow (never approvable without a model plan)");
  assert.match(client, /plan_skeleton/, "the client renders local skeletons as structure-only previews");
  assert.match(client, /Generate with model/, "browser exposes the provider-backed planning mode");
  assert.match(client, /task-delete-confirm:/, "task deletion is available through a confirmed, recoverable archive action");
  assert.match(client, /queue-clear-confirm:/, "queues expose a confirmed clear action");
  assert.match(client, /Reset default queue/, "the protected default queue can be reset without being deleted");
  assert.match(client, /Review selected/, "multi-queue actions stay contextual instead of occupying the page header");
  assert.match(client, /Codebase map/i, "Settings exposes the token-efficient navigation controls");
  assert.match(client, /navigation-save/, "Settings has an explicit save action for navigation configuration");
  assert.match(client, /usage-refresh/, "Usage page can request a provider telemetry refresh");
  assert.match(client, /Provider telemetry verified/, "Usage page distinguishes provider-verified telemetry from local observations");
  assert.match(client, /program\.milestones \|\| \[\]/, "overnight operations expose durable multi-project program milestones");
  assert.match(client, /sessions used/, "overnight programs expose their session budget in the operations workspace");
  assert.match(client, /Save connection/, "sidebar provider modal exposes one save path for current connection settings");
  assert.match(client, /data-pm-current-thinking/, "sidebar provider modal exposes current-provider thinking/effort");
  assert.match(client, /data-pm-current-key/, "sidebar provider modal exposes safe API-key replacement");
  assert.match(client, /The objective now lives on the draft/, "Plan Studio keeps the objective auditable on the draft after generation");
  assert.match(client, /unresolvedQuestionCount/, "Plan Studio tracks unresolved draft questions and surfaces the answer debt");
  assert.match(client, /open_questions/, "Plan Studio keeps the draft's open questions auditable beside the plan");
  assert.match(client, /value === "studio-clear"/, "Plan Studio retains an explicit user-controlled clear action");
  assert.match(client, /class="task-controls"/, "task rows group status, ownership, and actions in one control region");
  assert.match(client, /class="task-prop-key">Assigned to/, "task ownership is explicitly labelled in task properties");
  assert.match(client, /class="task-actions"/, "task actions have a distinct visual group");
  assert.match(client, /WORKSPACE \/ KNOWLEDGE/, "Control Plane exposes the Knowledge workspace");
  assert.match(client, /brain-approve:/, "claim approval is available in the primary UI");
  assert.match(client, /brain-skill-form/, "skill validation and promotion are available in the primary UI");
  assert.match(client, /brain-routine-form/, "routine registration is available in the primary UI");

  const health = await fetch(`${running.url}api/health`).then((response) => response.json());
  assert.equal(health.ok, true, "control-plane health is available");
  const navigation = await fetch(`${running.url}api/navigation`).then((response) => response.json());
  assert.equal(navigation.navigation.mode, "off", "navigation defaults safely off");
  const updatedNavigation = await fetch(`${running.url}api/navigation`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "on", max_tokens: 1200, build_on_launch: true }),
  }).then((response) => response.json());
  assert.deepEqual(updatedNavigation.navigation, { mode: "on", max_tokens: 1200, build_on_launch: true }, "browser saves validated navigation settings atomically");
  assert.equal(snapshot.version, 1, "browser receives the versioned ATL snapshot");
  assert.equal(snapshot.brain.claims.length, 1, "browser snapshot includes evidence-linked claims");
  const approved = await fetch(`${running.url}api/brain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve-claim", claim_id: pendingClaim.claim_id, note: "UI test" }) }).then((response) => response.json());
  assert.equal(approved.result.status, "VERIFIED", "browser manager can approve a non-conflicted claim");
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
  const queuedResponse = await fetch(`${running.url}api/snapshot`, { headers: { cookie: ownerCookie, "x-atl-csrf": csrfToken } });
  assert.equal(queuedResponse.status, 200, `owner can read updated snapshot: ${await queuedResponse.clone().text()}`);
  const queuedSnapshot = await queuedResponse.json();
  assert.ok(queuedSnapshot.queues.items.find((queue) => queue.id === "default").items.some((item) => item.id === created.selectedTaskId), "queued browser task appears in the live snapshot");
  const cleared = await fetch(`${running.url}api/command`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "queue clear --queue default" }),
  }).then((response) => response.json());
  assert.equal(cleared.ok, true, "the protected default queue can be reset through the browser command bridge");
  const clearedSnapshot = await fetch(`${running.url}api/snapshot`, { headers: { cookie: ownerCookie, "x-atl-csrf": csrfToken } }).then((response) => response.json());
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
