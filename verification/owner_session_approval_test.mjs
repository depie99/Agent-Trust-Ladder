import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { ensureOwnerSession } from "../runtime/lib/session-auth.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-owner-session-")); fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true }); saveState(root, emptyState()); const session = ensureOwnerSession(root); const server = await startControlPlaneServer(root); try {
  const shell = await fetch(server.url); assert.equal(shell.status, 200); assert.match(await shell.text(), /atl-csrf/);
  const headers = { origin: new URL(server.url).origin, cookie: `atl_owner=${session.token}`, "content-type": "application/json" };
  const refused = await fetch(`${server.url}api/approvals`, { method: "POST", headers, body: JSON.stringify({ action: "propose", proposal: { project: root, operation: "test" } }) }); assert.equal(refused.status, 403);
  headers["x-atl-csrf"] = session.csrf; const proposed = await fetch(`${server.url}api/approvals`, { method: "POST", headers, body: JSON.stringify({ action: "propose", proposal: { project: root, operation: "test" } }) }).then((r) => r.json()); assert.equal(proposed.ok, true); const denied = await fetch(`${server.url}api/approvals`, { method: "POST", headers, body: JSON.stringify({ action: "decide", proposal_id: proposed.result.id, decision: "deny" }) }).then((r) => r.json()); assert.equal(denied.result.status, "denied");
} finally { await new Promise((resolve) => server.server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); } console.log("PASS: owner cookie, CSRF token, and visible approval decision boundary");
