import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-matched-ui-'));
try {
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(path.join(runtime, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'control-plane.html'), '<html></html>');
  fs.writeFileSync(path.join(runtime, 'control-plane-client.js'), '// project assets');
  fs.writeFileSync(path.join(runtime, 'lib', 'control-plane-server.mjs'), `
    export async function startControlPlaneServer(root, options) {
      if (options.assetRoot !== root + '/runtime' && options.assetRoot !== root + '\\\\runtime') throw new Error('assets/server mismatch');
      console.log('MATCHING_PROJECT_SERVER');
      return { url: 'http://127.0.0.1:0/', server: { close(done) { done(); } } };
    }
  `);
  const cli = fileURLToPath(new URL('../runtime/atl-manager.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [cli, 'ui-refresh'], { cwd: root, env: { ...process.env, ATL_PROJECT: root, ATL_NO_OPEN: '1' }, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.match(output, /MATCHING_PROJECT_SERVER/);
  console.log('PASS: ui-refresh loads the matching project API server with project assets');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
