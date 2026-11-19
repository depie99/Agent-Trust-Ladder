// Host-native UI for DeepSeek Harness (issue #34): reuse the host's own
// surfaces where it provides them — right-sidebar task board tab, slash
// commands, the OS folder picker for adding a repository, host jobs for long
// commands, and action cards for the owner approval gate — instead of always
// falling back to a second browser tab.
//
// Every integration is feature-detected and individually isolated: a host
// without an API keeps the tool-only behavior, and a failing registration
// never breaks tool loading. `applyHostIntegrations` returns a report of what
// actually registered, so tests and diagnostics see the truth.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const homeDir = () => process.env.ATL_HOME || path.join(os.homedir(), '.atl');
const workspaceRecord = () => path.join(homeDir(), 'workspace.json');

// One project model (issue #34): inside a host with its own project list,
// the host registry is the source of truth and ATL projects itself onto it —
// no second registry maintained by the plugin.
export async function resolveProject(ctx) {
  const registry = ctx?.workspaceRegistry;
  for (const getter of ['active', 'current', 'getActive']) {
    if (typeof registry?.[getter] === 'function') {
      const workspace = await registry[getter]();
      if (typeof workspace === 'string' && workspace.trim()) return path.resolve(workspace.trim());
      if (typeof workspace?.root === 'string' && workspace.root.trim()) return path.resolve(workspace.root.trim());
    }
  }
  if (typeof registry?.list === 'function') {
    const list = await registry.list();
    const first = Array.isArray(list) ? list[0] : null;
    if (typeof first === 'string' && first.trim()) return path.resolve(first.trim());
    if (typeof first?.root === 'string' && first.root.trim()) return path.resolve(first.root.trim());
  }
  try {
    const stored = JSON.parse(fs.readFileSync(workspaceRecord(), 'utf8')).project;
    if (typeof stored === 'string' && stored.trim() && fs.existsSync(stored.trim())) return path.resolve(stored.trim());
  } catch { /* no record yet */ }
  throw new Error('No ATL project is active. Add one with /atl-add (folder picker) or open a workspace first.');
}

// Long commands live in the host when dsh-jobs is available, so progress and
// cancel survive reloads; otherwise they run directly as before.
export async function withHostJob(ctx, title, work) {
  if (typeof ctx?.jobs?.run === 'function') return ctx.jobs.run({ title, run: work });
  return work();
}

async function callCommand(host, project, args, ctx, { title = 'ATL command' } = {}) {
  return withHostJob(ctx, title, () => host.call('atl_command', { project, args }));
}

function consoleResultText(result, { fallback = 'done' } = {}) {
  if (!result) return fallback;
  if (result.status === 'failed') return `failed (exit ${result.exitCode}):\n${(result.stderr || result.stdout || '').slice(0, 2000)}`;
  return (result.stdout || fallback).slice(0, 4000);
}

export async function showStatus(ctx, host) {
  const project = await resolveProject(ctx);
  const result = await callCommand(host, project, ['show'], ctx, { title: 'ATL status' });
  return consoleResultText(result, { fallback: 'no tasks yet' });
}

export async function createTask(ctx, host, title) {
  if (!String(title || '').trim()) throw new Error('usage: /atl-task <title>');
  const project = await resolveProject(ctx);
  const result = await callCommand(host, project, ['compose', '--title', String(title).trim()], ctx, { title: `ATL compose: ${String(title).trim()}` });
  return consoleResultText(result, { fallback: 'task composed' });
}

export async function approveTask(ctx, host, taskId, note) {
  if (!String(taskId || '').trim()) throw new Error('usage: /atl-approve <task-id> [--note text]');
  const project = await resolveProject(ctx);
  const args = ['approve', String(taskId).trim()];
  if (String(note || '').trim()) args.push('--note', String(note).trim());
  // The owner approval gate surfaces as an action card when the host provides
  // one, so the decision is visible in the host UI, not just tool output.
  if (typeof ctx?.actions?.propose === 'function') {
    try {
      await ctx.actions.propose({
        title: `ATL approve ${String(taskId).trim()}`,
        description: 'Records owner approval and queues the task for bounded execution.',
        actions: [{ label: 'Approve', command: `/atl-approve ${String(taskId).trim()}` }],
      });
    } catch { /* the approval itself still runs through ATL's own gates */ }
  }
  const result = await callCommand(host, project, args, ctx, { title: `ATL approve ${String(taskId).trim()}` });
  return consoleResultText(result, { fallback: 'approved' });
}

// Adding a repository uses the host folder picker (OS chooser locally, or an
// in-app browser for remote sessions) and registers the workspace with the
// host's own registry before ATL initializes it.
export async function addRepository(ctx, host) {
  const picker = await import('@deepseek-ai/dsh-host-directory-picker').catch(() => null);
  const pick = picker?.pick || picker?.default?.pick || ctx?.directoryPicker?.pick;
  if (typeof pick !== 'function') throw new Error('This host does not expose a directory picker; add the repository from the ATL connection assistant instead.');
  const chosen = await pick({ title: 'Choose the application folder to manage with ATL' });
  const project = path.resolve(String(chosen || ''));
  if (!path.isAbsolute(project)) throw new Error('The picker returned a non-absolute path; ATL projects must be absolute.');
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) throw new Error(`Not a directory: ${project}`);
  if (typeof ctx?.workspaceRegistry?.create === 'function') {
    try { await ctx.workspaceRegistry.create(project, path.basename(project) || project); }
    catch { /* already registered in the host, or the host rejects duplicates */ }
  }
  const started = await host.call('atl_start', { project });
  return `ATL is managing ${project}\n${started.url}${started.initialized === false ? '\n(initialized new ATL state)' : ''}`;
}

// Task board tab: a right-sidebar surface rendering the live snapshot, so the
// board is visible without leaving the app.
async function renderBoard(ctx, host) {
  const project = await resolveProject(ctx);
  const ui = await host.call('atl_control_plane', { project });
  const response = await fetch(new URL('/api/snapshot', ui.url), { headers: { Accept: 'application/json' } });
  const body = await response.json();
  const tasks = Object.values(body?.snapshot?.tasks || body?.tasks || {});
  const active = tasks.filter((task) => !['done', 'archived', 'rejected'].includes(task.status));
  const rows = active.map((task) => `<li><b>${escapeHtml(task.id)}</b> [${escapeHtml(task.status)}] ${escapeHtml(task.title || '')} — ${escapeHtml(task.assigned_worker || 'unassigned')}</li>`).join('');
  const done = tasks.length - active.length;
  return [
    `<div class="atl-board">`,
    `<p>active: ${active.length}, done: ${done}</p>`,
    `<ul>${rows || '<li>no active tasks</li>'}</ul>`,
    `<p><a href="${ui.url}" target="_blank">open the full Control Plane</a></p>`,
    `</div>`,
  ].join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function applyHostIntegrations(ctx, host) {
  const report = { commands: [], sidebar: false };
  // Slash commands: /atl (status), /atl-task (compose), /atl-approve (owner gate).
  if (typeof ctx?.commands?.register === 'function') {
    const register = (definition) => {
      try { ctx.commands.register(definition); report.commands.push(definition.name); }
      catch (error) { report.commands.push(`${definition.name}:unavailable (${error.message})`); }
    };
    register({ name: 'atl', description: 'Show ATL task status for the active workspace', run: () => showStatus(ctx, host) });
    register({ name: 'atl-task', description: 'Compose a new ATL task (/atl-task <title>)', run: (args) => createTask(ctx, host, typeof args === 'string' ? args : args?.title || '') });
    register({ name: 'atl-approve', description: 'Approve an ATL task (/atl-approve <task-id> [--note text])', run: (args) => {
      const text = typeof args === 'string' ? args : `${args?.task_id || ''} ${args?.note ? `--note ${args.note}` : ''}`;
      const match = /^(T-\d+)\s*(?:--note\s+(.*))?$/.exec(text.trim());
      return approveTask(ctx, host, match?.[1] || '', match?.[2] || '');
    } });
    register({ name: 'atl-add', description: 'Add a repository with the folder picker and start ATL for it', run: () => addRepository(ctx, host) });
  }
  // Right-sidebar task board tab.
  if (typeof ctx?.sidebarRightTabs?.register === 'function') {
    try {
      ctx.sidebarRightTabs.register({ id: 'atl-board', title: 'ATL Tasks', render: () => renderBoard(ctx, host) });
      report.sidebar = true;
    } catch { report.sidebar = false; }
  }
  return report;
}
