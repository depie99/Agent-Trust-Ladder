// Browser per-task run: the control plane can preview and confirm a single
// task without queueing it, under the same budget, gates, and narration as a
// queue launch. The untouched queue work must never appear in the results.
// Proven against the real server (startControlPlaneServer + fetch) with the
// real spawned flashexit provider from run_control_plane_test.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { queueAdd } from "../runtime/lib/queue.mjs";
import { executeLaunchQueue, readRunLock } from "../runtime/lib/launch.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

function makeProject(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atl-task-run-${label}-`));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({
    version: 1,
    inbox_dir: ".trust/manager/inbox",
    providers: {
      default: "flashexit",
      auth: "subscription",
      catalog: {
        flashexit: { command: process.execPath, model: "exit-0", args: ["-e", "process.exit(0);"] },
      },
    },
    intake: { file: { enabled: true }, github: { enabled: false }, azure: { enabled: false } },
  }, null, 2));
  const state = emptyState();
  for (const id of ["T-001", "T-002"]) {
    state.tasks[id] = {
      id,
      title: `task run probe ${id}`,
      status: "assigned",
      priority: "normal",
      assigned_worker: "rowan",
      objective: "run a single task from the browser without queueing the rest",
      completion_checks: [],
      attempt_count: 0,
      updated_at: new Date().toISOString(),
    };
  }
  saveState(root, state);
  queueAdd(root, "T-001");
  queueAdd(root, "T-002");
  return root;
}

// ---------- engine: taskIds runs exactly that task, nothing else
{
  const root = makeProject("engine");
  const run = await executeLaunchQueue(root, {
    confirm: true,
    taskIds: ["T-001"],
    maxMinutes: 5,
    maxSessions: 1,
    pauseAfterSession: true,
    onReview: async () => "stop",
    onProgress: () => {},
  });
  assert.ok(run.results.length >= 1, "the per-task run reports its result");
  assert.ok(run.results.every((row) => row.id === "T-001"), "no task outside taskIds appears in the results");
  assert.ok(run.results.some((row) => /paused after bot by operator/.test(row.reason || "")), "the run stops at the task's human gate");
  const after = loadState(root);
  assert.equal(after.tasks["T-002"].status, "assigned", "the queued sibling is untouched by a per-task run");
  const runMeta = JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "overnight", "run.json"), "utf8"));
  assert.equal(runMeta.queueId ?? null, null, "an ad-hoc task run takes no queue identity");
  assert.equal(readRunLock(root), null, "the run lease is released");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- server: preview + confirm endpoints serve the per-task flow
{
  const root = makeProject("server");
  const running = await startControlPlaneServer(root);
  try {
    const client = await fetch(`${running.url}control-plane-client.js`).then((response) => response.text());
    assert.match(client, /run-task:/, "the task dialog exposes a per-task run action");
    assert.match(client, /Run this task/, "the preview dialog carries the explicit confirm button");

    const preview = await fetch(`${running.url}api/run/preview`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskIds: ["T-001"] }),
    });
    const previewBody = await preview.json();
    assert.equal(preview.status, 200, "task preview is available without confirmation");
    assert.equal(previewBody.ok, true);
    const previewText = previewBody.lines.join("\n");
    assert.match(previewText, /ad-hoc task run/, "the preview labels an ad-hoc task run honestly");
    assert.match(previewText, /T-001/, "the preview lists the task");
    assert.equal(readRunLock(root), null, "previewing a task starts no run");

    const unknown = await fetch(`${running.url}api/run/preview`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskIds: ["T-999"] }),
    });
    assert.equal(unknown.status, 400, "unknown task ids are refused before any spawn");

    const started = await fetch(`${running.url}api/run`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true, taskIds: ["T-001"], maxSessions: 1, maxMinutes: 5 }),
    });
    assert.equal(started.status, 202, "confirmed per-task run starts");
    const startedBody = await started.json();
    assert.deepEqual(startedBody.run.taskIds, ["T-001"], "the run record names its task");

    const deadline = Date.now() + 20000;
    let finished = null;
    while (Date.now() < deadline) {
      finished = await fetch(`${running.url}api/run`).then((response) => response.json());
      if (finished.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.notEqual(finished.status, "running", "the per-task run settles");
    assert.ok((finished.results || []).every((row) => row.id === "T-001"), "settled results cover only the requested task");
    const after = await fetch(`${running.url}api/snapshot`).then((response) => response.json());
    assert.equal(after.state.tasks["T-002"].status, "assigned", "the queued sibling survives a browser task run");
  } finally {
    await new Promise((resolve) => running.server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("PASS: control-plane task run — per-task preview/confirm through the real server, sibling queue work untouched");
