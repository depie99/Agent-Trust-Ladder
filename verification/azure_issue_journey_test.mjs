import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { intakeFromAzure } from '../runtime/lib/intake.mjs';
import { emptyState, saveState, loadState } from '../runtime/lib/state.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
import { loadQueueBook } from '../runtime/lib/queue.mjs';
import { verifyImportedSource } from '../runtime/lib/plan-publish.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-azure-journey-'));
const oldPat = process.env.ATL_MOCK_AZURE_PAT;
const cfg = { enabled: true, org_url: 'https://devops.example.invalid:32678/Solico-Group', project: 'Middleware-and-Portals', iteration_path: 'Middleware-and-Portals\\Sprint 74', token_env: 'ATL_MOCK_AZURE_PAT' };
const calls = [];
const requestImpl = async (url, options) => {
  calls.push({ url, ...options });
  if (url.includes('/wiql?')) return { workItems: [{ id: 741 }, { id: 742 }] };
  return { value: [
    { id: 741, fields: { 'System.Rev': 3, 'System.Title': 'Repair queue retry status', 'System.WorkItemType': 'Bug', 'System.State': 'New', 'System.Description': '<p>Interrupted middleware tasks must resume and show an accurate queue status.</p>', 'Microsoft.VSTS.Common.Priority': 1 } },
    { id: 742, fields: { 'System.Rev': 5, 'System.Title': 'Improve overnight delivery', 'System.WorkItemType': 'User Story', 'System.State': 'New', 'System.Description': '<p>Make overnight work reliable.</p>' } },
  ] };
};
let server;
try {
  delete process.env.ATL_MOCK_AZURE_PAT;
  await assert.rejects(() => intakeFromAzure(cfg, { requestImpl }), /personal access token/);
  assert.equal(calls.length, 0, 'missing credentials fail before transport');
  process.env.ATL_MOCK_AZURE_PAT = 'synthetic-only';
  const candidates = await intakeFromAzure(cfg, { requestImpl });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source.revision, 3);
  assert.equal(candidates[0].priority, 'urgent');
  assert.equal(candidates[0].objective_hint.includes('<p>'), false);
  assert.ok(calls[0].body.query.includes("[System.IterationPath] = 'Middleware-and-Portals\\Sprint 74'"));
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from(':synthetic-only').toString('base64')}`);
  assert.equal(calls[0].allowUntrusted, false);
  assert.deepEqual(calls[1].body.ids, [741, 742]);
  assert.ok(calls[1].body.fields.includes('System.Rev'));
  await assert.rejects(() => intakeFromAzure({ ...cfg, org_url: 'http://unsafe.invalid' }, { requestImpl }), /HTTPS/);
  const empty = await intakeFromAzure(cfg, { requestImpl: async () => ({ workItems: [] }) });
  assert.deepEqual(empty, []);
  await intakeFromAzure({ ...cfg, project: "Team's Portal", iteration_path: "Team's Portal\\Sprint 74", types: ["Owner's Task"] }, { requestImpl });
  assert.match(calls.at(-2).url, /Team's%20Portal/);
  assert.match(calls.at(-2).body.query, /Team''s Portal/);
  assert.match(calls.at(-2).body.query, /Owner''s Task/);
  const other = await intakeFromAzure({ ...cfg, org_url: 'https://other.example.invalid/Collection' }, { requestImpl });
  assert.notEqual(other[0].intake_key, candidates[0].intake_key, 'collections cannot collide');
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/manager.json'), JSON.stringify({ version: 1 }));
  saveState(root, emptyState());
  const running = await startControlPlaneServer(root, { intakeAdapters: { azure: config => intakeFromAzure(config, { requestImpl }) } });
  server = running.server;
  const post = async (endpoint, body) => {
    const response = await fetch(running.url + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  assert.equal((await post('api/intake/sources', { source: 'azure', ...cfg, org_url: `${cfg.org_url}/${cfg.project}/_workitems/recentlyupdated/` })).status, 400);
  assert.equal((await post('api/intake/sources', { source: 'azure', ...cfg, token_env: 'bad-variable' })).status, 400);
  const saved = await post('api/intake/sources', { source: 'azure', ...cfg });
  assert.equal(saved.sources.azure.token_present, true);
  assert.equal(JSON.stringify(saved).includes('synthetic-only'), false, 'PAT is never returned');
  const preview = await post('api/intake/preview', { source: 'azure' });
  assert.equal(preview.candidates.length, 2);
  assert.equal(Object.keys(loadState(root).tasks).length, 0, 'preview does not create tasks');
  assert.equal((await post('api/intake/import', { token: preview.token, indices: [9], queueId: 'azure-intake' })).status, 400);
  const imported = await post('api/intake/import', { token: preview.token, indices: [0, 1], queueId: 'azure-intake' });
  assert.equal(imported.added, 2);
  assert.equal(loadQueueBook(root).queues['azure-intake'].items.length, 2);
  assert.ok(imported.taskIds.every(id => loadState(root).tasks[id].plan_review_required));
  const again = await post('api/intake/preview', { source: 'azure' });
  assert.equal((await post('api/intake/import', { token: again.token, indices: [0, 1], queueId: 'azure-intake' })).skipped, 2);
  const sourceFetch = async () => ({ ok: true, text: async () => JSON.stringify({ rev: 3 }) });
  assert.equal((await verifyImportedSource(root, imported.taskIds[0], { fetchImpl: sourceFetch })).current, true);
  await assert.rejects(() => verifyImportedSource(root, imported.taskIds[0], { fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ rev: 4 }) }) }), /changed since intake/);
  await post('api/intake/sources', { source: 'azure', ...cfg, enabled: false });
  assert.equal((await post('api/intake/preview', { source: 'azure' })).status, 400);
  console.log('PASS: Azure adapter auth/WIQL/revisions/TLS/encoding/isolation → source configuration → preview → validated import → deduplication → stale source rejection');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (oldPat === undefined) delete process.env.ATL_MOCK_AZURE_PAT; else process.env.ATL_MOCK_AZURE_PAT = oldPat;
  fs.rmSync(root, { recursive: true, force: true });
}
