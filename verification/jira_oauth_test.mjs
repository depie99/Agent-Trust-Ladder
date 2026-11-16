import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJiraMcp } from '../runtime/lib/jira-mcp.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-jira-oauth-'));
const oldHome = process.env.ATL_HOME; process.env.ATL_HOME = path.join(root, 'home');
let origin, registration, tokenRequests = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const json = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  if (url.pathname.includes('oauth-protected-resource')) return json(200, { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['read:jira:agent-interface', 'write:jira:agent-interface'] });
  if (url.pathname.includes('oauth-authorization-server') || url.pathname.includes('openid-configuration')) return json(200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
  let body = ''; for await (const chunk of req) body += chunk;
  if (url.pathname === '/register') { registration = JSON.parse(body); return json(201, { ...registration, client_id: 'fixture-client' }); }
  if (url.pathname === '/token') { const form = new URLSearchParams(body); assert.equal(form.get('code'), 'fixture-code'); assert.ok(form.get('code_verifier')); tokenRequests++; return json(200, { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600 }); }
  if (url.pathname === '/mcp') {
    if (req.headers.authorization !== 'Bearer fixture-access') return json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` });
    if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
    const rpc = JSON.parse(body);
    if (!Object.hasOwn(rpc, 'id')) { res.writeHead(202); res.end(); return; }
    const tools = [{ name: 'getAccessibleAtlassianResources', description: 'Sites', inputSchema: { type: 'object', properties: {} } }];
    const result = rpc.method === 'initialize' ? { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture-jira', version: '1' } } : rpc.method === 'tools/list' ? { tools } : { content: [{ type: 'text', text: JSON.stringify([{ id: 'fixture-site', name: 'Fixture', url: 'https://fixture.atlassian.net' }]) }] };
    return json(200, { jsonrpc: '2.0', id: rpc.id, result });
  }
  json(404, {});
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
const jira = createJiraMcp(root, { mcpEndpoint: `${origin}/mcp` });
try {
  const result = await jira.authorize('http://127.0.0.1:50787');
  assert.ok(result.authorization_url, 'official SDK discovers OAuth metadata and redirects');
  const authorization = new URL(result.authorization_url);
  assert.equal(authorization.origin, origin); assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  const state = authorization.searchParams.get('state'); assert.ok(state);
  assert.deepEqual(registration.redirect_uris, ['http://127.0.0.1:50787/api/my-tasks/jira/oauth/callback']);
  await assert.rejects(() => jira.finish('fixture-code', 'wrong-state'), /state/);
  await jira.finish('fixture-code', state); assert.equal(tokenRequests, 1);
  assert.equal((await jira.sites())[0].id, 'fixture-site');
  await assert.rejects(() => jira.finish('fixture-code', state), /state/, 'authorization callback cannot replay');
  assert.ok(!JSON.stringify(jira.status()).includes('fixture-access'), 'tokens never enter status');
  const secretFiles = fs.readdirSync(path.join(root, 'home/connections'));
  const saved = fs.readFileSync(path.join(root, 'home/connections', secretFiles[0]), 'utf8');
  if (process.platform === 'win32') assert.ok(!saved.includes('fixture-access'), 'Windows credentials use DPAPI');
  await jira.stop();
  const restored = createJiraMcp(root, { mcpEndpoint: `${origin}/mcp` });
  assert.equal((await restored.sites())[0].id, 'fixture-site', 'saved OAuth credentials survive runtime restart');
  await restored.stop();
  await jira.disconnect(); assert.equal(fs.readdirSync(path.join(root, 'home/connections')).length, 0);
  console.log('PASS: official bundled MCP SDK OAuth discovery, dynamic registration, PKCE, state, token exchange, real tool discovery/call, protected storage and disconnect');
} finally { await jira.stop(); server.closeAllConnections(); server.close(); if (oldHome === undefined) delete process.env.ATL_HOME; else process.env.ATL_HOME = oldHome; }
