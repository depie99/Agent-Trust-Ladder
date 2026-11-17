import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createTask, emptyState, saveState, loadState } from "../runtime/lib/state.mjs";
import { driveTaskUntilGate, executeLaunchQueue } from "../runtime/lib/launch.mjs";
import { readHandoff } from "../runtime/lib/handoffs.mjs";

const fixture = fileURLToPath(new URL("./fixtures/channel-worker.mjs", import.meta.url));
// Surface the session transcript when a stage fails: the runner records the
// provider output under overnight/, and CI otherwise reports only "code 1".
function sessionTail(root) {
  const parts = [];
  try {
    const dir = path.join(root, ".trust", "manager", "overnight");
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const taskDir = path.join(dir, entry.name);
      for (const file of fs.readdirSync(taskDir)) {
        if (file.endsWith(".log")) parts.push(`--- ${file}\n` + fs.readFileSync(path.join(taskDir, file), "utf8").slice(-1400));
      }
    }
  } catch { /* transcripts unavailable */ }
  try {
    const walk = (dir) => {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") out.push(...walk(file));
        else if (entry.name.startsWith("worker-error-") || entry.name.startsWith("worker-fatal-")) out.push(`--- ${entry.name}\n` + fs.readFileSync(file, "utf8").slice(0, 2000));
      }
      return out;
    };
    parts.push(...walk(root));
  } catch { /* captures unavailable */ }
  return parts.join("\n=====\n") || "(no session log)";
}
for (const mode of ["direct", "queue"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atl-channel-${mode}-`));
  try {
    const state = emptyState(); const task = createTask(state, { title: "Contained task", source: { type: "test" } });
    Object.assign(task, { status: "assigned", assigned_worker: "rowan", objective: "Observe contained worker output", completion_checks: ["worker result verified"], review_required: true }); saveState(root, state);
    const provider = { command: process.execPath, args: [fixture, "{task}", "{role}"] };
    fs.mkdirSync(path.join(root, "config")); fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ providers: { default: "fixture", catalog: { fixture: provider } } }));
    if (mode === "direct") {
      const budget = { sessions: 0, maxSessions: 4, deadline: Date.now() + 60000 };
      const result = await driveTaskUntilGate(root, task.id, budget, { overnight: true, worker: "fixture", resolveWorker: () => ({ worker: "fixture", provider, auth: "subscription" }), onProgress: () => {} });
      assert.equal(result.status, "done", `${result.reason}\n${sessionTail(root)}`); assert.equal(budget.sessions, 3);
    } else {
      const result = await executeLaunchQueue(root, { taskIds: [task.id], confirm: true, maxSessions: 4, maxMinutes: 1, onProgress: () => {} });
      assert.equal(result.results[0].status, "done", JSON.stringify(result.results)); assert.equal(result.budget.sessions, 3);
      assert.ok(readHandoff(root, loadState(root).tasks[task.id]).output.revision);
    }
    assert.equal(loadState(root).tasks[task.id].status, "done");
    const leases = JSON.parse(fs.readFileSync(path.join(root, ".trust", "manager", "leases.json")));
    assert.ok(Object.values(leases.sessions).every((lease) => lease.status === "released"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
console.log("PASS: direct and queue launches complete three scoped stages through sandboxed clients, record verified handoff, and release leases");
