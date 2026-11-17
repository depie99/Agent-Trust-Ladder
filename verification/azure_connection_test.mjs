import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveAzureConnection, readAzureConnection, forgetAzureConnection, dpapiSupported } from '../runtime/lib/azure-connection.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-azure-vault-'));
const cfg = { org_url: 'https://azure.example.invalid/Collection', project: 'Project' };
try {
  if (process.platform === 'win32' && await dpapiSupported()) {
    await saveAzureConnection(cfg, 'synthetic-pat-never-in-project-files', { dir });
    assert.equal(fs.readFileSync(path.join(dir, 'azure.json'), 'utf8').includes('synthetic-pat'), false);
    assert.equal(await readAzureConnection(cfg, { dir }), 'synthetic-pat-never-in-project-files');
    assert.equal(await readAzureConnection({ ...cfg, org_url: 'https://another.example.invalid' }, { dir }), null, 'credentials cannot follow a changed collection');
    forgetAzureConnection({ ...cfg, project: 'Other' }, { dir });
    assert.ok(fs.existsSync(path.join(dir, 'azure.json')), 'disconnect cannot delete a different connection');
    forgetAzureConnection(cfg, { dir });
    assert.equal(await readAzureConnection(cfg, { dir }), null);
    console.log('PASS: Windows DPAPI roundtrip, encrypted storage, target binding and forget');
  } else if (process.platform === 'win32') {
    // Headless/service Windows (CI runners) have no usable DPAPI. The offer to
    // remember must be refused with an actionable message, and nothing may be
    // written to the vault — session credentials remain available.
    await assert.rejects(() => saveAzureConnection(cfg, 'synthetic-pat-never-in-project-files', { dir }), /credential protection is unavailable/);
    assert.equal(fs.existsSync(path.join(dir, 'azure.json')), false, 'no vault file is written where DPAPI is unavailable');
    assert.equal(await readAzureConnection(cfg, { dir }), null);
    console.log('PASS: DPAPI unavailable on this Windows host — persistent storage refused gracefully');
  } else {
    await assert.rejects(() => saveAzureConnection(cfg, 'synthetic', { dir }), /session connection/);
    console.log('PASS: unsupported OS refuses persistent credential storage');
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
