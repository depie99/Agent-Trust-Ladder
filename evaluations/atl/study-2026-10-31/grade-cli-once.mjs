import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: node grade-cli-once.mjs <candidate-workspace>');
const cli = path.join(workspace, 'runtime/atl-manager.mjs');
const run = (args, timeoutMs) => new Promise(resolve => {
  const child = spawn(process.execPath, [cli, ...args], { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  child.on('error', error => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}\n${error}`, timedOut }); });
  child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
});
if (!fs.existsSync(path.join(workspace, '.trust/manager/state.json'))) {
  const initialized = await run(['init'], 5000);
  assert.equal(initialized.code, 0, `fixture init failed: ${initialized.stderr}`);
}
const once = await run(['ui', '--once', '--plain'], 4000);
assert.equal(once.timedOut, false, 'one-shot CLI exits before deadline');
assert.equal(once.code, 0, `one-shot CLI exits successfully: ${once.stderr}`);
assert.match(once.stdout, /CONTROL ROOM|CONTROL PLANE/i, 'one-shot CLI emits dashboard output');

const port = 55785;
const server = spawn(process.execPath, [cli, 'control-plane', '--port', String(port), '--no-open'], { cwd: workspace, stdio: 'ignore', windowsHide: true });
try {
  let response;
  for (let i = 0; i < 80; i++) {
    try { response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(response?.ok, 'regular interactive UI remains an HTTP server');
  console.log('PASS: one-shot UI exits 0 with dashboard output; regular UI serves HTTP');
} finally { server.kill(); }
