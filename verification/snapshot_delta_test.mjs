// Snapshot delta: an idle reconnect poll gets a tiny `unchanged` block instead of a
// full snapshot; a state change is pushed as a full snapshot within one tick.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState, saveState, logEvent } from '../runtime/lib/state.mjs';
import { acquireLease, heartbeatLease } from '../runtime/lib/leases.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-snapshot-delta-'));
fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.writeFileSync(path.join(root, 'config', 'manager.json'), JSON.stringify({ version: 1 }));
const state = emptyState();
for (let i = 1; i <= 400; i++) state.tasks[`D-${i}`] = { id: `D-${i}`, title: `Delta fixture task ${i}`, status: 'new', priority: 'normal', completion_checks: [], evidence: [] };
logEvent(state, { task: 'D-1', actor: 'owner', event: 'created', detail: 'fixture seed — gives reconnecting clients a positive cursor' });
saveState(root, state);
const running = await startControlPlaneServer(root, { host: '127.0.0.1', port: 0 });

async function firstBlock(url) {
  const response = await fetch(url);
  const reader = response.body.getReader();
  const deadline = Date.now() + 15000;
  let text = '';
  try {
    while (Date.now() < deadline && !text.includes('\n\n')) {
      const chunk = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
      if (!chunk) { console.error(`  firstBlock stall at ${text.length}B for ${url}`); break; }
      text += new TextDecoder().decode(chunk.value);
    }
  } finally { try { await Promise.race([reader.cancel(), new Promise(resolve => setTimeout(resolve, 500))]); } catch { /* already closed */ } }
  return text;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  const base = running.url.replace(/\/+$/, ''); // trailing slash would make '//api/…' a protocol-relative URL
  const first = await firstBlock(`${base}/api/events`);
  assert.ok(first.includes('event: snapshot'), 'first poll must deliver a full snapshot');
  const firstBytes = first.length;
  assert.ok(firstBytes > 10_000, `fixture should produce a large snapshot, got ${firstBytes} bytes`);
  const cursor = Number(first.match(/"cursor":(\d+)/)?.[1] || 0);
  console.error(`  [diag] poll1.cursor=${cursor} firstBytes=${firstBytes}`);

  await sleep(2600); // let the server's build tick cache the unchanged frame
  const idle = await firstBlock(`${base}/api/events?cursor=${cursor}`);
  console.error(`  [diag] idle.head=${JSON.stringify(idle.slice(0, 60))} idleBytes=${idle.length}`);
  assert.ok(idle.includes('event: unchanged'), 'idle reconnect must get the tiny unchanged block');
  assert.ok(idle.length < 200, `idle reconnect block should be tiny, got ${idle.length} bytes`);

  state.tasks['D-400'].status = 'in_progress';
  saveState(root, state);
  await sleep(2600); // change tick pushes and re-caches
  const after = await firstBlock(`${base}/api/events?cursor=${cursor}`);
  assert.ok(after.includes('event: snapshot'), 'changed state must push a full snapshot');
  assert.ok(after.includes('"in_progress"'), 'pushed snapshot must contain the change');
  const pushedCursor = Number(after.match(/"cursor":(\d+)/)?.[1] || 0);

  // RT-5: a scheduler-style rewrite that only moves volatile stamps (updated_at,
  // file mtimes) must NOT invalidate the cached frame — an idle workspace stays
  // on the tiny unchanged responses forever.
  saveState(root, state);
  await sleep(2600);
  const rewritePoll = await fetch(`${base}/api/snapshot?cursor=${pushedCursor}`).then(r => r.json());
  assert.equal(rewritePoll.unchanged, true, 'volatile-only rewrite must leave the frame unchanged');

  // An active run's lease acquisition AND its periodic heartbeat are live
  // content: the client's running detection compares lease.expires_at against
  // the clock, so heartbeats must push fresh frames to viewers.
  const lease = acquireLease(root, { project: 'delta', task: 'D-400', role: 'worker', run: 'delta-run', ttlMs: 30000 });
  await sleep(2600);
  const leasePoll = await fetch(`${base}/api/snapshot?cursor=${pushedCursor}`).then(r => r.json());
  assert.equal(leasePoll.unchanged, undefined, 'lease acquisition must push a full frame');
  assert.ok(JSON.stringify(leasePoll).includes(lease.id), 'pushed frame carries the new lease');
  heartbeatLease(root, lease);
  await sleep(2600);
  const heartbeatPoll = await fetch(`${base}/api/snapshot?cursor=${pushedCursor}`).then(r => r.json());
  assert.equal(heartbeatPoll.unchanged, undefined, 'lease heartbeat must push a fresh frame');
  assert.ok(heartbeatPoll.leases.sessions.some(s => s.id === lease.id && s.expires_at > leasePoll.leases.sessions.find(s => s.id === lease.id)?.expires_at), 'heartbeat moved the lease deadline');

  console.log(`PASS: full=${firstBytes}B idle-reconnect=${idle.length}B change-push=${after.length}B — delta events, volatile-rewrite stability and lease-heartbeat liveness verified`);
} finally {
  await new Promise(resolve => running.server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
