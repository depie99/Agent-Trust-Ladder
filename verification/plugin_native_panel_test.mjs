import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { verifyPluginRelease } from '../runtime/lib/plugin-release.mjs';

const installed = process.argv[2];
if (!installed) throw new Error('Pass the extracted ZCode plugin directory.');
const release = verifyPluginRelease(installed);
assert.equal(release.format, 3);
const manifest = JSON.parse(fs.readFileSync(path.join(installed, '.zcode-plugin/plugin.json')));
assert.equal(manifest.ui.surfaces[0].resourceUri, 'ui://atl/control-plane.html');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-native-panel-'));
const child = spawn(process.execPath, [path.join(installed, 'runtime/atl-plugin-mcp.mjs')], { cwd: project, env: { ...process.env, ATL_PLUGIN_PROJECT: project }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const pending = new Map(); let buffer = '', seq = 0, stderr = '';
child.stderr.on('data', chunk => stderr += chunk);
child.stdout.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) >= 0;) { const response = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); const waiting = pending.get(response.id); if (waiting) { pending.delete(response.id); waiting(response); } } });
const request = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`${method} timed out: ${stderr}`)), 30000); pending.set(id, value => { clearTimeout(timer); resolve(value); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
let browser, outer;
try {
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'atl-native-panel-test', version: '1' } });
  assert.ok(init.result.capabilities.resources);
  const listed = await request('resources/list');
  assert.equal(listed.result.resources[0].uri, manifest.ui.surfaces[0].resourceUri);
  const read = await request('resources/read', { uri: listed.result.resources[0].uri });
  const content = read.result.contents[0];
  assert.equal(content.mimeType, 'text/html;profile=mcp-app');
  const origin = content._meta.ui.csp.resourceDomains[0];
  const url = content.text.match(/data-url="([^"]+)"/)?.[1].replaceAll('&amp;', '&');
  assert.ok(url?.startsWith(origin));
  async function readOwnerSnapshot() {
    const root = await fetch(url, { redirect: 'error' });
    assert.equal(root.status, 200, 'valid embedded entry opens an owner session');
    const cookie = root.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
    const html = await root.text();
    const csrf = html.match(/<meta\s+name="atl-csrf"\s+content="([^"]+)"/i)?.[1];
    assert.ok(cookie && csrf, 'embedded entry provides owner cookie and CSRF token');
    const response = await fetch(`${origin}/api/snapshot`, { headers: { cookie, 'x-atl-csrf': csrf } });
    assert.equal(response.status, 200, 'owner session may read the live snapshot');
    return response.json();
  }
  assert.ok(content.text.includes('ATL Control Plane'));
  const panelScript = content.text.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(panelScript, 'panel resource must contain its bundled script');
  try { new vm.Script(panelScript); }
  catch (error) { throw new Error(`delivered panel script is invalid: ${error.message}`); }
  assert.ok(fs.existsSync(path.join(project, '.trust/manager/state.json')));
  const invalid = await fetch(`${origin}/?atl_embed=invalid`);
  assert.equal(invalid.status, 403);
  // Exercise the HTML returned by resources/read, including its bundled script
  // and MCP Apps handshake. Loading the Control Plane URL directly would miss
  // syntax errors introduced while assembling the panel resource.
  outer = http.createServer(async (req, response) => {
    if (req.url === '/rpc') {
      let body = ''; for await (const chunk of req) body += chunk;
      const result = await request('tools/call', JSON.parse(body));
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(result.result));
    }
    if (req.url === '/panel') {
      response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': `frame-src 'none'; base-uri ${origin}` });
      return response.end(content.text);
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><iframe id="panel" src="/panel" style="width:100%;height:800px"></iframe><script>
      window.addEventListener('message', async event => {
        const request = event.data;
        if (event.source !== document.querySelector('#panel').contentWindow) return;
        if (request?.method === 'tools/call') {
          const result = await fetch('/rpc', {method:'POST', body:JSON.stringify(request.params)}).then(r=>r.json());
          event.source.postMessage({jsonrpc:'2.0',id:request.id,result}, '*'); return;
        }
        if (request?.method !== 'ui/initialize') return;
        event.source.postMessage({jsonrpc:'2.0', id:request.id, result:{protocolVersion:request.params.protocolVersion, hostInfo:{name:'ATL test host',version:'1'}, hostCapabilities:{}, hostContext:{displayMode:'fullscreen'}}}, '*');
      });
    </script>`);
  });
  await new Promise(resolve => outer.listen(0, 'localhost', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://localhost:${outer.address().port}`);
  const frame = page.frameLocator('#panel');
  await frame.locator('[data-page="tasks"]:visible').first().waitFor();
  assert.deepEqual(pageErrors, [], 'panel bootstrap must execute without JavaScript errors');
  assert.equal(await frame.locator('body').evaluate(() => new Promise(resolve => {
    const stream = new EventSource('/api/events');
    stream.addEventListener('snapshot', event => { stream.close(); resolve(Boolean(JSON.parse(event.data).snapshot)); });
    stream.onerror = () => { stream.close(); resolve(false); };
  })), true, 'live snapshots must cross the native bridge');
  const result = await frame.locator('body').evaluate(async () => {
    const csrf = document.querySelector('meta[name="atl-csrf"]').content;
    const response = await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json', 'x-atl-csrf': csrf }, body: JSON.stringify({ command: 'queue create native-panel-test' }) });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const snapshot = await readOwnerSnapshot();
  assert.ok(snapshot.queues?.some?.(queue => queue.id === 'native-panel-test') || JSON.stringify(snapshot).includes('native-panel-test'));
  // Plugin presentation contract: the packaged panel marks its context, uses
  // compact navigation, keeps detail navigation working and follows host theme.
  assert.equal(await frame.locator('html').evaluate(el => el.dataset.atlContext), 'plugin', 'panel-entry must mark the plugin presentation context');
  assert.equal(await frame.locator('html').evaluate(el => el.classList.contains('light')), false, 'host without a theme defaults to dark');
  for (const destination of ['tasks', 'attention', 'studio', 'more']) await frame.locator(`#mobile [data-page="${destination}"]`).first().waitFor();
  assert.equal(await frame.locator('.sidebar').evaluate(el => getComputedStyle(el).display), 'none', 'plugin hides the browser sidebar');
  const created = await frame.locator('body').evaluate(async () => {
    const csrf = document.querySelector('meta[name="atl-csrf"]').content;
    const response = await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json', 'x-atl-csrf': csrf }, body: JSON.stringify({ command: 'task create --title "Native plugin detail check" --priority normal' }) });
    return { ok: response.ok, body: await response.json() };
  });
  assert.ok(created.ok, JSON.stringify(created.body));
  await frame.locator('[data-task] .task-main-copy').first().click();
  await frame.locator('.plugin-task-pane').first().waitFor();
  await page.setViewportSize({ width: 420, height: 760 });
  // Re-enter the tasks list after resizing so the harness exercises its
  // narrow-screen task-to-detail navigation rather than stale desktop DOM.
  await frame.locator('#mobile [data-page="tasks"]').first().click();
  await frame.locator('[data-task] .task-main-copy').first().click();
  await frame.locator('.task-detail-screen').waitFor();
  await frame.locator('[data-action="plugin-back"]').first().click();
  await frame.locator('[data-task]').first().waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.querySelector('#panel').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light', displayMode: 'inline' } }, '*'));
  await frame.locator('html.light').waitFor();
  assert.equal(await frame.locator('html').evaluate(el => el.dataset.atlDisplay), 'inline', 'display mode rides the host context');
  const denied = await request('tools/call', {name:'atl_panel_request', arguments:{path:'https://example.com/'}});
  assert.equal(denied.result.isError, true, 'panel gateway cannot reach another origin');
  const csrfDenied = await request('tools/call', {name:'atl_panel_request', arguments:{path:'/api/command',method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'queue create forbidden'})}});
  assert.equal(JSON.parse(csrfDenied.result.content[0].text).status, 403, 'gateway preserves CSRF enforcement');
  console.log(`PASS native panel without nested navigation, full UI, authenticated mutation, CSRF and origin isolation, plugin composition and host theme (${release.version})`);
} finally {
  await browser?.close();
  if (outer) await new Promise(resolve => outer.close(resolve));
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.stdin.end();
  await Promise.race([stopped, new Promise(resolve => setTimeout(() => { child.kill(); resolve(); }, 10000))]);
}
