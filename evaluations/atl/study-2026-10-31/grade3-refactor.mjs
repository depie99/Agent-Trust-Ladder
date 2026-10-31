import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: grade3-refactor.mjs <workspace>');
const storage = await import(pathToFileURL(path.join(workspace, 'lib/storage.mjs')).href);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillbench-refactor-'));
try {
  // 1. Corrupt state file: load must not throw, must return empty state, must preserve the corrupt bytes.
  const corrupt = '{ "expenses": [ { "id": "e1", BROKEN';
  fs.writeFileSync(path.join(dir, 'state.json'), corrupt);
  const recovered = storage.loadState(dir);
  assert.deepEqual(recovered, { expenses: [] }, `corrupt file loads as empty state (got: ${JSON.stringify(recovered).slice(0, 120)})`);
  const backupName = fs.readdirSync(dir).find(name => name !== 'state.json' && name.includes('state.json'));
  assert.ok(backupName, 'corrupt file preserved as a backup copy');
  assert.equal(fs.readFileSync(path.join(dir, backupName), 'utf8'), corrupt, 'backup keeps the corrupt bytes verbatim');

  // 2. Roundtrip must still work and keep the same API.
  const state = { expenses: [{ id: 'e1', payer: 'Ana', amount: 5, participants: ['Ana'], archived: false }] };
  const file = storage.saveState(dir, state);
  assert.equal(path.basename(file), 'state.json', 'saveState still writes state.json in the root');
  assert.deepEqual(storage.loadState(dir), state, 'save/load roundtrip preserves state');

  // 3. Missing file: load returns empty state instead of throwing.
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillbench-refactor-empty-'));
  try {
    assert.deepEqual(storage.loadState(emptyDir), { expenses: [] }, 'missing state.json loads as empty state');
  } finally { fs.rmSync(emptyDir, { recursive: true, force: true }); }
  console.log('PASS: corrupt file quarantined verbatim, empty-state recovery, roundtrip and API unchanged');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
