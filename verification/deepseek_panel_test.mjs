import { checkPanelPlanningAndAssistant } from "./panel-workflows.mjs";
// Render the shipped DSH browser factory against a slot/connection contract
// fixture, with a real ATL server. This does not claim a full DSH host run.
// First launch contract: only the host workspace registry selects projects;
// no workspace.json or private ATL project list is created.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { chromium } from 'playwright';

const installed = path.resolve(process.argv[2] || '../atl-marketplace/deepseek');
const reactModules = path.resolve('.tmp-ui-review/deepseek-host/node_modules');
const { verifyPluginRelease } = await import(pathToFileURL(path.join(installed, 'runtime/lib/plugin-release.mjs')));
verifyPluginRelease(installed);
const { apply } = await import(pathToFileURL(path.join(installed, 'plugins/deepseek.mjs')));
const { stopDaemon } = await import(pathToFileURL(path.join(installed, 'runtime/lib/daemon.mjs')));

// Pin ATL_HOME so runtime support state stays inside a disposable directory.
const atlHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-deepseek-home-'));
process.env.ATL_HOME = atlHome;
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-deepseek-panel-'));
const realProject = fs.realpathSync(project);
const secondProject = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-deepseek-panel-second-'));
const realSecondProject = fs.realpathSync(secondProject);
const workspaceRows = [{ id: 'first', title: 'First workspace', path: realProject }, { id: 'second', title: 'Second workspace', path: realSecondProject }];

const routes = new Map(), cleanups = [], definitions = new Map();
const ctx = { effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); }, tools: { register(tool) { definitions.set(tool.name, tool); } }, workspaceRegistry: { list: () => workspaceRows, resolveByPath: async value => workspaceRows.find(row => row.path === value) || null }, connection: { fetch: { register(route) { routes.set(route.path, route); return async () => routes.delete(route.path); } } }, inject(keys, fn) { fn(ctx); } };
apply(ctx);
assert.ok(definitions.has('atl_start'));
assert.ok(routes.has('/api/atl/open'));
assert.ok(routes.has('/api/atl/workspaces'));
const client = fs.readFileSync(path.join(installed, 'plugin-ui/deepseek-client.js'), 'utf8');
const fixture = buildSync({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';window.fixtureReact=React;window.fixtureRoot=createRoot;`, resolveDir: reactModules }, bundle: true, write: false, format: 'iife', platform: 'browser' }).outputFiles[0].text;
const shell = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${fixture.replaceAll('</script', '<\\/script')}</script><script>
const registrations=[];window.__ModuleLoader__={load(entry){window.atl=entry.factory(name=>{if(name==='react')return window.fixtureReact;throw Error(name)})}};
</script><script>${client.replaceAll('</script', '<\\/script')}</script><script>
const root=fixtureRoot(document.getElementById('root'));const slots={inject(name,fn){return fn()},register(meta,component){registrations.push({meta,component});return()=>{}}};
let active='plugins';const layout={selectPanel(id){active=id;render()}};atl.apply({slots,layout,effect(fn){return fn()},sidebarRightTabs:{register(){return()=>{}}}});
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
  assert.equal((await fetch(url + '/api/atl/open', { method: 'POST' })).status, 401);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);

  // First launch: one click into the panel, no directory setup at any point.
   await page.getByRole('button', { name: 'Open Control Plane', exact: true }).click();
  const frame = page.frameLocator('iframe[title="ATL Control Plane"]');
  await frame.locator('#mobile [data-page="tasks"]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#atl-project').count(), 0, 'first launch must auto-open without the directory form');
  assert.ok(fs.existsSync(path.join(project, '.trust', 'manager', 'state.json')), 'auto-open must initialize the host-selected workspace');
  assert.equal(fs.existsSync(path.join(atlHome, 'workspace.json')), false, 'host workspace selection must not create ATL workspace.json');

  // Work in the auto-opened workspace: task creation persists on disk.
  await frame.locator('#newBtn').click();
  await frame.locator('#fTitle').fill('Auto-opened home workspace');
  await frame.getByRole('button', { name: 'Create task', exact: true }).click();
  await frame.getByText('Auto-opened home workspace', { exact: true }).first().waitFor();
  await checkPanelPlanningAndAssistant(frame, "Auto-opened home workspace");
  assert.ok(Object.values(JSON.parse(fs.readFileSync(path.join(project, '.trust/manager/state.json'), 'utf8')).tasks).some(task => task.title === 'Auto-opened home workspace'));

  // Host theme drives the embedded page.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await frame.locator('html.light').waitFor();

  // Remount the panel component: dsh unmounts the keyed main slot on every tab
  // switch and remounts on return, so the panel must survive a fresh React mount.
  await page.evaluate(() => window.rerenderMain());
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#atl-project').count(), 0, 'panel must survive component remount without showing the project form');
  await frame.getByText('Auto-opened home workspace', { exact: true }).first().waitFor({ timeout: 30000 });

  // Change project is constrained to the host's registered workspace list.
  await page.getByRole('button', { name: 'Change project' }).click();
  await page.getByLabel('Host workspace').waitFor();
  await page.getByLabel('Host workspace').selectOption(realSecondProject);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await frame.locator('#mobile [data-page="tasks"]').waitFor({ timeout: 30000 });
  assert.ok(fs.existsSync(path.join(secondProject, '.trust/manager/state.json')), 'explicit open initializes the selected host workspace');

  // Draft survival: an unsubmitted new-task draft survives a remount + reopen.
  await frame.locator('#newBtn').click();
  await frame.locator('#fTitle').fill('Unsubmitted draft probe');
  await page.evaluate(() => window.rerenderMain());
  await frame.locator('#mobile [data-page="tasks"]').waitFor({ timeout: 30000 });
  await frame.locator('#newBtn').click();
  await frame.locator('#fTitle').waitFor({ timeout: 15000 });
  assert.equal(await frame.locator('#fTitle').inputValue(), 'Unsubmitted draft probe', 'unsubmitted draft must survive a remount');
  await frame.getByRole('button', { name: 'Cancel', exact: true }).first().click().catch(() => {});

  // Fresh page (reload-like): the workspace auto-opens from persisted memory.
  const page2 = await context.newPage();
  const errors2 = [];
  page2.on('pageerror', error => errors2.push(error.message));
  await page2.goto(url);
  await page2.getByRole('button', { name: 'Open Control Plane', exact: true }).click();
  await page2.frameLocator('iframe[title="ATL Control Plane"]').locator('#mobile [data-page="tasks"]').waitFor({ timeout: 30000 });
  assert.equal(await page2.locator('#atl-project').count(), 0, 'a fresh page must auto-open the remembered workspace');
  await page2.getByText(realSecondProject, { exact: true }).first().waitFor({ timeout: 15000 });

  // Fresh browser profile (no localStorage): the host registry still resolves
  // the project; no private workspace record is needed.
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page3 = await context2.newPage();
  const errors3 = [];
  page3.on('pageerror', error => errors3.push(error.message));
  await page3.goto(url);
  await page3.getByRole('button', { name: 'Open Control Plane', exact: true }).click();
  await page3.frameLocator('iframe[title="ATL Control Plane"]').locator('#mobile [data-page="tasks"]').waitFor({ timeout: 30000 });
  assert.equal(await page3.locator('#atl-project').count(), 0, 'a fresh profile must auto-open a host workspace');
  await page3.getByText(realSecondProject, { exact: true }).first().waitFor({ timeout: 15000 });

  fs.mkdirSync('.tmp-ui-review/deepseek-evidence', { recursive: true });
  await page3.screenshot({ path: '.tmp-ui-review/deepseek-evidence/embedded-desktop.png', fullPage: true });

  // Switching back to another registered workspace restores its prior task.
  await page2.getByRole('button', { name: 'Change project' }).click();
  await page2.getByLabel('Host workspace').selectOption(realProject);
  await page2.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page2.frameLocator('iframe[title="ATL Control Plane"]').locator('#mobile [data-page="tasks"]').waitFor({ timeout: 30000 });
  await page2.frameLocator('iframe[title="ATL Control Plane"]').getByText('Auto-opened home workspace', { exact: true }).first().waitFor();

  await page2.close();
  await page3.close();
  const cookie = 'fixture_owner=1';
  const unknown = await fetch(url + '/api/atl/request', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'missing', path: '/api/snapshot' }) });
  assert.equal(unknown.status, 400);
  const external = await fetch(url + '/api/atl/request', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'missing', path: 'https://example.com/' }) });
  assert.equal(external.status, 400);
  assert.deepEqual([...errors, ...errors2, ...errors3], []);
  console.log('PASS: shipped DeepSeek factory, host workspace selection without workspace.json, task persistence, theme sync, remount survival, workspace switching, fresh-profile open, expired panel and external-path rejection (DSH contract fixture)');
} finally {
  await browser?.close();
  for (const close of cleanups.reverse()) await close();
  await stopDaemon(realProject).catch(() => {});
  await stopDaemon(realSecondProject).catch(() => {});
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  fs.rmSync(secondProject, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  fs.rmSync(atlHome, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
