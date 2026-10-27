import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./fixtures/task-changes/project.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { digest } from "../runtime/lib/task-changes.mjs";

const f = fixture(); f.edit();
const running = await startControlPlaneServer(f.root);
try {
  const page = await fetch(running.url), html = await page.text();
  const cookie = page.headers.get("set-cookie").split(";")[0], csrf = html.match(/name="atl-csrf" content="([^"]+)"/)[1];
  const headers = { cookie, "x-atl-csrf": csrf, "content-type": "application/json" };
  const get = (route) => fetch(`${running.url}${route}`, { headers });
  assert.match(html, /control-plane-changes\.js/);
  assert.equal((await fetch(`${running.url}api/task-changes?taskId=T-001`)).status, 403);
  const before = fs.readFileSync(path.join(f.root, ".trust/manager/state.json"), "utf8");
  const empty = await (await get("api/task-changes?taskId=T-001")).json();
  assert.equal(empty.availability, "capture_required");
  assert.equal(fs.existsSync(path.join(f.root, ".trust/manager/change-reviews")), false, "GET does not publish captures");
  const response = await fetch(`${running.url}api/task-changes/capture`, { method: "POST", headers, body: JSON.stringify({ task_id: "T-001" }) });
  const captured = await response.json(); assert.equal(response.status, 200, JSON.stringify(captured));
  assert.equal(captured.status, "blocked"); assert.equal(captured.total_files, 5);
  const diff = await (await get(`api/task-change-diff?taskId=T-001&changeSetId=${captured.id}&fileId=${digest("runtime/example.js")}`)).json();
  assert.equal(diff.availability, "available"); assert.match(diff.patch, /after/);
  assert.equal((await get(`api/task-change-diff?taskId=T-001&changeSetId=${captured.id}&fileId=foreign`)).status, 404);
  assert.equal((await get("api/task-changes?taskId=T-001&changeSetId=..%2Foutside")).status, 400);
  assert.equal((await get("api/task-changes?taskId=T-999")).status, 404);
  const snapshot = await (await get("api/snapshot")).json();
  assert.doesNotMatch(JSON.stringify(snapshot), /change-reviews|--- a\/|const message = 'after'/, "periodic snapshot carries no source patch");
  const refused = await fetch(`${running.url}api/task-changes/capture`, { method: "POST", headers: { ...headers, origin: "https://foreign.example" }, body: JSON.stringify({ task_id: "T-001" }) });
  assert.equal(refused.status, 403);
  assert.equal(fs.readFileSync(path.join(f.root, ".trust/manager/state.json"), "utf8"), before);
} finally { await new Promise((resolve) => running.server.close(resolve)); f.cleanup(); }
console.log("PASS: task changes API — owner protection, lazy reads, capture and pinned diffs");
