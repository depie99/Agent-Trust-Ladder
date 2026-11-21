// Issue #34, part 4: host-native UI in DeepSeek Harness.
// Slash commands, the right-sidebar board tab, the folder-picker repository
// flow and host jobs are feature-detected against the host context; a host
// without an API keeps the tool-only behavior and never breaks tool loading.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyHostIntegrations, resolveProject, withHostJob, showStatus, createTask, approveTask, addRepository } from "../plugins/deepseek-host.mjs";

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
  const registered = { commands: [] };
  const ctx = {
    commands: { register: (definition) => registered.commands.push(definition) },
    workspaceRegistry: { list: async () => [{ path: registryRoot }], resolveByPath: async value => value === registryRoot ? { path: registryRoot } : null },
    jobs: (() => { const jobs = new Map(); return { start: ({ kind, label, run }) => { assert.equal(kind, 'atl-command'); const id = 'job-1'; jobs.set(id, run({ id })); return id; }, wait: async (id) => { const value = await jobs.get(id).done; return { ...value, status: value.status }; } }; })(),
    actionCards: { register: () => () => {} },
    approval: { request: async () => 'allowed-once' },
    directoryPicker: { capability: async () => ({ kind: 'native', pick: async () => null }) },
  };
  return { ctx, registered };
}

try {
  // 1. A full host: slash commands, board tab, and the report of what registered.
  const full = mockCtx();
  const reportHost = spyHost();
  const report = applyHostIntegrations(full.ctx, reportHost);
  assert.deepEqual(report.commands.filter((name) => !name.includes(":")), ["atl", "atl-task", "atl-approve", "atl-add"], "the three issue-named slash commands plus /atl-add must register");
  assert.equal(report.jobs, true, 'host jobs must be detected using start/wait');
  assert.equal(report.actionCards, true, 'owner action cards must be detected');
  assert.equal(report.directoryPicker, true, 'directory picker availability is reported honestly');
  assert.equal(report.approval, true, 'approval capability is reported honestly');
  assert.equal(report.actionCards, true, 'action-card capability is reported honestly');
  const client = fs.readFileSync(path.join(repo, 'plugins/deepseek-client.mjs'), 'utf8');
  assert.match(client, /sidebarRightTabs\.register/);
  assert.match(client, /api\/atl\/request/);
  assert.match(client, /setTimeout\(refresh, 5000\)/, 'the native task tab refreshes its live task list');

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
  const outcome = await approve.handler({ rawInput: "T-004 --note from host" });
  assert.equal(outcome.kind, 'success', 'commands return the host CommandResult contract');
  const approve3 = reportHost.calls.filter((call) => call.name === "atl_command").at(-1);
  assert.deepEqual(approve3.args.args, ["approve", "T-004", "--note", "from host"]);

  // The picker capability owns pick(); a null choice is a true no-op.
  let pickedPath = null, registeredPath = null, started = false;
  const pickerCtx = {
    directoryPicker: { capability: async () => ({ kind: 'native', pick: async () => pickedPath }) },
    workspaceRegistry: { resolveByPath: async value => registeredPath === value ? { path: value } : null, create: async value => { registeredPath = value; return { path: value }; } },
  };
  assert.equal(await addRepository(pickerCtx, { call: async () => { started = true; return { url: 'http://127.0.0.1:1/', initialized: false }; } }), 'Cancelled; no project was opened.');
  assert.equal(started, false, 'cancel never initializes the cwd or any other project');
  pickedPath = project;
  const added = await addRepository(pickerCtx, { call: async (name, args) => { started = true; assert.equal(name, 'atl_start'); assert.equal(args.project, project); return { url: 'http://127.0.0.1:1/', initialized: false }; } });
  assert.equal(registeredPath, project, 'the host registry receives the picked directory');
  assert.match(added, /initialized new ATL state/);

  // 4. Degradation: a host without these APIs stays tool-only.
  const bare = applyHostIntegrations({}, spyHost());
  assert.deepEqual(bare.commands, [], "no commands may register without ctx.commands");
  assert.equal(bare.jobs, false);
  assert.equal(bare.actionCards, false);
  assert.equal(bare.directoryPicker, false);

  // 5. The host registry is the only project source.
  await assert.rejects(() => resolveProject({}), /No ATL project is active/);
  assert.equal(await resolveProject({ workspaceRegistry: { list: async () => [{ path: project }] } }), path.resolve(project));

  // 6. withHostJob uses dsh-jobs when present and runs directly otherwise.
  let jobTitle = null;
  const jobHooks = new Map();
  const viaJob = await withHostJob({ jobs: { start: ({ kind, label, run }) => { assert.equal(kind, 'atl-command'); jobTitle = label; jobHooks.set('job-2', run({ id: 'job-2' })); return 'job-2'; }, wait: async id => jobHooks.get(id).done } }, "long job", async () => "done");
  assert.equal(viaJob, 'done');
  assert.equal(jobTitle, 'long job');
  assert.equal(await withHostJob({}, "ignored", async () => "direct"), "direct");

  // 7. A missing project fails with an instructive message, not a crash.
  await assert.rejects(() => resolveProject({ workspaceRegistry: { active: async () => null } }), /No ATL project is active/);

  console.log("PASS: DeepSeek host integrations use current command/job/action-card contracts, native task tab, and the host workspace registry");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
