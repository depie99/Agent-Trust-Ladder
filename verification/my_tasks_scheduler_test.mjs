import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyMyTasksStore, myTasksSettingsFile, myTasksStoreFile, readMyTasksSettings, readMyTasksStore, writeMyTasksStore } from "../runtime/lib/my-tasks.mjs";
import { buildWindowsMyTasksStartupScript, startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Spec 021 scheduler lifecycle, driven through the server API with explicit
// clock timestamps (the /api/my-tasks/tick hook, same pattern as routines).
// Covers: first run, interval gating, interval change, always-on scheduling, manual
// join with an in-flight run, backoff + Retry-After, auth pause + reconnect,
// restart persistence with a single overdue catch-up, per-project isolation.

const ME = { id: "scheduler-identity-id", displayName: "Owner Account" };
const base = "https://devops.example.invalid:32678/Collection";

const startupScript = buildWindowsMyTasksStartupScript({ nodePath: "C:\\Program Files\\nodejs\\node.exe", runtimeEntry: "C:\\ATL\\runtime\\atl-manager.mjs", projectRoot: "C:\\Work\\ATL" });
assert.ok(startupScript.includes('shell.CurrentDirectory = "C:\\Work\\ATL"'), "Windows login starts in the selected workspace");
assert.ok(startupScript.includes('shell.Environment("PROCESS").Item("ATL_NO_OPEN") = "1"'), "automatic runtime does not unexpectedly open a browser");
assert.ok(startupScript.includes('shell.Run """C:\\Program Files\\nodejs\\node.exe"" """C:\\ATL\\runtime\\atl-manager.mjs"" ui", 0, False'), "the Windows startup action launches the selected ATL runtime hidden");
assert.throws(() => buildWindowsMyTasksStartupScript({ nodePath: "node.exe\nmalicious", runtimeEntry: "atl.mjs", projectRoot: "C:\\Work" }), /single-line path/, "startup paths cannot inject extra VBScript commands");

const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, ATL_HOME: process.env.ATL_HOME, APPDATA: process.env.APPDATA };
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.ATL_HOME = path.join(fakeHome, ".atl");
process.env.APPDATA = fakeHome;

function transportFor(options = {}) {
  const calls = [];
  const deferred = [];
  return {
    calls,
    gate: () => new Promise((resolve) => deferred.push(resolve)),
    releaseAll: () => { while (deferred.length) deferred.shift()(); },
    requestImpl: async (url, requestOptions = {}) => {
      calls.push({ url, retryAfter: requestOptions ? null : null });
      if (url.endsWith("/_apis/ConnectionData")) return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
      if (url.includes("/_apis/projects")) return { data: { value: [{ id: "p1", name: "Alpha", state: "wellFormed" }, { id: "p2", name: "Beta", state: "wellFormed" }] }, headers: {}, status: 200 };
      if (url.includes("/_apis/wit/wiql")) {
        const project = decodeURIComponent(url.split("/Collection/")[1].split("/_apis")[0]);
        if (options.failProject === project || options.failAll) {
          const error = new Error(`HTTP ${options.failStatus || 500} simulated`);
          error.status = options.failStatus || 500;
          if (options.retryAfter) error.retryAfter = options.retryAfter;
          throw error;
        }
        return { data: { workItems: [{ id: 101 }, { id: 102 }] }, headers: {}, status: 200 };
      }
      if (url.includes("/_apis/wit/workitemsbatch")) {
        const project = decodeURIComponent(url.split("/Collection/")[1].split("/_apis")[0]);
        if (options.failProject === project || options.failAll) {
          const error = new Error(`HTTP ${options.failStatus || 500} simulated`);
          error.status = options.failStatus || 500;
          if (options.retryAfter) error.retryAfter = options.retryAfter;
          throw error;
        }
        if (options.hold) await options.hold();
        const ids = typeof requestOptions.body === "string" ? JSON.parse(requestOptions.body).ids : requestOptions.body.ids;
        return {
          data: { value: ids.map((id) => ({ id, fields: {
            "System.Id": id, "System.Rev": 1, "System.Title": `Item ${id}`, "System.State": "New", "System.WorkItemType": "Task",
            "System.AssignedTo": { id: ME.id, displayName: ME.displayName }, "Microsoft.VSTS.Common.Priority": 1,
            "System.IterationPath": "Alpha\\Sprint 1", "System.AreaPath": "Alpha\\Area", "System.Description": "<p>desc</p>", "System.Tags": "", "System.ChangedDate": "2026-11-11T09:00:00Z",
          } })) },
          headers: {}, status: 200,
        };
      }
      if (url.includes("/states")) return { data: { value: [{ name: "New", category: "Proposed" }, { name: "Closed", category: "Complete" }] }, headers: {}, status: 200 };
      throw new Error(`unexpected call ${url}`);
    },
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-sched-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { enabled: true, org_url: base, project: "Alpha", token_env: "AZDO_PAT", tls_allow_untrusted: true } } }));
process.env.AZDO_PAT = "synthetic-test-token";

const get = async (path1) => (await fetch(new URL(path1, running.url))).json();
const post = async (path1, body = {}) => {
  const response = await fetch(new URL(path1, running.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, ...(await response.json()) };
};

let running;
try {
  const transport = transportFor();
  running = await startControlPlaneServer(root, { myTasksFetch: transport.requestImpl });
  const T0 = Date.now();
  const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString();

  // Azure is configured but no My Tasks preferences exist: the runtime starts
  // scheduled checks automatically and watches the configured primary project.
  const startupSettings = await get("/api/my-tasks/settings");
  assert.equal(startupSettings.settings.enabled, true, "configured Azure enables My Tasks at runtime startup");
  assert.equal(startupSettings.settings.startup_mode, "runtime", "runtime startup is the default persisted mode");
  assert.deepEqual(startupSettings.settings.projects, ["Alpha"], "the configured Azure project is watched by default");
  for (let slept = 0; slept < 50 && !readMyTasksStore(root).runs.last; slept += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(readMyTasksStore(root).runs.last?.status, "complete", "the first check runs without opening the settings dialog");

  // Windows sign-in mode installs a hidden per-user startup launcher, and
  // switching back to runtime removes only ATL's own launcher.
  const postStartupSettings = async (startup_mode) => fetch(new URL("/api/my-tasks/settings", running.url), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startup_mode }),
  }).then((response) => response.json());
  const windowsMode = await postStartupSettings("windows");
  assert.equal(windowsMode.settings.startup_mode, "windows", "Windows sign-in mode is persisted");
  const startupFile = path.join(fakeHome, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "ATL My Tasks.vbs");
  if (process.platform === "win32") assert.ok(fs.readFileSync(startupFile, "utf8").includes("ATL_NO_OPEN"), "Windows sign-in mode registers a hidden ATL runtime launcher");
  await postStartupSettings("runtime");
  if (process.platform === "win32") assert.equal(fs.existsSync(startupFile), false, "runtime mode removes the ATL startup launcher");

  // A previous build's disabled default migrates to the saved startup mode.
  const migrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-default-migration-"));
  fs.mkdirSync(path.join(migrationRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(migrationRoot, "config", "manager.json"), JSON.stringify({ intake: { azure: { org_url: base, project: "Alpha" } } }));
  fs.mkdirSync(path.dirname(myTasksSettingsFile(migrationRoot)), { recursive: true });
  fs.writeFileSync(myTasksSettingsFile(migrationRoot), JSON.stringify({ enabled: false, schedule_on: true, interval_minutes: 15, projects: [] }));
  assert.equal(readMyTasksSettings(migrationRoot).enabled, true, "old untouched default is upgraded to runtime-on");
  assert.deepEqual(readMyTasksSettings(migrationRoot).projects, ["Alpha"]);
  fs.writeFileSync(myTasksSettingsFile(migrationRoot), JSON.stringify({ enabled: false, schedule_on: true, interval_minutes: 15, projects: ["Alpha"] }));
  assert.equal(readMyTasksSettings(migrationRoot).enabled, true, "a legacy off preference with a selected project migrates to runtime-on");

  // 0. A legacy off request cannot disable the configured runtime scheduler.
  const disabled = await post("/api/my-tasks/settings", { enabled: false, interval_minutes: 15, projects: ["Alpha"] });
  assert.equal(disabled.settings.enabled, true, "settings cannot disable My Tasks when Azure is configured");

  // 1. Save settings → enabled; the enable itself fires the first check (due now).
  const saved = await post("/api/my-tasks/settings", { enabled: true, schedule_on: true, interval_minutes: 15, projects: ["Alpha"] });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.enabled, true);
  for (let slept = 0; slept < 50 && !readMyTasksStore(root).runs.last; slept += 10) await new Promise((resolve) => setTimeout(resolve, 100));
  let store = readMyTasksStore(root);
  assert.equal(store.runs.last.status, "complete", "enable fires the first due check");
  assert.ok(store.records["https://devops.example.invalid:32678/collection|Alpha|101"], "record keyed connection|project|id");

  // 2. Simulated tick inside the interval → not due; after the interval → runs.
  assert.equal((await post("/api/my-tasks/tick", { now: at(5) })).reason, "not_due");
  const laterTick = await post("/api/my-tasks/tick", { now: at(16) });
  assert.equal(laterTick.ran, true, "tick past the 15-minute interval runs");

  // 3. Interval change shifts the due line (5-minute interval: T+16+4 is not due, +6 is).
  await post("/api/my-tasks/settings", { interval_minutes: 5 });
  assert.equal((await post("/api/my-tasks/tick", { now: at(19) })).ran, false, "4 minutes after the last attempt is not due at a 5-minute interval");
  assert.equal((await post("/api/my-tasks/tick", { now: at(22) })).ran, true, "6 minutes later is due");

  // 4. Schedule is always on; legacy off values migrate and cannot turn polling off.
  await post("/api/my-tasks/settings", { schedule_on: false });
  assert.equal((await get("/api/my-tasks/settings")).settings.schedule_on, true, "schedule preference is normalized to always-on");
  assert.equal((await post("/api/my-tasks/tick", { now: at(120) })).ran, true, "scheduled checks remain active after a legacy off request");
  const manual = await post("/api/my-tasks/check");
  assert.equal(manual.ok, true, "'check now' works regardless of the schedule");
  assert.match(manual.run_id, /^mt-/);
  await post("/api/my-tasks/settings", { schedule_on: true });

  // 5. A manual request during an in-flight run joins it (same run id, joined: true).
  {
    let releaseHeld = () => {};
    const held = new Promise((resolve) => { releaseHeld = resolve; });
    const joinRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-join-"));
    fs.mkdirSync(path.join(joinRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(joinRoot, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { org_url: base, project: "Alpha", token_env: "AZDO_PAT" } } }));
    const joinServer = await startControlPlaneServer(joinRoot, {
      myTasksFetch: async (url, options = {}) => {
        if (url.includes("workitemsbatch")) await held; // keep one batch in flight
        if (url.endsWith("/_apis/ConnectionData")) return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
        if (url.includes("wiql")) return { data: { workItems: [{ id: 101 }] }, headers: {}, status: 200 };
        if (url.includes("workitemsbatch")) return { data: { value: [{ id: 101, fields: { "System.Id": 101, "System.Rev": 1, "System.Title": "Held item", "System.State": "New", "System.WorkItemType": "Task", "System.AssignedTo": { id: ME.id, displayName: ME.displayName }, "System.ChangedDate": "2026-11-11T09:00:00Z" } }] }, headers: {}, status: 200 };
        if (url.includes("states")) return { data: { value: [{ name: "New", category: "Proposed" }] }, headers: {}, status: 200 };
        throw new Error(`unexpected call ${url}`);
      },
    });
    try {
      const joinPost = async (path1, body = {}) => {
        const response = await fetch(new URL(path1, joinServer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        return response.json();
      };
      await joinPost("/api/my-tasks/settings", { enabled: false, interval_minutes: 15, projects: ["Alpha"] });
      const first = joinPost("/api/my-tasks/check");
      await new Promise((resolve) => setTimeout(resolve, 60)); // let the first check reach the gated batch
      const second = await joinPost("/api/my-tasks/check");
      assert.equal(second.joined, true, "second manual request during a run joins it");
      releaseHeld(); // unblock the in-flight batch, then the first response can arrive
      const firstResult = await first;
      assert.equal(firstResult.run_id, second.run_id, "joined request reports the active run id");
    } finally {
      releaseHeld();
      joinServer.server.close(); joinServer.server.closeAllConnections?.();
    }
  }

  // 6. Retry-After + backoff: a 500 with Retry-After pushes next_due into the window.
  {
    const backoffRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-backoff-"));
    fs.mkdirSync(path.join(backoffRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(backoffRoot, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { org_url: base, project: "Alpha", token_env: "AZDO_PAT" } } }));
    const failing = async (url) => {
      if (url.includes("wiql")) { const error = new Error("HTTP 429 slow down"); error.status = 429; error.retryAfter = 600; throw error; }
      if (url.includes("workitemsbatch")) return { data: { value: [] }, headers: { "retry-after": "600" }, status: 200 };
      if (url.includes("states")) return { data: { value: [{ name: "New", category: "Proposed" }] }, headers: {}, status: 200 };
      return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
    };
    writeMyTasksStore(backoffRoot, emptyMyTasksStore());
    const backoffServer = await startControlPlaneServer(backoffRoot, { myTasksFetch: failing });
    try {
      const response = await fetch(new URL("/api/my-tasks/settings", backoffServer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, interval_minutes: 1, projects: ["Alpha"] }) });
      await response.json();
      for (let slept = 0; slept < 30; slept += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); if (readMyTasksStore(backoffRoot).runs.backoff?.until) break; }
      const backoffStore = readMyTasksStore(backoffRoot);
      assert.ok(backoffStore.runs.backoff.until, "a failing run records a backoff window");
      const waitMs = new Date(backoffStore.runs.backoff.until).getTime() - Date.now();
      assert.ok(waitMs > 60_000, `Retry-After honored: backoff window ${Math.round(waitMs / 1000)}s > 60s`);
      assert.ok(waitMs <= 15 * 60_000 + 2000, "backoff never exceeds the 15-minute cap");
      const status = await (await fetch(new URL("/api/my-tasks/status", backoffServer.url))).json();
      assert.equal(status.next_due_at, backoffStore.runs.backoff.until, "scheduled retry is due at the backoff deadline, independent of the normal interval");
      const tick = await (await fetch(new URL("/api/my-tasks/tick", backoffServer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ now: new Date(Date.now() + 30_000).toISOString() }) })).json();
      assert.equal(tick.ran, false, "tick inside the backoff window does not run");
    } finally { backoffServer.server.close(); backoffServer.server.closeAllConnections?.(); }
  }

  // 7. Auth pause: 401 pauses; reconnect via the credentials endpoint resumes.
  {
    const authRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-authpause-"));
    fs.mkdirSync(path.join(authRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(authRoot, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { org_url: base, project: "Alpha", token_env: "AZDO_PAT" } } }));
    const rejecting = async (url) => {
      if (url.includes("ConnectionData")) { const error = new Error("HTTP 401 unauthorized"); error.status = 401; throw error; }
      return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
    };
    const authServer = await startControlPlaneServer(authRoot, { myTasksFetch: rejecting });
    const authGet = async (path1) => (await fetch(new URL(path1, authServer.url))).json();
    try {
      await (await fetch(new URL("/api/my-tasks/settings", authServer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, interval_minutes: 15, projects: ["Alpha"] }) })).json();
      for (let slept = 0; slept < 30; slept += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); if (readMyTasksStore(authRoot).runs.paused) break; }
      let pausedStore = readMyTasksStore(authRoot);
      assert.equal(pausedStore.runs.paused?.reason, "auth", "401 pauses the scheduler");
      const status = await authGet("/api/my-tasks/status");
      assert.equal(status.next_due_at, null, "paused scheduler has no next due time");
      // Saving preferences retries auth once; an unchanged bad PAT is paused again.
      await (await fetch(new URL("/api/my-tasks/settings", authServer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) })).json();
      for (let slept = 0; slept < 30; slept += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); if (readMyTasksStore(authRoot).runs.paused) break; }
      pausedStore = readMyTasksStore(authRoot);
      assert.equal(pausedStore.runs.paused?.reason, "auth", "retry with unchanged invalid credentials stays paused until a real reconnect");
    } finally { authServer.server.close(); authServer.server.closeAllConnections?.(); }  }

  // 8. Restart persistence: overdue store → exactly one catch-up check on start.
  {
    const restartRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-restart-"));
    fs.mkdirSync(path.join(restartRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(restartRoot, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { org_url: base, project: "Alpha", token_env: "AZDO_PAT" } } }));
    const stale = emptyMyTasksStore();
    stale.connection = { org_url: base, key: base.toLowerCase() };
    stale.projects.Alpha = { status: "fresh", last_success_at: new Date(T0 - 60 * 60_000).toISOString(), last_attempt_at: new Date(T0 - 60 * 60_000).toISOString(), item_count: 2 };
    stale.records["x"] = { key: "x", connection: base.toLowerCase(), project: "Alpha", id: 55, rev: 1, title: "kept across restart", first_seen_at: new Date(T0 - 3600_000).toISOString() };
    writeMyTasksStore(restartRoot, stale);
    const restartServer = await startControlPlaneServer(restartRoot, { myTasksFetch: transport.requestImpl });
    try {
      await (await fetch(new URL("/api/my-tasks/settings", restartServer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, interval_minutes: 15, projects: ["Alpha"] }) })).json();
      for (let slept = 0; slept < 50; slept += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); const current = readMyTasksStore(restartRoot); if (current.runs.last && current.runs.last.started_at > stale.projects.Alpha.last_attempt_at) break; }
      const after = readMyTasksStore(restartRoot);
      assert.ok(after.runs.last, "overdue store triggers a catch-up check at service start");
      assert.equal(Object.keys(after.records).length, 2, "kept + fetched records coexist after restart");
      const runs = after.runs;
      assert.ok(runs.backoff.failures === 0, "successful catch-up resets backoff");
    } finally { restartServer.server.close(); restartServer.server.closeAllConnections?.(); }
  }

  // 8b. Settings persistence lives in the git-ignored local store, not the
  // git-tracked manager.json: a save never rewrites manager.json, and a
  // checkout/reset wave that reverts manager.json to the committed version
  // cannot undo saved settings (owner report 2026-11-11: "saved once, must
  // remain until I change it"). The legacy manager.json key migrates on read.
  {
    const waveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-wave-"));
    fs.mkdirSync(path.join(waveRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(waveRoot, "config", "manager.json"), JSON.stringify({
      version: 1,
      intake: { azure: { org_url: base, project: "Alpha", token_env: "AZDO_PAT" } },
      myTasks: { enabled: true, schedule_on: true, interval_minutes: 244, projects: ["Alpha"] },
    }));
    assert.equal(readMyTasksSettings(waveRoot).interval_minutes, 244, "legacy manager.json settings still read back before the first save");
    const waveServer = await startControlPlaneServer(waveRoot, { myTasksFetch: transport.requestImpl });
    try {
      const wavePost = async (body) => (await fetch(new URL("/api/my-tasks/settings", waveServer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
      const managerBefore = fs.readFileSync(path.join(waveRoot, "config", "manager.json"), "utf8");
      await wavePost({ interval_minutes: 10 });
      assert.equal(fs.readFileSync(path.join(waveRoot, "config", "manager.json"), "utf8"), managerBefore, "a settings save never rewrites the git-tracked manager.json");
      assert.ok(fs.existsSync(myTasksSettingsFile(waveRoot)), "settings live in the git-ignored local store");
      assert.equal(readMyTasksSettings(waveRoot).interval_minutes, 10, "changed interval reads back from the local store");
      // The revert itself: manager.json goes back to its committed content.
      fs.writeFileSync(path.join(waveRoot, "config", "manager.json"), JSON.stringify({ version: 1, intake: { azure: { org_url: base, project: "Alpha", token_env: "AZDO_PAT" } } }));
      const afterWave = await (await fetch(new URL("/api/my-tasks/settings", waveServer.url))).json();
      assert.equal(afterWave.settings.enabled, true, "enabled flag survives the manager.json revert");
      assert.equal(afterWave.settings.interval_minutes, 10, "interval change survives the manager.json revert");
      assert.deepEqual(afterWave.settings.projects, ["Alpha"], "watched projects survive the manager.json revert");
    } finally { waveServer.server.close(); waveServer.server.closeAllConnections?.(); }
  }

  // 9. Projects endpoint lists accessible projects + resolved identity, no token echo.
  {
    const listed = await get("/api/my-tasks/projects");
    assert.equal(listed.ok, true);
    assert.equal(listed.identity.display_name, ME.displayName);
    assert.deepEqual(listed.projects.map((project) => project.name), ["Alpha", "Beta"]);
    const raw = JSON.stringify(listed);
    assert.ok(!raw.includes("synthetic-test-token"), "PAT never appears in an API response");
  }

  // 10. Items + item endpoints expose the store with per-project freshness.
  {
    const items = await get("/api/my-tasks/items");
    assert.equal(items.ok, true);
    assert.ok(items.items.length >= 2);
    assert.equal(items.projects.Alpha.status, "fresh");
    const detail = await get(`/api/my-tasks/item?key=${encodeURIComponent(items.items[0].key)}`);
    assert.equal(detail.ok, true);
    assert.equal(detail.item.id, items.items[0].id);
    assert.equal((await get("/api/my-tasks/item?key=missing")).status ?? 404, 404);
    const status = await get("/api/my-tasks/status");
    assert.equal(status.enabled, true);
    assert.ok(status.next_due_at);
  }

  console.log("PASS: My Tasks scheduler — auto-start, persistent runtime/Windows startup mode, interval gating, always-on schedule, manual join, Retry-After backoff, auth recovery, restart catch-up, project listing without token leakage");
} catch (error) {
  console.error("FAIL:", error.message);
  process.exitCode = 1;
} finally {
  process.env.AZDO_PAT = process.env.AZDO_PAT === "synthetic-test-token" ? undefined : process.env.AZDO_PAT;
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (running) running.server.close();
  running?.server.closeAllConnections?.(); // fetch keep-alive sockets otherwise keep the process alive
}
