#!/usr/bin/env node
// Local connection assistant. Never edits a harness's configuration files.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createPluginHost } from './lib/plugin-host.mjs';
import { harnessCatalog, connectionProfile } from './lib/harness-catalog.mjs';

const bundleRoot = fileURLToPath(new URL('../', import.meta.url));
export async function startConnect({ port = 0 } = {}) {
  const host = createPluginHost();
  const token = randomBytes(24).toString('hex');
  let origin;
  const assets = { '/': ['connect.html', 'text/html; charset=utf-8'], '/connect.css': ['connect.css', 'text/css'], '/connect.js': ['connect.js', 'text/javascript'] };
  const server = http.createServer(async (req, res) => {
    const send = (status, value, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }); res.end(type === 'application/json' ? JSON.stringify(value) : value); };
    if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Use the local ATL Connect address.' });
    const url = new URL(req.url, origin);
    try {
      if (req.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        return send(200, fs.readFileSync(path.join(bundleRoot, 'runtime', file)), type);
      }
      if (req.method === 'GET' && url.pathname === '/api/connect') return send(200, { token, profiles: harnessCatalog.map(entry => connectionProfile(entry.id, bundleRoot)), node: process.version, bundle: bundleRoot });
      if (req.method === 'POST' && url.pathname === '/api/start') {
        if (req.headers.origin !== origin || req.headers['x-atl-token'] !== token || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Reopen ATL Connect and try again.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 8192) return send(413, { error: 'Request too large.' }); }
        const args = JSON.parse(body);
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', abort);
        try { return send(200, await host.call('atl_start', args, { signal: controller.signal })); }
        finally { res.off('close', abort); }
      }
      return send(404, { error: 'Not found.' });
    } catch (error) { if (!res.destroyed) send(400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin + '/', async close() { await host.close(); await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); } };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const app = await startConnect();
  console.log(`ATL Connect: ${app.url}\nKeep this window open while using ATL. Press Ctrl+C to stop.`);
  let stopping = false;
  const stop = async () => { if (!stopping) { stopping = true; await app.close(); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
