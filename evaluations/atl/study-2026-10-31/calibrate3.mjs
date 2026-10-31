import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../.atl-evidence/skillbench-calibration');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const template = path.resolve(here, '../../../../.atl-evidence/skillbench-template');
const reference = path.resolve(here, '../../../../.atl-evidence/skillbench-reference');

const cases = {
  'BUG-BALANCE': { grader: 'grade3-bug.mjs', fixFiles: ['lib/expenses.mjs'] },
  'FEATURE-CATEGORY': { grader: 'grade3-feature.mjs', fixFiles: ['lib/expenses.mjs'] },
  'UI-SUMMARY-ARCHIVED': { grader: 'grade3-ui.mjs', fixFiles: ['lib/summary.mjs'] },
  'DOCS-README-CLI': { grader: 'grade3-docs.mjs', fixFiles: ['README.md'] },
  'REFACTOR-STORAGE-TOLERANT': { grader: 'grade3-refactor.mjs', fixFiles: ['lib/storage.mjs'] },
};

let failures = 0;
for (const [caseId, { grader, fixFiles }] of Object.entries(cases)) {
  for (const variant of ['pre', 'fix']) {
    const ws = path.join(root, `${caseId}-${variant}`);
    fs.cpSync(template, ws, { recursive: true });
    if (variant === 'fix') {
      for (const file of fixFiles) {
        fs.mkdirSync(path.dirname(path.join(ws, file)), { recursive: true });
        fs.copyFileSync(path.join(reference, file), path.join(ws, file));
      }
    }
    let outcome;
    try {
      const stdout = execFileSync(process.execPath, [path.join(here, grader), ws], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
      outcome = `PASS ${stdout.trim().split('\n').pop()}`;
    } catch (error) {
      outcome = `FAIL ${String(error.stderr || error.message).trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`;
    }
    const expected = variant === 'fix' ? 'PASS' : 'FAIL';
    const ok = outcome.startsWith(expected);
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'BAD '} ${caseId} ${variant}: expect ${expected} -> ${outcome}`);
  }
}
console.log(failures === 0 ? 'CALIBRATION OK' : `CALIBRATION FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
