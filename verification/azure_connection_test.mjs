import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveAzureConnection, readAzureConnection, forgetAzureConnection } from '../runtime/lib/azure-connection.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-azure-vault-'));
const cfg = { org_url: 'https://azure.example.invalid/Collection', project: 'Project' };
try {
  if (process.platform === 'win32') {
    await saveAzureConnection(cfg, 'synthetic-pat-never-in-project-files', { dir });
    assert.equal(fs.readFileSync(path.join(dir, 'azure.json'), 'utf8').includes('synthetic-pat'), false);
    assert.equal(await readAzureConnection(cfg, { dir }), 'synthetic-pat-never-in-project-files');
    assert.equal(await readAzureConnection({ ...cfg, org_url: 'https://another.example.invalid' }, { dir }), null, 'credentials cannot follow a changed collection');
    forgetAzureConnection({ ...cfg, project: 'Other' }, { dir });
    assert.ok(fs.existsSync(path.join(dir, 'azure.json')), 'disconnect cannot delete a different connection');
    forgetAzureConnection(cfg, { dir });
    assert.equal(await readAzureConnection(cfg, { dir }), null);
    console.log('PASS: Windows DPAPI roundtrip, encrypted storage, target binding and forget');
  } else {
    await assert.rejects(() => saveAzureConnection(cfg, 'synthetic', { dir }), /session connection/);
    console.log('PASS: unsupported OS refuses persistent credential storage');
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
