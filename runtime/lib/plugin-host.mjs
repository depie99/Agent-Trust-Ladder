// Shared full-runtime bridge for native harness plugins and stdio MCP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const bundleRoot = fileURLToPath(new URL('../../', import.meta.url));
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const project = { type: 'string', description: 'Absolute path of the application to manage, explicitly selected by the user. Never the plugin installation directory.' };
const str = { type: 'string' };
export const pluginTools = [
  { name: 'atl_connect', description: 'Open the local ATL connection assistant: choose a harness, copy matching connection settings, switch English/Persian and open a project. No project is initialized until explicitly selected and opened. Returns a browser URL; does not launch workers.', inputSchema: schema() },
  { name: 'atl_start', description: 'Start ATL for the selected application in one step: initialize missing ATL project state, preserve existing state, and return the full Control Plane URL. Use for an authorized setup or open-dashboard request. Does not launch workers.', inputSchema: schema({ project }, ['project']) },
  { name: 'atl_info', description: 'Discover the bundled ATL runtime, skill catalog and usage. Does not initialize projects or install anything.', inputSchema: schema(), readOnly: true },
  { name: 'atl_skill', description: 'Read a bundled ATL skill or one of its supporting files. Start with name=atl; follow its workflow and trust gates.', inputSchema: schema({ name: str, file: { ...str, description: 'Path within the skill, default SKILL.md. References are loaded on demand.' } }, ['name']), readOnly: true },
  { name: 'atl_command', description: 'Execute the full bundled ATL CLI in the selected project, without a global atl installation. Pass argv as separate strings (e.g. ["init"], ["compose","--title","Fix login"], ["run",id,"--dry-run"]). Returns a job; poll atl_job until finished. Mutates state, may run providers or external operations depending on argv. Existing ATL and host approval gates apply; never invent user approval or add --confirm on your own.', inputSchema: schema({ project, args: { type: 'array', items: str, minItems: 1, maxItems: 128 }, wait_ms: { type: 'integer', minimum: 0, maximum: 10000 } }, ['project', 'args']) },
  { name: 'atl_job', description: 'Read output and exit status of a command started in this plugin session. A running job is not completion evidence. Use the Control Plane to stop provider runs safely.', inputSchema: schema({ id: str, wait_ms: { type: 'integer', minimum: 0, maximum: 10000 } }, ['id']), readOnly: true },
  { name: 'atl_control_plane', description: 'Start or reuse the complete ATL Control Plane for an initialized project. Returns a loopback URL to open in the browser. Does not launch workers. The server lives until the plugin unloads; project state survives.', inputSchema: schema({ project }, ['project']) },
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
  const root = fs.realpathSync(value);
  if (!fs.statSync(root).isDirectory()) throw new Error('project must be a directory.');
  const relative = path.relative(fs.realpathSync(bundleRoot), root);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Select an application outside the plugin installation.');
  return root;
}

export function createPluginHost() {
  const jobs = new Map();
  const servers = new Map();
  let closed = false;
  let connectionAssistant;
  const outputLimit = 65536;

  function snapshot(job) {
    return { id: job.id, project: job.project, args: job.args, status: job.status, exitCode: job.exitCode, signal: job.signal, stdout: job.stdout, stderr: job.stderr, truncated: job.truncated };
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
      cwd: root, env: { ...process.env, ATL_PROJECT: root, ATL_NO_OPEN: '1' },
      shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const job = { id: randomUUID(), project: root, args: [...args], status: 'running', exitCode: null, signal: null, stdout: '', stderr: '', truncated: false, child };
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', chunk => { const value = job[stream] + chunk; job.truncated ||= value.length > outputLimit; job[stream] = value.slice(-outputLimit); });
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
    if (name === 'atl_info') return {
      version: JSON.parse(fs.readFileSync(path.join(bundleRoot, 'package.json'), 'utf8')).version,
      skills: fs.readdirSync(path.join(bundleRoot, 'skills')).filter(name => fs.existsSync(path.join(bundleRoot, 'skills', name, 'SKILL.md'))).sort(),
      instructions: 'Read atl_skill(name="atl") first. For an authorized setup or dashboard request, call atl_start with the absolute application path. All runtime commands use this bundle; no global atl install is required. Provider CLIs/authentication and feature-specific tools still need to be available. Native harness tools do not automatically become unattended ATL workers.',
    };
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
    if (name === 'atl_start') {
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
      try { const result = await wait(job, args.wait_ms, signal); signal?.throwIfAborted(); return result; }
      catch (error) { if (signal?.aborted) await stopJob(job); throw error; }
    }
    if (!fs.existsSync(path.join(root, '.trust', 'manager', 'state.json'))) throw new Error('Initialize this project with atl_command args=["init"] first.');
    // Store the promise before awaiting, so concurrent calls cannot open two servers.
    let createdUi;
    if (!servers.has(root)) {
      // The runtime owns process-global run/abort state. One process per UI
      // prevents a second project's server from sharing those execution controls.
      const job = command(root, ['ui', '--host', '127.0.0.1', '--port', '0', '--no-open'], { interfaceProcess: true });
      createdUi = job;
      const pending = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { void stopJob(job); reject(new Error('Control Plane did not start within 15 seconds.')); }, 15000);
        const observe = () => {
          const match = job.stdout.match(/ATL browser control plane: (http:\/\/127\.0\.0\.1:\d+\/)/);
          if (match) { clearTimeout(timer); job.child.stdout.off('data', observe); resolve({ url: match[1] }); }
        };
        job.child.stdout.on('data', observe);
        job.done.then(() => {
          clearTimeout(timer);
          reject(new Error(`Control Plane exited: ${job.stderr || job.stdout}`));
          if (servers.get(root) === pending) servers.delete(root);
        });
      });
      servers.set(root, pending);
      pending.catch(() => { if (servers.get(root) === pending) servers.delete(root); });
    }
    const abort = () => { if (createdUi) void stopJob(createdUi); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const running = await servers.get(root);
      signal?.throwIfAborted();
      return { project: root, url: running.url, lifetime: 'plugin session' };
    } catch (error) {
      if (signal?.aborted && createdUi) await stopJob(createdUi);
      throw error;
    } finally { signal?.removeEventListener('abort', abort); }
  }
  async function close() {
    if (closed) return;
    closed = true;
    if (connectionAssistant) await connectionAssistant.then(app => app.close(), () => {});
    await Promise.allSettled([...jobs.values()].map(stopJob));
  }
  return { call, close };
}
