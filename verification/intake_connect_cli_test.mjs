import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dpapiSupported } from '../runtime/lib/azure-connection.mjs';

// Auth recovery from the terminal: `atl intake connect azure` must (re)save the
// stored connection's credential the same way the ATL UI does — per-connection
// DPAPI vault + connection store + legacy config/home-vault mirror — and
// `atl intake status` must point at the fix when a credential is missing. The
// PAT never travels in argv (process-list exposure) and never lands in the
// store or any JSON file.

const runtimeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime');
const canPersist = await dpapiSupported();

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-intake-connect-home-'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-intake-connect-root-'));
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-intake-connect-vault-'));
fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.writeFileSync(path.join(root, 'config', 'manager.json'), JSON.stringify({ version: 1, inbox_dir: 'inbox' }));

const cli = (args, { stdin = '', azdoPat = '' } = {}) => spawnSync(process.execPath, [path.join(runtimeDir, 'atl-manager.mjs'), ...args], {
  encoding: 'utf8',
  input: stdin,
  env: { ...process.env, ATL_PROJECT: root, ATL_AZURE_CONNECTION_DIR: vault, USERPROFILE: fakeHome, HOME: fakeHome, APPDATA: fakeHome, AZDO_PAT: azdoPat },
});
const storeFile = path.join(root, '.trust', 'manager', 'issue-connections.json');
const readStore = () => JSON.parse(fs.readFileSync(storeFile, 'utf8'));
// loadConnections initializes an empty store on first read; a failed connect
// may leave that empty file but must never record a connection.
const noConnectionRecorded = () => !fs.existsSync(storeFile) || readStore().connections.length === 0;
const combined = (result) => `${result.stdout}\n${result.stderr}`;

try {
  // Missing token in a non-interactive shell is a clear error, not a hang.
  const noToken = cli(['intake', 'connect', 'azure', '--url', 'https://devops.example.invalid/Coll', '--project', 'Alpha']);
  assert.notEqual(noToken.status, 0, 'no-token connect exits non-zero (issue #75: no hanging prompts)');
  assert.match(combined(noToken), /No PAT supplied/);
  assert.ok(noConnectionRecorded(), 'a failed connect records no connection');

  // A PAT value in argv is refused — it would sit in the process list.
  const argvToken = cli(['intake', 'connect', 'azure', '--url', 'https://devops.example.invalid/Coll', '--project', 'Alpha', '--token', 'synthetic-cli-pat']);
  assert.notEqual(argvToken.status, 0, '--token with a value is refused');
  assert.match(combined(argvToken), /process list/);
  assert.ok(noConnectionRecorded(), 'refused argv token records no connection');

  if (!canPersist) {
    // CI runners and headless hosts cannot persist: the CLI must say so and
    // leave every durable surface untouched instead of half-writing.
    const refused = cli(['intake', 'connect', 'azure', '--url', 'https://devops.example.invalid/Coll', '--project', 'Alpha', '--token', '-'], { stdin: 'synthetic-cli-pat' });
    assert.notEqual(refused.status, 0, 'without DPAPI the CLI cannot persist');
    assert.match(combined(refused), /Windows credential protection|DPAPI/);
    assert.ok(noConnectionRecorded(), 'refused connect records no connection');
    console.log('PASS: intake connect CLI (no-DPAPI host) — argv guard, no-hang missing-token error, persisted-credential refusal');
  } else {
    const created = cli(['intake', 'connect', 'azure', '--url', 'https://devops.example.invalid/Coll', '--project', 'Alpha', '--token', '-'], { stdin: 'synthetic-cli-pat' });
    assert.equal(created.status, 0, combined(created));
    assert.match(created.stdout, /"Alpha \(Azure Boards\)" saved/);
    const store = readStore();
    assert.equal(store.connections.length, 1, 'connect creates exactly one connection');
    const azure = store.connections[0];
    assert.equal(azure.provider, 'azure');
    assert.equal(azure.credential_ref, 'os-protected', 'CLI credentials are persisted for the server to find');
    assert.equal(store.defaults.azure, azure.id, 'the created connection becomes the azure default');
    assert.ok(!JSON.stringify(store).includes('synthetic-cli-pat'), 'the store never contains the PAT');
    const legacyVault = JSON.parse(fs.readFileSync(path.join(vault, 'azure.json'), 'utf8'));
    assert.equal(legacyVault.identity, 'https://devops.example.invalid/coll|Alpha', 'legacy vault record matches the My Tasks identity');
    assert.ok(!legacyVault.encrypted.includes('synthetic-cli-pat'), 'vault file is DPAPI ciphertext');
    assert.ok(fs.existsSync(path.join(root, '.trust', 'manager', 'credentials', azure.id, 'azure.json')), 'per-connection vault written');
    const manager = JSON.parse(fs.readFileSync(path.join(root, 'config', 'manager.json'), 'utf8'));
    assert.equal(manager.intake.azure.org_url, 'https://devops.example.invalid/Coll', 'legacy config mirrored for My Tasks');
    assert.equal(manager.intake.azure.enabled, true, 'azure intake enabled by the connect');
    assert.equal(manager.intake.azure.token_env, 'AZDO_PAT');

    // Rotation: a second connect updates the same connection, no duplicate.
    const rotated = cli(['intake', 'connect', 'azure', '--token', '-'], { stdin: 'synthetic-rotated-pat' });
    assert.equal(rotated.status, 0, combined(rotated));
    const after = readStore();
    assert.equal(after.connections.length, 1, 'rotation does not duplicate the connection');
    assert.equal(after.connections[0].id, azure.id, 'rotation targets the same connection');
    assert.ok(after.revision > store.revision, 'revision advances for concurrent servers');

    const status = cli(['intake', 'status']);
    assert.equal(status.status, 0, combined(status));
    assert.match(status.stdout, /Saved connections \(Issue sources\)/);
    assert.match(status.stdout, /\(default\)/, 'the default connection is marked');
    assert.match(status.stdout, /credential saved on this account/);

    // Env-fallback: without stdin and without a TTY, AZDO_PAT is accepted.
    const fromEnv = cli(['intake', 'connect', 'azure'], { azdoPat: 'synthetic-env-pat' });
    assert.equal(fromEnv.status, 0, combined(fromEnv));

    console.log('PASS: intake connect CLI — create, argv guard, rotation-in-place, status with fix hint, env fallback, vault+config mirrors, PAT never in store');
  }
} catch (error) {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(vault, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}
