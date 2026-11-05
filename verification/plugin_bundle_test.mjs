// Prove the consumer-facing distribution, not only repository imports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildPlugins } from '../scripts/build-plugins.mjs';

const root = path.resolve(import.meta.dirname, '..');
const scratchRoot = path.join(root, '.trust', 'plugin-test');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'run-'));
const children = [];
const cleanup = [];

function client(bundle, variable, legacy = false) {
  const config = variable === 'universal' ? { mcpServers: { atl: { command: 'node', args: [path.join(bundle, 'runtime', 'atl-plugin-mcp.mjs')] } } } : JSON.parse(fs.readFileSync(path.join(bundle, variable === '${extensionPath}' ? 'gemini-extension.json' : legacy || variable === '${CLAUDE_PLUGIN_ROOT}' ? '.mcp.json' : 'mcp.json'), 'utf8'));
  const server = config.mcpServers.atl;
  const args = server.args.map(arg => variable && variable !== 'universal' ? arg.replace(variable, bundle) : arg);
  const cwd = server.cwd ? path.resolve(bundle, server.cwd) : scratch;
  assert.ok(fs.existsSync(path.resolve(cwd, args[0])), 'manifest resolves to an actual shipped executable');
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ATL_PROJECT: path.join(scratch, 'wrong-inherited-project'), ATL_HOME: path.join(scratch, 'user-home'), ATL_NO_OPEN: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  children.push(child);
  let buffer = '', stderr = '', seq = 0;
  const waiting = new Map();
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let index; (index = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line) continue;
      let value;
      try { value = JSON.parse(line); } catch { assert.fail(`MCP stdout contains non-JSON: ${line}`); }
      const pending = waiting.get(value.id);
      if (pending) { clearTimeout(pending.timer); waiting.delete(value.id); pending.resolve(value); }
    }
  });
  child.on('exit', () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error(`MCP exited: ${stderr}`)); } waiting.clear(); });
  function request(method, params = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`MCP timed out: ${method}; ${stderr}`)); }, 30000);
      waiting.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async function tool(name, args = {}, error = false) {
    const response = await request('tools/call', { name, arguments: args });
    assert.equal(response.result.isError, error, JSON.stringify(response));
    const text = response.result.content[0].text;
    if (error) { try { return JSON.parse(text); } catch { return text; } }
    return JSON.parse(text);
  }
  async function close() {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 10000);
    await exited; clearTimeout(timer);
    assert.equal(child.exitCode, 0, stderr);
  }
  return { request, tool, close, cancelLast: () => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: seq } }) + '\n') };
}

async function finish(api, value) {
  const deadline = Date.now() + 60000;
  while (value.status === 'running' && Date.now() < deadline) value = await api.tool('atl_job', { id: value.id, wait_ms: 1000 });
  assert.equal(value.status, 'completed', JSON.stringify(value));
  return value;
}

try {
  const bundles = buildPlugins({ out: path.join(scratch, 'bundles') });
  assert.throws(() => buildPlugins({ out: path.join(scratch, 'bundles') }), /Output exists/);
  assert.throws(() => buildPlugins({ out: path.dirname(root) }), /inside this checkout/);
  const catalog = JSON.parse(fs.readFileSync(path.join(scratch, 'bundles', '.agents', 'plugins', 'marketplace.json')));
  assert.ok(fs.existsSync(path.join(scratch, 'bundles', catalog.plugins[0].source.path, 'plugin.json')));
  for (const bundle of bundles) {
    for (const file of ['runtime/atl-manager.mjs', 'runtime/atl-plugin-mcp.mjs', 'runtime/atl-connect.mjs', 'runtime/connect.html', 'runtime/connect.css', 'runtime/connect.js', 'start.cmd', 'start.sh', 'runtime/control-plane.html', 'runtime/control-plane-client.js', 'config/manager-state-contract.json', 'skills/atl/SKILL.md', 'skills/atl-team/SKILL.md', 'skills/atl-plugin/SKILL.md']) assert.ok(fs.existsSync(path.join(bundle.path, file)), `${bundle.target}: complete runtime and skills`);
    assert.ok(!fs.existsSync(path.join(bundle.path, 'node_modules')), 'runtime needs no npm install');
    if (bundle.target === 'deepseek') continue;
    const variable = { codex: '${PLUGIN_ROOT}', claude: '${CLAUDE_PLUGIN_ROOT}', cursor: '${CURSOR_PLUGIN_ROOT}', gemini: '${extensionPath}', universal: 'universal' }[bundle.target];
    const api = client(bundle.path, variable);
    const initialized = await api.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'atl-test', version: '1' } });
    assert.equal(initialized.result.protocolVersion, '2025-06-18');
    const tools = await api.request('tools/list');
    assert.equal(tools.result.tools.find(t => t.name === 'atl_command').annotations.readOnlyHint, false);
    const info = await api.tool('atl_info');
    const connect = await api.tool('atl_connect');
    assert.equal((await fetch(connect.url)).status, 200);
    assert.equal((await api.tool('atl_connect')).url, connect.url, 'connection assistant is reused');
    assert.ok(info.skills.includes('atl-team'));
    const skill = await api.tool('atl_skill', { name: 'atl' });
    assert.match(skill.content, /ATL/);
    const reference = await api.tool('atl_skill', { name: 'atl', file: 'references/routing.md' });
    assert.ok(reference.content.length > 100);
    await api.tool('atl_skill', { name: 'atl', file: '../../package.json' }, true);
    await api.tool('atl_command', { project: '.', args: ['init'] }, true);
    await api.tool('atl_command', { project: bundle.path, args: ['init'] }, true);
    const project = path.join(scratch, `application with spaces ${bundle.target}`);
    fs.mkdirSync(project);
    await api.tool('atl_control_plane', { project }, true);
    await finish(api, await api.tool('atl_command', { project, args: ['init'], wait_ms: 0 }));
    assert.ok(fs.existsSync(path.join(project, '.trust', 'manager', 'state.json')));
    assert.ok(!fs.existsSync(path.join(bundle.path, '.trust')), 'plugin install stays unchanged');
    assert.ok(!fs.existsSync(path.join(scratch, 'wrong-inherited-project')), 'inherited ATL_PROJECT cannot redirect writes');
    const title = 'Literal $() ` text & semicolon; preserved';
    const composed = await finish(api, await api.tool('atl_command', { project, args: ['compose', '--title', title, '--check', 'bounded check observed'] }));
    assert.match(composed.stdout, /composer/);
    const stateFile = path.join(project, '.trust', 'manager', 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile));
    const task = Object.values(state.tasks)[0];
    assert.equal(task.title, title, 'argv is data, not shell syntax');
    assert.equal(Object.keys(state.tasks).length, 1);
    if (bundle.target === 'codex') {
      const pending = api.request('tools/call', { name: 'atl_command', arguments: { project, args: ['dashboard', '--once', '--plain'], wait_ms: 10000 } });
      api.cancelLast();
      assert.equal((await pending).result.isError, true, 'MCP cancellation settles the unpublished command');
      assert.equal((await api.request('ping')).error, undefined, 'the transport remains usable after cancellation');
    }
    const bad = await api.tool('atl_command', { project, args: ['move', task.id, 'done', '--actor', 'rowan'], wait_ms: 10000 }, true);
    assert.ok(bad.status === 'failed');
    assert.notEqual(JSON.parse(fs.readFileSync(stateFile)).tasks[task.id].status, 'done', 'plugin preserves lifecycle gates');
    const ui = await api.tool('atl_control_plane', { project });
    const same = await api.tool('atl_control_plane', { project });
    assert.equal(ui.url, same.url);
    if (bundle.target === 'codex') {
      const otherProject = path.join(scratch, 'second application'); fs.mkdirSync(otherProject);
      await finish(api, await api.tool('atl_command', { project: otherProject, args: ['init'] }));
      const otherUi = await api.tool('atl_control_plane', { project: otherProject });
      assert.notEqual(otherUi.url, ui.url, 'projects have separate Control Plane listeners');
      const otherState = await fetch(`${otherUi.url}api/snapshot`).then(r => r.json());
      assert.equal(Object.keys(otherState.state.tasks).length, 0, 'the other project does not inherit tasks');
    }
    const html = await fetch(ui.url).then(r => r.text());
    assert.match(html, /Control Plane/);
    const snapshot = await fetch(`${ui.url}api/snapshot`).then(r => r.json());
    assert.equal(snapshot.state.tasks[task.id].title, title);
    // A real spawned worker proves the CLI and UI share the execution engine.
    // Synthetic node fixture: no credentials, paid model, or external writes.
    const configFile = path.join(project, 'config', 'manager.json');
    const config = JSON.parse(fs.readFileSync(configFile));
    const marker = path.join(project, 'provider-ran.txt');
    config.providers = { default: 'fixture', auth: 'subscription', catalog: { fixture: { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'observed');`] } } };
    fs.writeFileSync(configFile, JSON.stringify(config));
    const workspace = path.join(scratch, `worker workspace ${bundle.target}`);
    fs.mkdirSync(workspace);
    Object.assign(task, { status: 'assigned', assigned_worker: 'rowan', objective: 'Observe the bundled execution engine', completion_checks: [], workspace });
    fs.writeFileSync(stateFile, JSON.stringify(state));
    const preview = await fetch(`${ui.url}api/run/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskIds: [task.id] }) });
    assert.equal(preview.status, 200);
    assert.ok(!fs.existsSync(marker), 'preview does not execute the provider');
    const start = await fetch(`${ui.url}api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, taskIds: [task.id], maxSessions: 1, maxMinutes: 1 }) });
    assert.equal(start.status, 202);
    const deadline = Date.now() + 30000;
    let run;
    do { run = await fetch(`${ui.url}api/run`).then(r => r.json()); if (run.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
    assert.notEqual(run.status, 'running');
    assert.ok(fs.existsSync(marker), JSON.stringify(run));
    assert.equal(fs.readFileSync(marker, 'utf8'), 'observed');
    assert.notEqual(JSON.parse(fs.readFileSync(stateFile)).tasks[task.id].status, 'done', 'worker exit alone does not complete a task');
    await api.close();
    await assert.rejects(fetch(ui.url), 'unloading closes the owned UI server');
    if (bundle.target === 'codex') {
      const compatibility = client(bundle.path, '', true);
      assert.ok((await compatibility.tool('atl_info')).skills.includes('atl'));
      await compatibility.close();
    }
    console.log(`PASS: ${bundle.target} distribution initializes, composes, gates, serves and executes a bounded fixture worker`);
  }

  // Exercise the native adapter from the archive consumers actually install.
  const dsh = bundles.find(b => b.target === 'deepseek');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: dsh.path, encoding: 'utf8', shell: process.platform === 'win32' }));
  const files = packed[0].files.map(file => file.path);
  for (const file of ['cordis.patch.yml', 'plugins/deepseek.mjs', 'runtime/atl-manager.mjs', 'runtime/atl-plugin-mcp.mjs', 'skills/atl-plugin/SKILL.md']) assert.ok(files.includes(file), `DSH tarball includes ${file}`);
  assert.ok(!files.some(file => file.startsWith('.trust/') || file.startsWith('node_modules/')));
  const extracted = path.join(scratch, 'extracted'); fs.mkdirSync(extracted);
  execFileSync('tar', ['-xf', path.join(scratch, packed[0].filename), '-C', extracted]);
  const installed = path.join(extracted, 'package');
  const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json')));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  const definitions = new Map();
  const adapter = await import(pathToFileURL(path.join(installed, 'plugins', 'deepseek.mjs')));
  // The DSH JSON Schema subset is stricter than MCP; model schemas must be
  // consumable by Native and PTC type generation, not only our execute fixture.
  const allowedSchemaKeys = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'description', 'title', 'default', 'examples', 'enum', 'const', 'oneOf']);
  function supportedSchema(schema) {
    for (const key of Object.keys(schema)) assert.ok(allowedSchemaKeys.has(key), `DSH unsupported schema keyword: ${key}`);
    for (const value of Object.values(schema.properties || {})) supportedSchema(value);
    if (schema.items) supportedSchema(schema.items);
  }
  adapter.apply({ effect: factory => cleanup.push(factory()), tools: { register: definition => { supportedSchema(definition.parameters); supportedSchema(definition.output.schema); definitions.set(definition.name, definition); } } });
  const exec = { signal: new AbortController().signal };
  const native = async (name, args) => definitions.get(name).execute(args, exec);
  assert.ok((await native('atl_info', {})).skills.includes('atl-plugin'));
  assert.match((await native('atl_skill', { name: 'atl-plugin' })).content, /Control Plane/);
  const dshProject = path.join(scratch, 'deepseek application'); fs.mkdirSync(dshProject);
  const nativeApi = { tool: native };
  await finish(nativeApi, await native('atl_command', { project: dshProject, args: ['init'] }));
  const nativeUi = await native('atl_control_plane', { project: dshProject });
  assert.equal((await fetch(nativeUi.url)).status, 200);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(definitions.get('atl_command').execute({ project: dshProject, args: ['compose', '--title', 'must not run'] }, { signal: aborted.signal }));
  await assert.rejects(native('atl_command', { project: dshProject, args: [], wait_ms: 0 }));
  await assert.rejects(native('atl_job', { id: 'missing', wait_ms: 10001 }));
  // Cancellation before a command handle is published must settle owned work.
  const cancel = new AbortController();
  const cancelled = definitions.get('atl_command').execute({ project: dshProject, args: ['dashboard', '--once', '--plain'], wait_ms: 10000 }, { signal: cancel.signal });
  cancel.abort();
  await assert.rejects(cancelled);
  const nativeValue = await native('atl_info', {});
  assert.equal(JSON.parse(definitions.get('atl_info').output.render({}, nativeValue)[0].text).version, pkg.version);
  for (const close of cleanup.splice(0)) await close();
  await assert.rejects(fetch(nativeUi.url));
  console.log('PASS: DeepSeek native registration, skills, initialization, UI and cancellation contract (host contract fixture)');

  console.log('PASS: installable DeepSeek tarball contains the full runtime and skills, with no install scripts or local state');
} finally {
  for (const close of cleanup) await close();
  await Promise.all(children.filter(child => child.exitCode === null).map(child => new Promise(resolve => {
    child.once('exit', resolve); child.stdin.end(); child.kill();
  })));
  // Scratch is an exact mkdtemp child of this project's .trust/plugin-test.
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
