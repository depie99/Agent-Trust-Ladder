import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-matched-ui-'));
const installedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-install-home-'));
const source = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-ui-source-'));
try {
  const runtime = path.join(source, 'runtime');
  fs.mkdirSync(path.join(runtime, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'control-plane.html'), '<html></html>');
  fs.writeFileSync(path.join(runtime, 'control-plane-client.js'), '// project assets');
  fs.writeFileSync(path.join(runtime, 'lib', 'control-plane-server.mjs'), `
    export async function startControlPlaneServer(root, options) {
      if (!options.assetRoot?.includes('atl-ui-source-')) throw new Error('assets/server mismatch');
      console.log('MATCHING_PROJECT_SERVER');
      return { url: 'http://127.0.0.1:0/', server: { close(done) { done(); } } };
    }
  `);
  fs.writeFileSync(path.join(installedHome, 'source.json'), JSON.stringify({ source_root: source }));
  const cli = fileURLToPath(new URL('../runtime/atl-manager.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [cli, 'ui'], { cwd: root, env: { ...process.env, ATL_PROJECT: root, ATL_INSTALL_DIR: installedHome, ATL_NO_OPEN: '1' }, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.match(output, /MATCHING_PROJECT_SERVER/);
  const legacy = spawnSync(process.execPath, [cli, 'ui-refresh'], { cwd: root, env: { ...process.env, ATL_PROJECT: root, ATL_INSTALL_DIR: installedHome, ATL_NO_OPEN: '1' }, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stderr, /ui-refresh was removed\. Use `atl ui`/);
  console.log('PASS: ui loads matching project assets and the legacy refresh command directs users to ui');
} finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(installedHome, { recursive: true, force: true }); fs.rmSync(source, { recursive: true, force: true }); }
