import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserAccess, browserAccessPolicy, saveBrowserAccess } from "../runtime/lib/browser-access.mjs";
import { probeUiReviewRuntime, uiReviewProviderArgs, UI_BROWSER_TOOLS } from "../runtime/lib/ui-review-runtime.mjs";
import { emptyState, saveState, loadState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-browser-access-"));
try {
  const state = emptyState();
  for (const id of ["T-001", "T-002"]) state.tasks[id] = { id, title: "Browser access", status: "blocked", completion_checks: ["rendered check"], evidence: [], execution_budget: { used: 2, max_sessions: 4 }, recovery: { status: "exhausted", attempts: [] } };
  saveState(root, state);
  const initialState = JSON.stringify(loadState(root));
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config/manager.json"), JSON.stringify({ navigation: { mode: "on" }, execution_access: { default: "read-only" }, providers: { use: "gapgpt" } }));
  assert.equal(browserAccess(root).mode, "approval-required");
  saveBrowserAccess(root, { task: "T-001", mode: "approved" });
  assert.equal(browserAccess(root, "T-001").mode, "approved");
  assert.equal(browserAccess(root, "T-002").mode, "approval-required");
  assert.equal(probeUiReviewRuntime(root, root, { taskId: "T-001" }).localToolsApproved, true);
  assert.equal(probeUiReviewRuntime(root, root, { taskId: "T-002" }).localToolsApproved, false);
  const approved = { ...probeUiReviewRuntime(root, root, { taskId: "T-001" }), available: true };
  for (const provider of ["codex", "gapgpt"]) {
    const args = uiReviewProviderArgs(provider, approved).join(" ");
    for (const name of UI_BROWSER_TOOLS) assert.ok(args.includes(`${name}={approval_mode="approve"}`));
    assert.doesNotMatch(args, /approval_policy|default_tools_approval_mode|dangerously/);
  }
  saveBrowserAccess(root, { mode: "approved" });
  saveBrowserAccess(root, { task: "T-001", mode: "approval-required" });
  assert.equal(browserAccess(root, "T-001").mode, "approval-required", "task restriction overrides a permissive default");
  assert.equal(browserAccess(root, "T-002").mode, "approved");
  saveBrowserAccess(root, { task: "T-001", mode: "inherit" });
  assert.equal(browserAccess(root, "T-001").source, "project");
  assert.throws(() => saveBrowserAccess(root, { mode: "all-tools" }), /Choose/);
  assert.throws(() => saveBrowserAccess(root, { mode: "inherit" }), /Choose/);
  assert.throws(() => saveBrowserAccess(root, { task: "T-999", mode: "approved" }), /Task not found/);
  assert.throws(() => saveBrowserAccess(root, { task: "__proto__", mode: "approved" }), /Task not found/);
  const config = JSON.parse(fs.readFileSync(path.join(root, "config/manager.json")));
  assert.equal(config.navigation.mode, "on");
  assert.equal(config.execution_access.default, "read-only");
  assert.equal(config.providers.use, "gapgpt");
  assert.equal(JSON.stringify(loadState(root)), initialState, "permissions do not reset budgets, recovery, task state or evidence");

  const running = await startControlPlaneServer(root);
  try {
    const origin = running.url.slice(0, -1);
    const post = (payload, headers = {}) => fetch(`${running.url}api/browser-access`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
    assert.equal((await fetch(`${running.url}api/browser-access?task=T-001`).then((r) => r.json())).access.mode, "approved");
    assert.equal((await post({ action: "save", mode: "approval-required" }, { origin: "http://other.invalid" })).status, 403);
    assert.equal((await post({ action: "save", mode: "approval-required" }, { origin })).status, 403);
    const shell = await fetch(running.url);
    const cookie = shell.headers.get("set-cookie").split(";")[0];
    const csrf = (await shell.text()).match(/name="atl-csrf" content="([^"]+)"/)[1];
    const owner = { origin, cookie, "x-atl-csrf": csrf };
    assert.equal((await post({ action: "save", task: "T-001", mode: "approval-required" }, owner)).status, 200);
    assert.equal(browserAccess(root, "T-001").mode, "approval-required");
    assert.equal((await post({ action: "save", task: "T-001", mode: "approved" }, { ...owner, "x-atl-csrf": "bad" })).status, 403);
    assert.equal(browserAccess(root, "T-001").mode, "approval-required");
    assert.equal((await post({ action: "save", task: "T-001", mode: "inherit" }, owner)).status, 200);
    assert.equal((await post({ action: "save", mode: "all-tools" }, owner)).status, 400);
    assert.equal((await post({ action: "save", task: "T-999", mode: "approved" }, owner)).status, 400);
    assert.equal((await post({ action: "check", task: "T-001" }, owner)).status, 400, "a missing task workspace cannot launch a check");
    const snapshot = await fetch(`${running.url}api/snapshot`).then((r) => r.json());
    assert.deepEqual(snapshot.browser_access, browserAccessPolicy(root));
    assert.equal(JSON.stringify(loadState(root)), initialState);
  } finally { await new Promise((resolve) => running.server.close(resolve)); }
  // Legacy owner authorization remains readable before a UI policy is saved.
  fs.writeFileSync(path.join(root, "config/manager.json"), JSON.stringify({ ui_review: { local_browser_tools_approved: true } }));
  assert.equal(browserAccess(root).mode, "approved");
  saveBrowserAccess(root, { mode: "approval-required" });
  assert.equal(browserAccess(root).mode, "approval-required", "new UI policy takes precedence over the legacy flag");
  console.log("PASS: browser project/task inheritance, scoped provider approvals, owner/CSRF API, snapshot and budget/state preservation");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
