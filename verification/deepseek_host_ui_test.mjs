// Issue #34, part 4: host-native UI in DeepSeek Harness.
// Slash commands, the right-sidebar board tab, the folder-picker repository
// flow and host jobs are feature-detected against the host context; a host
// without an API keeps the tool-only behavior and never breaks tool loading.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyHostIntegrations, resolveProject, withHostJob, showStatus, createTask, approveTask } from "../plugins/deepseek-host.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "atl-dsh-host-"));
const project = path.join(scratch, "app");
fs.mkdirSync(project, { recursive: true });

// A spy host: records tool calls, answers atl_control_plane without servers.
function spyHost() {
  const calls = [];
  return {
    calls,
    async call(name, args = {}) {
      calls.push({ name, args });
      if (name === "atl_control_plane") return { project: args.project, url: "http://127.0.0.1:47777/" };
      if (name === "atl_start") return { project: args.project, url: "http://127.0.0.1:47777/", initialized: false };
      if (name === "atl_command") return { status: "completed", exitCode: 0, stdout: `ran: ${args.args.join(" ")}` };
      throw new Error(`unexpected tool call ${name}`);
    },
  };
}

function mockCtx({ registryRoot = project } = {}) {
  const registered = { commands: [], sidebar: [] };
  const ctx = {
    commands: { register: (definition) => registered.commands.push(definition) },
    sidebarRightTabs: { register: (tab) => registered.sidebar.push(tab) },
    workspaceRegistry: { active: async () => registryRoot },
    jobs: { run: async ({ run }) => run() },
    actions: { propose: async () => { /* action card surfaced */ } },
  };
  return { ctx, registered };
}

try {
  // 1. A full host: slash commands, board tab, and the report of what registered.
  const full = mockCtx();
  const reportHost = spyHost();
  const report = applyHostIntegrations(full.ctx, reportHost);
  assert.deepEqual(report.commands.filter((name) => !name.includes(":")), ["atl", "atl-task", "atl-approve", "atl-add"], "the three issue-named slash commands plus /atl-add must register");
  assert.equal(report.sidebar, true, "the right-sidebar board tab must register on a host that offers it");
  assert.equal(full.registered.sidebar[0].id, "atl-board");

  // 2. Command handlers route through the shared bridge with the host registry
  //    as the project source — no second registry.
  const host = spyHost();
  const statusText = await showStatus(full.ctx, host);
  assert.equal(statusText, "ran: show");
  assert.equal(host.calls[0].name, "atl_command");
  assert.equal(host.calls[0].args.project, path.resolve(project), "project must come from ctx.workspaceRegistry");

  const taskText = await createTask(full.ctx, host, "Fix the login race");
  assert.equal(taskText, "ran: compose --title Fix the login race");

  await approveTask(full.ctx, host, "T-001", "ship it");
  const approveCall = host.calls.find((call) => call.name === "atl_command" && call.args.args[0] === "approve");
  assert.deepEqual(approveCall.args.args, ["approve", "T-001", "--note", "ship it"], "approve must map to the console command with its note");

  // 3. The bare slash-command surface (no args object) still parses the task id.
  const approve = full.registered.commands.find((definition) => definition.name === "atl-approve");
  await approve.run("T-004 --note from host");
  const approve3 = reportHost.calls.filter((call) => call.name === "atl_command").at(-1);
  assert.deepEqual(approve3.args.args, ["approve", "T-004", "--note", "from host"]);

  // 4. Degradation: a host without any of these APIs stays tool-only.
  const bare = applyHostIntegrations({}, spyHost());
  assert.deepEqual(bare.commands, [], "no commands may register without ctx.commands");
  assert.equal(bare.sidebar, false, "no sidebar may register without ctx.sidebarRightTabs");

  // 5. resolveProject falls back to the workspace record when no registry exists.
  const recordRoot = path.join(scratch, "recorded");
  fs.mkdirSync(recordRoot, { recursive: true });
  fs.writeFileSync(path.join(process.env.ATL_HOME || path.join(os.homedir(), ".atl"), "workspace.json"), JSON.stringify({ project: recordRoot }));
  try {
    const resolved = await resolveProject({});
    assert.equal(resolved, path.resolve(recordRoot), "the workspace record is the last-resort project source");
  } finally {
    fs.rmSync(path.join(process.env.ATL_HOME || path.join(os.homedir(), ".atl"), "workspace.json"), { force: true });
  }

  // 6. withHostJob uses dsh-jobs when present and runs directly otherwise.
  let jobTitle = null;
  const viaJob = await withHostJob({ jobs: { run: async ({ title, run }) => { jobTitle = title; return run(); } } }, "long job", async () => "done");
  assert.equal(viaJob, "done");
  assert.equal(jobTitle, "long job");
  assert.equal(await withHostJob({}, "ignored", async () => "direct"), "direct");

  // 7. A missing project fails with an instructive message, not a crash.
  await assert.rejects(() => resolveProject({ workspaceRegistry: { active: async () => null } }), /No ATL project is active/);

  console.log("PASS: DeepSeek host-native UI registers slash commands, the board tab and the picker flow, degrades cleanly, and projects onto the host workspace registry");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
