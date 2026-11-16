import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPanelGateway } from '../runtime/lib/plugin-panel.mjs';
import { frameBootstrap } from './deepseek-frame.mjs';

const homeDir = () => process.env.ATL_HOME || path.join(os.homedir(), '.atl');
const workspaceRecord = () => path.join(homeDir(), 'workspace.json');
// First launch opens without asking for a directory: the last workspace opened
// by this machine's plugin (survives harness restarts and profile wipes), or a
// dedicated home workspace under ATL_HOME. A subdir — not ~/.atl itself — so
// the runtime home is never re-initialized as a project (its runtime/ copy must
// not be mistaken for the project's control-plane runtime).
function defaultProject() {
  try {
    const stored = JSON.parse(fs.readFileSync(workspaceRecord(), 'utf8')).project;
    if (typeof stored === 'string' && stored.trim() && fs.existsSync(stored.trim())) return stored.trim();
  } catch { /* no record yet: first ever launch */ }
  const homeWorkspace = path.join(homeDir(), 'workspace');
  fs.mkdirSync(homeWorkspace, { recursive: true });
  return homeWorkspace;
}
function rememberProject(project) {
  try {
    fs.mkdirSync(homeDir(), { recursive: true });
    fs.writeFileSync(workspaceRecord(), JSON.stringify({ project, updated_at: new Date().toISOString() }, null, 2) + '\n');
  } catch { /* advisory only: the client keeps its own copy */ }
}

// Connection's exact Fetch routes enforce host trust, browser authentication,
// and owner-only access before calling these handlers.
export function registerDeepSeekPanel(ctx, host) {
  const panels = new Map();
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  function panelFor(id) { const entry = panels.get(id); if (!entry) throw new Error('Panel expired. Open the project again.'); return entry.gateway; }
  const register = (path, methods, handler) => ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', async fetch(request) {
    try { return await handler(request); } catch (error) { return json({ error: error.message }, 400); }
  } });
  register('/api/atl/open', ['POST'], async request => {
    const body = await request.json().catch(() => ({}));
    const requested = typeof body?.project === 'string' ? body.project.trim() : '';
    // No directory given: automatic workspace opening (first launch, fresh
    // profile or harness restart) resolves the machine's default workspace.
    // openPanel validates the project path and starts no workers.
    const panel = await host.openPanel(requested || defaultProject());
    rememberProject(panel.project);
    const generation = host.serverGeneration;
    let reuse = null;
    for (const [id, entry] of panels) {
      if (entry.gateway.panel.project !== panel.project) continue;
      if (entry.generation === generation) { reuse = id; break; }
      // A gateway pinned to a server generation that died is dropped; the freshly
      // spawned control plane takes over under a new panel id.
      panels.delete(id);
    }
    if (reuse) return json({ id: reuse, project: panel.project });
    const id = randomUUID();
    panels.set(id, { gateway: await createPanelGateway(panel), generation });
    return json({ id, project: panel.project });
  });
  register('/api/atl/request', ['POST'], async request => {
    const { id, ...input } = await request.json();
    if (typeof input.path !== 'string' || !input.path.startsWith('/') || input.path.startsWith('//')) throw new Error('Invalid panel path.');
    return json(await panelFor(id).request(input, request.signal));
  });
  register('/api/atl/asset', ['GET', 'HEAD'], async request => {
    const url = new URL(request.url);
    const raw = url.searchParams.get('path') || '';
    const assetPath = new URL(raw, 'http://atl.invalid/');
    if (assetPath.origin !== 'http://atl.invalid' || !/^\/assets\/[\w.-]+$/.test(assetPath.pathname)) throw new Error('Invalid panel asset.');
    const result = await panelFor(url.searchParams.get('id')).request({ path: assetPath.pathname, method: request.method }, request.signal);
    return new Response(request.method === 'HEAD' ? null : Buffer.from(result.body, 'base64'), { status: result.status, headers: { ...result.headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  });
  register('/api/atl/view', ['GET'], async request => {
    const url = new URL(request.url), id = url.searchParams.get('id');
    panelFor(id);
    const args = JSON.stringify({ id, theme: url.searchParams.get('theme') === 'light' ? 'light' : 'dark' }).replaceAll('<', '\\u003c');
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>Loading ATL…<script>(${frameBootstrap.toString()})(${args})</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'self'; object-src 'none'", 'referrer-policy': 'no-referrer' } });
  });
  ctx.effect(() => () => panels.clear());
}
