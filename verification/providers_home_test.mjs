// Providers registry honors ATL_HOME: a pinned home keeps the registry under it,
// separate from the historical ~/.atl location.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registryPath, loadUserProviders, saveUserProviders } from '../runtime/lib/userProviders.mjs';

const pinnedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-providers-home-'));
const previous = process.env.ATL_HOME;
process.env.ATL_HOME = path.join(pinnedHome, '.atl');
try {
  const pinned = registryPath();
  assert.ok(pinned.startsWith(path.join(pinnedHome, '.atl')), `registry must live under pinned ATL_HOME, got ${pinned}`);
  assert.deepEqual(loadUserProviders().providers, {}, 'pinned home starts with an empty registry');
  saveUserProviders({ testprov: { id: 'testprov', label: 'Test', worker: 'codex', base_url: 'https://example.test', api_key: 'sk-test', model: 'm-1', models: ['m-1'] } });
  assert.ok(fs.existsSync(pinned), 'saving must create the registry under pinned ATL_HOME');
  const real = path.join(os.homedir(), '.atl', 'providers.json');
  const before = fs.existsSync(real) ? fs.statSync(real).mtimeMs : -1;
  saveUserProviders({ testprov: { id: 'testprov', label: 'Test', worker: 'codex', base_url: 'https://example.test', api_key: 'sk-test', model: 'm-1', models: ['m-1'] } });
  const after = fs.existsSync(real) ? fs.statSync(real).mtimeMs : -1;
  assert.equal(before, after, 'the historical ~/.atl/providers.json must not be touched while ATL_HOME is pinned');
  console.log('PASS: providers registry follows ATL_HOME and leaves ~/.atl untouched');
} finally {
  if (previous === undefined) delete process.env.ATL_HOME; else process.env.ATL_HOME = previous;
  fs.rmSync(pinnedHome, { recursive: true, force: true });
}
