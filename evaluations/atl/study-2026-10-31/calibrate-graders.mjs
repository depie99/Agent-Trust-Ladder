import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const root = path.resolve(repo, '../.atl-evidence/grader-calibration');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });

const graders = {
  'SIMPLE-FA-COPY': 'grade-simple-v2.mjs',
  'REAL-BUG-CLI-ONCE': 'grade-cli-once.mjs',
  'MULTILAYER-WORKER-ATL-BIN': 'grade-worker-atlbin.mjs',
  'UI-QUEUE-FILTER-COUNTS': 'grade-ui-queue-counts.mjs',
  'DOCS-LOCAL-EVIDENCE-PATHS': 'grade-docs-paths.mjs',
};
const revisions = {
  'SIMPLE-FA-COPY': ['61c42a1^', '61c42a1'],
  'REAL-BUG-CLI-ONCE': ['a27b877^', 'a27b877'],
  'MULTILAYER-WORKER-ATL-BIN': ['fa445b5^', 'fa445b5'],
  'UI-QUEUE-FILTER-COUNTS': ['4140480^', '4140480'],
  'DOCS-LOCAL-EVIDENCE-PATHS': ['eb4f92a^', 'eb4f92a'],
};

let failures = 0;
for (const [caseId, grader] of Object.entries(graders)) {
  for (const [label, rev] of [['base', revisions[caseId][0]], ['fix', revisions[caseId][1]]]) {
    const ws = path.join(root, `${caseId}-${label}`);
    fs.mkdirSync(ws, { recursive: true });
    execFileSync('git', ['archive', '--format=tar', '--output=' + path.join(root, 'tmp.tar'), rev], { cwd: repo });
    execFileSync('tar', ['-xf', path.join(root, 'tmp.tar'), '-C', ws]);
    fs.rmSync(path.join(ws, '.trust'), { recursive: true, force: true });
    let outcome;
    try {
      const stdout = execFileSync(process.execPath, [path.join(here, grader), ws], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
      outcome = `PASS ${stdout.trim().split('\n').pop()}`;
    } catch (error) {
      outcome = `FAIL ${String(error.stderr || error.message).trim().split('\n').slice(-2).join(' | ').slice(0, 220)}`;
    }
    const expected = label === 'fix' ? 'PASS' : 'FAIL';
    const ok = outcome.startsWith(expected);
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'BAD '} ${caseId} ${label}: expect ${expected} → ${outcome}`);
  }
}
fs.rmSync(path.join(root, 'tmp.tar'), { force: true });
console.log(failures === 0 ? 'CALIBRATION OK: all graders discriminate base vs fix' : `CALIBRATION FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
