#!/usr/bin/env node
// Dependency-free MCP stdio transport. stdout is reserved for JSON-RPC.
import readline from 'node:readline';
import { createPluginHost, pluginTools } from './lib/plugin-host.mjs';

const host = createPluginHost();
const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();
const calls = new Map();
let stopping = false;
async function respond(line) {
  let request;
  try { request = JSON.parse(line); }
  catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    write({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Invalid request' } }); return;
  }
  if (!Object.hasOwn(request, 'id')) {
    if (request.method === 'notifications/cancelled') calls.get(request.params?.requestId)?.abort();
    return;
  }
  const reply = result => write({ jsonrpc: '2.0', id: request.id, result });
  if (request.method === 'initialize') return reply({ protocolVersion: versions.includes(request.params?.protocolVersion) ? request.params.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'atl', version: (await host.call('atl_info')).version }, instructions: 'ATL includes its full runtime, Control Plane and skills. Read atl_skill(name="atl") before engineering work. Projects must be explicitly selected by absolute path. Host permissions and ATL trust gates still apply.' });
  if (request.method === 'ping') return reply({});
  if (request.method === 'tools/list') return reply({ tools: pluginTools.map(({ readOnly, ...tool }) => ({ ...tool, annotations: { readOnlyHint: readOnly === true, destructiveHint: !readOnly, openWorldHint: !readOnly } })) });
  if (request.method === 'tools/call') {
    const controller = new AbortController();
    calls.set(request.id, controller);
    try { const value = await host.call(request.params?.name, request.params?.arguments ?? {}, { signal: controller.signal }); return reply({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: value.status === 'failed' }); }
    catch (error) { return reply({ content: [{ type: 'text', text: error.message }], isError: true }); }
    finally { calls.delete(request.id); }
  }
  write({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
}
input.on('line', line => {
  if (stopping || !line.trim()) return;
  const work = respond(line).catch(error => { process.stderr.write(`ATL MCP: ${error.message}\n`); });
  pending.add(work); work.finally(() => pending.delete(work));
});
async function stop() {
  if (stopping) return;
  stopping = true;
  input.close();
  for (const controller of calls.values()) controller.abort();
  await Promise.allSettled([...pending]);
  await host.close();
  process.stdin.destroy();
}
input.on('close', stop);
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
