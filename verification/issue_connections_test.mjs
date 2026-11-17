import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConnections, saveConnections, validateConnection, sameConnection } from '../runtime/lib/issue-connections.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-connections-'));
try {
  const legacy = { github: { enabled: true, repos: ['example/one', 'example/two'] }, jira: { enabled: false, base_url: 'https://jira.example.com', projects: ['IT'], token_env: 'JIRA_TOKEN' } };
  const first = loadConnections(root, legacy);
  assert.equal(first.connections.length, 3);
  assert.equal(loadConnections(root, legacy).connections.length, 3, 'migration is idempotent');
  const parsed = validateConnection({ provider: 'github', name: 'Other', repo: 'https://github.com/example/other/issues' });
  assert.equal(parsed.settings.repo, 'example/other');
  assert.equal(sameConnection(first.connections[0], parsed), false);
  first.connections.push({ id: 'test', ...parsed, status: 'unchecked' });
  saveConnections(root, first, first.revision);
  assert.equal(loadConnections(root, legacy).connections.length, 4);
  assert.throws(() => saveConnections(root, first, first.revision - 1), /Connections changed/);
  assert.throws(() => validateConnection({ provider: 'jira', name: 'Bad', base_url: 'http://jira.example.com', projects: 'IT' }), /HTTPS/);
  assert.throws(() => validateConnection({ provider: 'github', name: 'Bad', repo: 'example/one,example/two' }), /one GitHub/);
  // Lock lifecycle: a lock left by a dead writer is reclaimed immediately, a
  // live holder keeps it (bounded 409), legacy empty locks age out, and the
  // stale window reclaims even a lock whose recorded pid is still running.
  const lockFile = path.join(root, '.trust', 'manager', 'issue-connections.json.lock');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const save = () => { const data = loadConnections(root, legacy); saveConnections(root, data, data.revision); };
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999999, at: Date.now() }), 'utf8');
  save();
  assert.equal(fs.existsSync(lockFile), false, 'dead holder lock reclaimed and cleaned up');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8');
  assert.throws(() => saveConnections(root, loadConnections(root, legacy), loadConnections(root, legacy).revision), /busy/, 'live holder keeps the lock');
  assert.equal(fs.existsSync(lockFile), true, 'live holder lock survives the failed save');
  fs.rmSync(lockFile, { force: true });
  fs.writeFileSync(lockFile, '', 'utf8');
  fs.utimesSync(lockFile, new Date(Date.now() - 6000), new Date(Date.now() - 6000));
  save();
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8');
  fs.utimesSync(lockFile, new Date(Date.now() - 31000), new Date(Date.now() - 31000));
  save();
  console.log('PASS: connection validation, independent records, legacy migration, revision conflict and lock reclaim');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
