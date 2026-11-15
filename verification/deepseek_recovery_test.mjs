// Recovery: when the spawned ATL control plane dies while hidden, re-selecting the
// panel must heal to a freshly spawned server (new panel id) without a harness restart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { chromium } from 'playwright';

const installed = path.resolve(process.argv[2] || '../atl-marketplace/deepseek');
const reactModules = path.resolve('.tmp-ui-review/deepseek-host/node_modules');
const { verifyPluginRelease } = await import(pathToFileURL(path.join(installed, 'runtime/lib/plugin-release.mjs')));
verifyPluginRelease(installed);
const { apply } = await import(pathToFileURL(path.join(installed, 'plugins/deepseek.mjs')));
const routes = new Map(), cleanups = [], definitions = new Map();
const ctx = { effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); }, tools: { register(tool) { definitions.set(tool.name, tool); } }, connection: { fetch: { register(route) { routes.set(route.path, route); return async () => routes.delete(route.path); } } }, inject(keys, fn) { fn(ctx); } };
apply(ctx);
assert.ok(definitions.has('atl_start'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-deepseek-recovery-'));
const client = fs.readFileSync(path.join(installed, 'plugin-ui/deepseek-client.js'), 'utf8');
const fixture = buildSync({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';window.fixtureReact=React;window.fixtureRoot=createRoot;`, resolveDir: reactModules }, bundle: true, write: false, format: 'iife', platform: 'browser' }).outputFiles[0].text;
const shell = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${fixture.replaceAll('</script', '<\\/script')}</script><script>
const registrations=[];window.__ModuleLoader__={load(entry){window.atl=entry.factory(name=>{if(name==='react')return window.fixtureReact;throw Error(name)})}};
</script><script>${client.replaceAll('</script', '<\\/script')}</script><script>
const root=fixtureRoot(document.getElementById('root'));const slots={inject(name,fn){return fn()},register(meta,component){registrations.push({meta,component});return()=>{}}};
let active='plugins';const layout={selectPanel(id){active=id;render()}};atl.apply({slots,layout});
function render(){const entry=registrations.find(r=>active==='plugins'?r.meta.name==='plugins.bundle.config':r.meta.name==='main'&&r.meta.key===active);window.__remountSeq=(window.__remountSeq||0)+1;root.render(fixtureReact.createElement('main',{style:{height:'100vh'}},fixtureReact.createElement(entry.component,{key:'m'+window.__remountSeq})))}render();window.rerenderMain=()=>render();
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/') { res.setHeader('set-cookie', 'fixture_owner=1; HttpOnly; SameSite=Strict; Path=/'); res.setHeader('content-type', 'text/html'); res.end(shell); return; }
    const route = routes.get(url.pathname);
    if (!route || !route.methods.includes(req.method)) { res.writeHead(404); res.end(); return; }
    if (!req.headers.cookie?.includes('fixture_owner=1')) { res.writeHead(401); res.end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const controller = new AbortController(); res.on('close', () => controller.abort());
    const response = await route.fetch(new Request(url.href, { method: req.method, headers: req.headers, signal: controller.signal, ...(!['GET', 'HEAD'].includes(req.method) ? { body } : {}) }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: 'Open Control Plane', exact: true }).click();
  await page.getByLabel('Project directory').fill(project);
  await page.getByRole('button', { name: 'Open Control Plane', exact: true }).click();
  const frame = page.frameLocator('iframe[title="ATL Control Plane"]');
  await frame.locator('#mobile [data-page="tasks"]').waitFor({ timeout: 30000 });
  const framePage = page.frames().find(f => f.url().includes('/api/atl/view'));
  const firstId = new URL(framePage.url()).searchParams.get('id');

  // Kill every spawned ATL control plane of this fixture host process.
  const children = execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | Where-Object {$_.Name -eq 'node.exe'} | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' }).split('\r\n').filter(Boolean).map(Number);
  assert.ok(children.length > 0, 'expected at least one spawned ATL server child');
  for (const pid of children) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already exited */ } }
  await page.waitForTimeout(1000);

  // Remount the panel (what a dsh tab switch does) — it must self-heal to a new server.
  await page.evaluate(() => window.rerenderMain());
  await frame.locator('#mobile [data-page="tasks"]').waitFor({ timeout: 60000 });
  const healedFrame = page.frames().find(f => f.url().includes('/api/atl/view'));
  const healedId = new URL(healedFrame.url()).searchParams.get('id');
  assert.notEqual(healedId, firstId, 'a dead generation must heal to a fresh panel id');
  assert.deepEqual(errors, []);
  console.log(`PASS: control plane death healed on remount (panel ${firstId.slice(0, 8)}… → ${healedId.slice(0, 8)}…) without harness restart`);
} finally {
  await browser?.close();
  for (const close of cleanups.reverse()) await close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(project, { recursive: true, force: true });
}
