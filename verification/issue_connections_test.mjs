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
  console.log('PASS: connection validation, independent records, legacy migration and revision conflict');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
