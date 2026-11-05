import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPlugins } from '../scripts/build-plugins.mjs';
import { connectionProfile, harnessCatalog } from '../runtime/lib/harness-catalog.mjs';

const root = path.resolve(import.meta.dirname, '..');
const scratchRoot = path.join(root, '.trust', 'plugin-test');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'connect-'));
const [bundle] = buildPlugins({ out: path.join(scratch, 'bundles'), targets: ['universal'] });
const { startConnect } = await import(pathToFileURL(path.join(bundle.path, 'runtime', 'atl-connect.mjs')));
const app = await startConnect();
try {
  const html = await fetch(app.url); assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await html.text(), /Open Control Plane/);
  for (const asset of ['connect.css', 'connect.js']) assert.equal((await fetch(new URL(asset, app.url))).status, 200);
  const data = await (await fetch(new URL('api/connect', app.url))).json();
  assert.equal(data.profiles.length, harnessCatalog.length);
  for (const entry of data.profiles.filter(p => !['native', 'toml'].includes(p.format))) {
    const value = JSON.parse(entry.config);
    const server = value.mcpServers?.atl || value.servers?.atl || value.context_servers?.atl || value.mcp?.servers?.atl || value.mcp?.atl;
    const command = Array.isArray(server.command) ? server.command : [server.command, ...server.args];
    assert.equal(command[0], process.execPath);
    assert.equal(command[1], path.join(bundle.path, 'runtime', 'atl-plugin-mcp.mjs'));
  }
  assert.match(connectionProfile('codex', root).config, /^\[mcp_servers.atl\]/);
  assert.throws(() => connectionProfile('unknown', root), /Unknown harness/);
  const post = (body, overrides = {}) => fetch(new URL('api/start', app.url), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url.slice(0, -1), 'X-ATL-Token': data.token, ...overrides }, body: JSON.stringify(body) });
  assert.equal((await post({ project: scratch }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post({ project: scratch }, { 'X-ATL-Token': 'wrong' })).status, 403);
  assert.ok(!fs.existsSync(path.join(scratch, '.trust')));
  assert.equal((await post({ project: '.' })).status, 400);
  assert.equal((await post({ project: bundle.path })).status, 400);
  const response = await post({ project: scratch }); assert.equal(response.status, 200, await response.clone().text());
  const started = await response.json(); assert.equal(started.initialized, true);
  assert.equal((await fetch(started.url)).status, 200);
  const state = path.join(scratch, '.trust', 'manager', 'state.json'); const before = fs.readFileSync(state, 'utf8');
  const resumed = await (await post({ project: scratch })).json();
  assert.equal(resumed.url, started.url); assert.equal(resumed.initialized, false);
  assert.equal(fs.readFileSync(state, 'utf8'), before, 'opening an initialized project preserves its state');
  await app.close();
  await assert.rejects(fetch(started.url), /fetch failed/);
  console.log('PASS: connection profiles, guarded onboarding, full Control Plane, resume and shutdown');
} finally {
  await app.close();
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
