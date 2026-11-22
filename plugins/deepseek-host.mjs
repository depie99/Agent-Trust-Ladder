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
import path from 'node:path';

const normalized = value => typeof value === 'string' ? value : value?.path;
const projectRecords = new WeakMap();

// One project model (issue #34): inside a host with its own project list,
// the host registry is the source of truth and ATL projects itself onto it —
// no second registry maintained by the plugin.
export async function resolveProject(ctx) {
  const registry = ctx?.workspaceRegistry;
  if (typeof registry?.list === 'function') {
    const list = await registry.list();
    const rows = Array.isArray(list) ? list : [];
    const recent = projectRecords.get(ctx);
    if (recent) {
      const record = rows.find(row => normalized(row) && path.resolve(normalized(row)) === recent);
      if (record) return path.resolve(normalized(record));
      if (typeof registry.resolveByPath === 'function') {
        const resolved = await registry.resolveByPath(recent);
        if (resolved && normalized(resolved)) return path.resolve(normalized(resolved));
      }
    }
    const first = rows.find(row => normalized(row)?.trim());
    if (first) return path.resolve(normalized(first).trim());
  }
  throw new Error('No ATL project is active. Add one with /atl-add (folder picker) or open a workspace first.');
}

// Long commands live in the host when dsh-jobs is available, so progress and
// cancel survive reloads; otherwise they run directly as before.
export async function withHostJob(ctx, title, work, callerSignal = undefined) {
  if (typeof ctx?.jobs?.start === 'function' && typeof ctx?.jobs?.wait === 'function') {
    const controller = new AbortController();
    const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
    let value, failure;
    const id = ctx.jobs.start({ kind: 'atl-command', label: title, run: () => {
      const done = Promise.resolve().then(() => work(signal)).then(result => {
        value = result;
        return { status: 'completed', ...(typeof result === 'string' ? { result } : {}) };
      }, error => {
        failure = error;
        return { status: 'failed', detail: 'ATL command failed.' };
      });
      return { cancel: reason => controller.abort(reason), done };
    } });
    const settled = await ctx.jobs.wait(id, 10 * 60 * 1000, undefined, callerSignal);
    if (settled.status !== 'completed') throw failure || new Error(settled.status === 'killed' ? 'ATL command was cancelled.' : 'ATL command failed.');
    return value;
  }
  return work();
}

async function callCommand(host, project, args, ctx, { title = 'ATL command', signal: callerSignal } = {}) {
  return withHostJob(ctx, title, signal => host.call('atl_command', { project, args }, { signal }), callerSignal);
}

function consoleResultText(result, { fallback = 'done' } = {}) {
  if (!result) return fallback;
  if (result.status === 'failed') return `failed (exit ${result.exitCode}):\n${(result.stderr || result.stdout || '').slice(0, 2000)}`;
  return (result.stdout || fallback).slice(0, 4000);
}

export async function showStatus(ctx, host, signal) {
  const project = await resolveProject(ctx);
  const result = await callCommand(host, project, ['show'], ctx, { title: 'ATL status', signal });
  return consoleResultText(result, { fallback: 'no tasks yet' });
}

export async function createTask(ctx, host, title, signal) {
  if (!String(title || '').trim()) throw new Error('usage: /atl-task <title>');
  const project = await resolveProject(ctx);
  const result = await callCommand(host, project, ['compose', '--title', String(title).trim()], ctx, { title: `ATL compose: ${String(title).trim()}`, signal });
  return consoleResultText(result, { fallback: 'task composed' });
}

export async function approveTask(ctx, host, taskId, note, signal) {
  if (!String(taskId || '').trim()) throw new Error('usage: /atl-approve <task-id> [--note text]');
  const project = await resolveProject(ctx);
  const args = ['approve', String(taskId).trim()];
  if (String(note || '').trim()) args.push('--note', String(note).trim());
  // The owner approval gate surfaces as an action card when the host provides
  // one, so the decision is visible in the host UI, not just tool output.
  const result = await callCommand(host, project, args, ctx, { title: `ATL approve ${String(taskId).trim()}`, signal });
  return consoleResultText(result, { fallback: 'approved' });
}

// Adding a repository uses the host folder picker (OS chooser locally, or an
// in-app browser for remote sessions) and registers the workspace with the
// host's own registry before ATL initializes it.
export async function addRepository(ctx, host, signal) {
  const capability = await ctx?.directoryPicker?.capability?.();
  if (capability?.kind !== 'native' || typeof capability.pick !== 'function') throw new Error('This host does not expose a native directory picker.');
  const chosen = await capability.pick(signal);
  if (chosen == null || !String(chosen).trim()) return 'Cancelled; no project was opened.';
  const project = path.resolve(String(chosen).trim());
  if (!path.isAbsolute(project)) throw new Error('The picker returned a non-absolute path; ATL projects must be absolute.');
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) throw new Error(`Not a directory: ${project}`);
  const registry = ctx?.workspaceRegistry;
  const registered = typeof registry?.resolveByPath === 'function' ? await registry.resolveByPath(project) : null;
  if (!registered) {
    if (typeof registry?.create !== 'function') throw new Error('The host workspace registry cannot add directories in this version. Add the folder in the host, then run /atl.');
    await registry.create(project, path.basename(project));
  }
  if (ctx && typeof ctx === 'object') projectRecords.set(ctx, project);
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

// Host model routing as a first-class provider (issue #56): the host already
// owns an OpenAI-compatible relay and model list, so ATL registers it as an
// "openai-http" provider named "host" and planning works with no local CLI.
// Detection is feature-first — a ctx.modelRouting/.models surface with
// { endpoint, models } — with the documented env contract (ATL_HOST_RELAY_URL,
// ATL_HOST_RELAY_KEY, ATL_HOST_RELAY_MODELS) as the fallback. The credential
// never travels argv: registration passes --key-env so the daemon reads the
// variable from its own environment.
export function detectHostRelay(ctx, env = process.env) {
  for (const surface of [ctx?.modelRouting, ctx?.models]) {
    if (surface && typeof surface.list === 'function') {
      try {
        const route = surface.list();
        const endpoint = typeof route?.endpoint === 'string' ? route.endpoint.trim() : '';
        if (endpoint) return { endpoint, models: Array.isArray(route.models) ? route.models.map(model => String(model)).filter(Boolean) : [], source: 'host' };
      } catch { /* a throwing surface falls through to env */ }
    }
  }
  const endpoint = String(env.ATL_HOST_RELAY_URL || '').trim();
  if (endpoint) {
    return { endpoint, models: String(env.ATL_HOST_RELAY_MODELS || '').split(',').map(model => model.trim()).filter(Boolean), source: 'env' };
  }
  return null;
}

export async function ensureHostProvider(ctx, host, { env = process.env } = {}) {
  const relay = detectHostRelay(ctx, env);
  if (!relay) return { hostProvider: 'unavailable (no host model-routing surface and ATL_HOST_RELAY_URL is not set)' };
  if (!env.ATL_HOST_RELAY_KEY && relay.source === 'env') return { hostProvider: 'unavailable (ATL_HOST_RELAY_URL is set but ATL_HOST_RELAY_KEY is not)' };
  try {
    const project = await resolveProject(ctx);
    const listed = await callCommand(host, project, ['provider', 'list', '--json'], ctx, { title: 'ATL provider inventory' });
    let providers = [];
    try { providers = JSON.parse(consoleResultText(listed, { fallback: '{}' }) || '{}').providers || []; }
    catch { /* unparseable output is treated as an empty registry */ }
    const existing = providers.find(provider => provider.id === 'host');
    if (existing) return { hostProvider: existing.base_url === relay.endpoint ? 'registered' : `registered (different endpoint: ${existing.base_url || 'none'})` };
    const args = ['provider', 'add', 'host', '--worker', 'openai-http', '--base-url', relay.endpoint];
    if (relay.models.length) args.push('--model', relay.models[0]);
    if (relay.source === 'env') args.push('--key-env', 'ATL_HOST_RELAY_KEY');
    else return { hostProvider: 'unavailable (the host model-routing surface exposes no credential ATL can store; set ATL_HOST_RELAY_KEY)' };
    await callCommand(host, project, args, ctx, { title: 'ATL host provider registration' });
    return { hostProvider: 'registered' };
  } catch (error) {
    return { hostProvider: `unavailable (${error.message})` };
  }
}

export function applyHostIntegrations(ctx, host) {
  const report = { commands: [], actionCards: typeof ctx?.actionCards?.register === 'function', approval: typeof ctx?.approval?.request === 'function', directoryPicker: typeof ctx?.directoryPicker?.capability === 'function', jobs: typeof ctx?.jobs?.start === 'function' && typeof ctx?.jobs?.wait === 'function' };
  // Slash commands: /atl (status), /atl-task (compose), /atl-approve (owner gate).
  if (typeof ctx?.commands?.register === 'function') {
    const register = (definition) => {
      try { ctx.commands.register(definition); report.commands.push(definition.name); }
      catch (error) { report.commands.push(`${definition.name}:unavailable (${error.message})`); }
    };
    const command = work => async invocation => {
      try { return { kind: 'success', text: await work(invocation) }; }
      catch (error) { return { kind: 'error', text: error.message || 'ATL command failed.' }; }
    };
    register({ name: 'atl', description: 'Show ATL task status for the active workspace', handler: command(invocation => showStatus(ctx, host, invocation?.signal)) });
    register({ name: 'atl-task', description: 'Compose a new ATL task (/atl-task <title>)', input: { hint: 'Task title' }, handler: command(invocation => createTask(ctx, host, invocation?.rawInput || '', invocation?.signal)) });
    register({ name: 'atl-approve', description: 'Approve an ATL task (/atl-approve <task-id> [--note text])', input: { hint: 'T-001 --note reason' }, handler: command(async invocation => {
      const text = invocation?.rawInput || '';
      const match = /^(T-\d+)\s*(?:--note\s+(.*))?$/.exec(text.trim());
      return approveTask(ctx, host, match?.[1] || '', match?.[2] || '', invocation?.signal);
    }) });
    register({ name: 'atl-add', description: 'Add a repository with the folder picker and start ATL for it', handler: command(invocation => addRepository(ctx, host, invocation?.signal)) });
  }
  return report;
}
