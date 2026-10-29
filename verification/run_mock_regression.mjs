// Run existing verifiers in isolated homes; retain every result, including failures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, '.atl-evidence', 'mock-regression', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const selected = process.argv.slice(2);
const tests = selected.length ? selected : fs.readdirSync(path.join(root, 'verification')).filter(name => name.endsWith('_test.mjs')).sort();
const results = [];
async function run(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-regression-home-'));
  const started = Date.now();
  const env = { ...process.env, USERPROFILE: home, HOME: home,
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'verification/fixtures/offline-network.mjs')).href}` };
  for (const key of Object.keys(env)) if (/TOKEN|API_KEY|AZDO_PAT|JIRA_PASSWORD/i.test(key)) delete env[key];
  delete env.ATL_PROJECT;
  const output = fs.createWriteStream(path.join(dir, `${name.replaceAll('/', '_')}.log`));
  const child = spawn(process.execPath, [path.join(root, 'verification', name)], { cwd: root, env, windowsHide: true });
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGKILL');
  }, 180000);
  const code = await new Promise(resolve => { child.on('error', error => { output.write(String(error)); resolve(-1); }); child.on('close', resolve); });
  clearTimeout(timer);
  await new Promise(resolve => output.end(resolve));
  const result = { test: name, code, timedOut, durationMs: Date.now() - started, status: code === 0 && !timedOut ? 'passed' : 'failed' };
  results.push(result);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ started: path.basename(dir), results }, null, 2));
  console.log(`${result.status.toUpperCase()} ${name} (${result.durationMs} ms)`);
  // Keep isolated homes as evidence: failed processes may still hold file handles.
}
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(3, tests.length) }, async () => {
  while (cursor < tests.length) await run(tests[cursor++]);
}));
console.log(`Evidence: ${dir}; ${results.filter(row => row.status === 'passed').length}/${results.length} passed`);
if (results.some(row => row.status !== 'passed')) process.exitCode = 1;
