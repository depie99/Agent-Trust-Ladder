// Shared full-runtime bridge for native harness plugins and stdio MCP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { verifyPluginRelease } from './plugin-release.mjs';
import { ensureDaemon, runtimeIdentity } from './daemon.mjs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const bundleRoot = fileURLToPath(new URL('../../', import.meta.url));
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const project = { type: 'string', description: 'Absolute path of the application to manage, explicitly selected by the user. Never the plugin installation directory.' };
const str = { type: 'string' };
export const pluginTools = [
  ...['search', 'issue', 'comments', 'transitions'].map(operation => ({ name: `atl_jira_${operation}`, description: `Read Jira ${operation} through the configured official Atlassian MCP connection. arguments_json contains tool arguments; the configured site is enforced.`, inputSchema: schema({ project, arguments_json: str }, ['project', 'arguments_json']), readOnly: true })),
  { name: 'atl_jira_preview', description: 'Prepare a Jira comment, edit or transition preview. No remote write occurs. The user must review and approve this exact proposal in ATL My Tasks → Analysis & Jira settings → Review pending actions. Never approve on the user behalf.', inputSchema: schema({ project, operation: str, issue_key: str, changes_json: str }, ['project', 'operation', 'issue_key', 'changes_json']) },
  { name: 'atl_connect', description: 'Open the local ATL connection assistant: choose a harness, copy matching connection settings, switch English/Persian and open a project. No project is initialized until explicitly selected and opened. Returns a browser URL; does not launch workers.', inputSchema: schema() },
  { name: 'atl_start', description: 'Start ATL for the selected application in one step: initialize missing ATL project state, preserve existing state, and return the full Control Plane URL. Use for an authorized setup or open-dashboard request. Does not launch workers.', inputSchema: schema({ project }, ['project']) },
  { name: 'atl_info', description: 'Discover the bundled ATL runtime, skill catalog and usage. Does not initialize projects or install anything.', inputSchema: schema(), readOnly: true },
  { name: 'atl_skill', description: 'Read a bundled ATL skill or one of its supporting files. Start with name=atl; follow its workflow and trust gates.', inputSchema: schema({ name: str, file: { ...str, description: 'Path within the skill, default SKILL.md. References are loaded on demand.' } }, ['name']), readOnly: true },
  { name: 'atl_command', description: 'Execute the full bundled ATL CLI in the selected project, without a global atl installation. Pass argv as separate strings (e.g. ["init"], ["compose","--title","Fix login"], ["run",id,"--dry-run"]). Returns a job; poll atl_job until finished. Mutates state, may run providers or external operations depending on argv. Existing ATL and host approval gates apply; never invent user approval or add --confirm on your own.', inputSchema: schema({ project, args: { type: 'array', items: str, minItems: 1, maxItems: 128 }, wait_ms: { type: 'integer', minimum: 0, maximum: 10000 } }, ['project', 'args']) },
  { name: 'atl_job', description: 'Read output and exit status of a command started in this plugin session. A running job is not completion evidence. Job handles live in memory for this plugin session only; once 32 exist, the oldest finished handles are dropped and their ids become unknown — durable task state stays in the project. Use the Control Plane to stop provider runs safely.', inputSchema: schema({ id: str, wait_ms: { type: 'integer', minimum: 0, maximum: 10000 } }, ['id']), readOnly: true },
  { name: 'atl_control_plane', description: 'Start or reuse the complete ATL Control Plane for an initialized project. Returns a loopback URL to open in the browser. Does not launch workers. Runs as the project\'s daemon — the one process that owns project state — and stays up after the plugin unloads (idle exit after ~15 quiet minutes); the URL is stable per project.', inputSchema: schema({ project }, ['project']) },
];

function validate(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object.');
  for (const key of Object.keys(args)) if (!Object.hasOwn(tool.inputSchema.properties, key)) throw new Error(`Unknown argument: ${key}`);
  for (const key of tool.inputSchema.required) if (!(key in args)) throw new Error(`Missing argument: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const rule = tool.inputSchema.properties[key];
    if (rule.type === 'string' && (typeof value !== 'string' || !value.trim() || value.includes('\0'))) throw new Error(`${key} must be a non-empty string.`);
    if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) throw new Error(`Invalid ${key}.`);
    if (rule.type === 'array' && (!Array.isArray(value) || value.length < rule.minItems || value.length > rule.maxItems || value.some(v => typeof v !== 'string' || v.includes('\0')))) throw new Error(`Invalid ${key} array.`);
  }
}

function projectPath(value) {
  if (!path.isAbsolute(value)) throw new Error('project must be an absolute path.');
  let root;
  try { root = fs.realpathSync(value); } catch { throw new Error(`Directory not found: ${value}`); }
  if (!fs.statSync(root).isDirectory()) throw new Error('project must be a directory.');
  const relative = path.relative(fs.realpathSync(bundleRoot), root);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Select an application outside the plugin installation.');
  return root;
}

export function createPluginHost() {
  const packaged = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'package.json'), 'utf8')).name === '@depie99/atl-plugin';
  const release = packaged || fs.existsSync(path.join(bundleRoot, 'atl-release.json')) ? verifyPluginRelease(bundleRoot) : null;
  const jobs = new Map();
  const embedToken = randomUUID();
  // Bumped every time a per-project control plane is started fresh (issue #34
  // moved servers to a reusable per-project daemon, so this fires only when a
  // new owner actually starts). Panel gateways pin the generation they were
  // built against, so a gateway pinned to a server that died is recognizable
  // and replaceable instead of being reused forever.
  let serverGeneration = 0;
  let closed = false;
  let connectionAssistant;
  const outputLimit = 65536 ;

  function snapshot(job) {
    const output = key => job[`${key}Head`] + (job.truncated[key] ? "\n… output truncated; beginning and end retained …\n" : "") + job[key];
    return { id: job.id, project: job.project, args: job.args, status: job.status, exitCode: job.exitCode, signal: job.signal, stdout: output('stdout'), stderr: output('stderr'), truncated: job.truncated.stdout || job.truncated.stderr };
  }
  function capture(job, key, chunk) {
    const text = job[key] + chunk;
    const half = Math.floor(outputLimit / 2);
    if (text.length <= outputLimit && !job.truncated[key]) job[key] = text;
    else {
      job.truncated[key] = true;
      if (job[`${key}Head`].length < half) job[`${key}Head`] += text.slice(0, half - job[`${key}Head`].length);
      job[key] = (job[key] + chunk).slice(-half);
    }
  }
  async function wait(job, ms = 1000, signal) {
    if (ms && job.status === 'running') {
      const timer = new AbortController();
      try { await Promise.race([job.done, delay(ms, undefined, { signal: AbortSignal.any([timer.signal, ...(signal ? [signal] : [])]) })]); }
      finally { timer.abort(); }
    }
    return snapshot(job);
  }
  function command(root, args, { interfaceProcess = false } = {}) {
    // UI lifetime belongs to the host, not an unobservable child process.
    if (!interfaceProcess && (['ui', 'ui-refresh', 'control-plane', 'web', 'tui'].includes(args[0]) || (args[0] === 'dashboard' && !args.includes('--once')) || (args[0] === 'feed' && !args.includes('--once')))) throw new Error('Use atl_control_plane for a persistent interface, or dashboard --once --plain for a snapshot.');
    if (!args[0] || args[0].startsWith('-') && !['--help', '-h'].includes(args[0])) throw new Error('Pass an ATL command as the first argument.');
    while (jobs.size >= 32) {
      const old = [...jobs].find(([, job]) => job.status !== 'running');
      if (!old) throw new Error('32 commands are already running. Wait for completion before starting another.');
      jobs.delete(old[0]);
    }
    const child = spawn(process.execPath, [path.join(bundleRoot, 'runtime', 'atl-manager.mjs'), ...args], {
      cwd: root, env: { ...process.env, ATL_PROJECT: root, ATL_NO_OPEN: '1', ATL_RUNTIME_BUNDLE: bundleRoot, ...(interfaceProcess ? { ATL_PLUGIN_EMBED_TOKEN: embedToken } : {}) },
      shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const job = { id: randomUUID(), project: root, args: [...args], status: 'running', exitCode: null, signal: null, stdout: '', stderr: '', stdoutHead: '', stderrHead: '', truncated: { stdout: false, stderr: false }, child };
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', chunk => capture(job, stream, chunk));
    }
    job.done = new Promise(resolve => {
      child.once('error', error => { job.stderr += error.message; });
      child.once('close', (code, signal) => { job.status = code === 0 ? 'completed' : 'failed'; job.exitCode = code; job.signal = signal; resolve(); });
    });
    jobs.set(job.id, job);
    return job;
  }
  async function stopJob(job) {
    if (job.stopping) return job.stopping;
    if (job.status !== 'running') return;
    job.stopping = (async () => {
      if (process.platform === 'win32') {
        // Only this instance's process tree, never a name-wide kill.
        await new Promise(resolve => {
          const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(job.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.once('error', resolve); killer.once('close', resolve);
        });
      } else {
        try { process.kill(-job.child.pid, 'SIGTERM'); } catch { /* already exited */ }
        const force = setTimeout(() => { try { process.kill(-job.child.pid, 'SIGKILL'); } catch { /* already exited */ } }, 1500);
        try { await job.done; } finally { clearTimeout(force); }
      }
      await job.done;
    })();
    return job.stopping;
  }
  async function call(name, args = {}, { signal } = {}) {
    if (closed) throw new Error('ATL plugin has unloaded.');
    signal?.throwIfAborted();
    const tool = pluginTools.find(t => t.name === name);
    if (!tool) throw new Error(`Unknown ATL tool: ${name}`);
    validate(tool, args);
    if (name === 'atl_connect') {
      const created = !connectionAssistant;
      connectionAssistant ||= import('../atl-connect.mjs').then(module => module.startConnect());
      const pending = connectionAssistant;
      try {
        const app = await pending;
        signal?.throwIfAborted();
        return { url: app.url, lifetime: 'plugin session', next: 'Open the connection assistant in your browser.' };
      } catch (error) {
        if (created) { await pending.then(app => app.close(), () => {}); if (connectionAssistant === pending) connectionAssistant = undefined; }
        throw error;
      }
    }
    if (name === 'atl_info') {
      // Cheap runtime self-check (issue #33): importing the server module
      // resolves the full runtime import graph; a broken bundle reports
      // unhealthy with a one-line reason instead of failing at first use.
      const health = await import('./control-plane-server.mjs')
        .then(() => ({ healthy: true, error: null }))
        .catch(error => {
          const text = String(error?.message || error);
          const missing = text.match(/Cannot find module '([^']+)'/);
          return { healthy: false, error: missing ? `missing runtime module: ${missing[1]}` : text.split('\n')[0].slice(0, 200) };
        });
      return {
        release: release && { format: release.format, version: release.version, runtimeVersion: release.runtimeVersion, content: { sha256: release.content.sha256 } },
        // One runtime (issue #34): the bundle identity matches what `atl
        // --version` and /api/health report, so mismatches are visible.
        ...runtimeIdentity(bundleRoot),
        version: JSON.parse(fs.readFileSync(path.join(bundleRoot, 'package.json'), 'utf8')).version,
        commit: (() => { try { return JSON.parse(fs.readFileSync(path.join(bundleRoot, 'atl-release.json'), 'utf8')).commit || null; } catch { try { return JSON.parse(fs.readFileSync(path.join(bundleRoot, 'source.json'), 'utf8')).commit || null; } catch { return null; } } })(),
        runtime: (() => { try { return JSON.parse(fs.readFileSync(path.join(bundleRoot, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })(),
        healthy: health.healthy,
        error: health.error,
        skills: fs.readdirSync(path.join(bundleRoot, 'skills')).filter(name => fs.existsSync(path.join(bundleRoot, 'skills', name, 'SKILL.md'))).sort(),
        instructions: 'Read atl_skill(name="atl") first. For an authorized setup or dashboard request, call atl_start with the absolute application path. All runtime commands use this bundle; no global atl install is required. Provider CLIs/authentication and feature-specific tools still need to be available. Native harness tools do not automatically become unattended ATL workers.',
      };
    }
    if (name === 'atl_skill') {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(args.name)) throw new Error('Invalid skill name.');
      const base = fs.realpathSync(path.join(bundleRoot, 'skills', args.name));
      const file = args.file || 'SKILL.md';
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new Error('Skill path must stay inside the skill.');
      const target = fs.realpathSync(path.join(base, file));
      if (!target.startsWith(base + path.sep) || !fs.statSync(target).isFile()) throw new Error('Skill path must identify a file inside the skill.');
      if (fs.statSync(target).size > 262144) throw new Error('Supporting file is too large; inspect it using host file tools.');
      return { name: args.name, file, content: fs.readFileSync(target, 'utf8') };
    }
    if (name === 'atl_job') {
      const job = jobs.get(args.id);
      if (!job) throw new Error('Unknown or expired job. Job handles belong to the plugin session; durable task state is in the project.');
      return wait(job, args.wait_ms, signal);
    }
    const root = projectPath(args.project);
    if (name.startsWith('atl_jira_')) {
      const ui = await call('atl_control_plane', { project: root }, { signal });
      const preview = name === 'atl_jira_preview';
      const response = await fetch(new URL(`/api/my-tasks/jira/${preview ? 'preview' : 'read'}`, ui.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preview ? { operation: args.operation, issueKey: args.issue_key, changes: JSON.parse(args.changes_json) } : { operation: name.slice('atl_jira_'.length), arguments: JSON.parse(args.arguments_json) }), signal });
      const result = await response.json(); if (!response.ok || !result.ok) throw Error(result.error || 'Jira tool unavailable');
      return { ...result, ...(preview ? { next: 'Review and approve this exact action in the ATL browser. No Jira write has been made.' } : {}) };
    }
    if (name === 'atl_start') {
      const profile = process.env.HOME || process.env.USERPROFILE;
      const homePath = profile && path.resolve(profile);
      const dataPath = process.env.ATL_HOME && path.resolve(process.env.ATL_HOME);
      if (homePath && root === homePath) throw new Error('ATL cannot initialize the home directory as a project. Select an application folder.');
      if (dataPath && (root === dataPath || root.startsWith(dataPath + path.sep))) throw new Error('ATL install and data directories cannot be managed as projects. Select an application folder.');
      const initialized = fs.existsSync(path.join(root, '.trust', 'manager', 'state.json'));
      if (!initialized) {
        const job = command(root, ['init']);
        const abort = () => { void stopJob(job); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          await job.done;
          signal?.throwIfAborted();
          if (job.exitCode !== 0) throw new Error(`ATL setup failed: ${job.stderr || job.stdout}`);
        } finally { signal?.removeEventListener('abort', abort); }
      }
      return { ...await call('atl_control_plane', { project: root }, { signal }), initialized: !initialized, next: 'Open the URL to create tasks, choose a ready provider and review execution before starting a run.' };
    }
    if (name === 'atl_command') {
      const job = command(root, args.args);
      try { const result = await wait(job, args.wait_ms, signal); signal?.throwIfAborted();
        // Plugin-facing errors name the plugin path, not raw CLI output (#33).
        if (result.status === 'failed' && /Run: atl init|No state file|Missing .*manager\.json/i.test(result.stderr || '')) {
          result.next = 'This project has no ATL state yet. Call atl_start with the project\'s absolute path (it initializes and returns the dashboard URL); then retry this command.';
        } else if (result.status === 'failed' && /Failed to launch .* ENOENT|spawn .*ENOENT/i.test(result.stderr || '')) {
          result.next = 'The command referenced a missing executable or path. Check provider installs with atl_command args=["providers"].';
        }
        return result;
      }
      catch (error) { if (signal?.aborted) await stopJob(job); throw error; }
    }
    if (!fs.existsSync(path.join(root, '.trust', 'manager', 'state.json'))) throw new Error('Initialize this project with atl_command args=["init"] first.');
    // One state owner (issue #34): reuse or start the per-project daemon and
    // hand back its stable URL. The daemon outlives this plugin session and
    // exits by itself after a quiet period. The session's embed token follows
    // the daemon so panels keep their capability across reuse.
    const daemon = await ensureDaemon(root, { embedToken });
    if (!daemon.reused) serverGeneration += 1;
    signal?.throwIfAborted();
    return { project: root, url: daemon.url, lifetime: 'project daemon' };
  }
  async function close() {
    if (closed) return;
    closed = true;
    if (connectionAssistant) await connectionAssistant.then(app => app.close(), () => {});
    await Promise.allSettled([...jobs.values()].map(stopJob));
  }
  async function openPanel(project) {
    const result = await call('atl_start', { project });
    const url = new URL(result.url);
    url.searchParams.set('atl_embed', embedToken);
    return { url: url.href, origin: url.origin, project: result.project };
  }
  return { call, close, openPanel, get serverGeneration() { return serverGeneration; } };
}
