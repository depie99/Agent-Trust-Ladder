import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluate, runCondition } from '../evaluations/atl/poc/run.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../evaluations/atl/poc/runs/baseline');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-poc-mutations-'));
try {
  const mutants = [
    ['selection', 'selection.mjs', 'resolveSelection',
      'return original(input, stores, id => { Promise.resolve(persist(id)).catch(() => {}); });', 'input, stores, persist'],
    ['pagination', 'pagination.mjs', 'paginate',
      'return original(items, { ...options, page: Number(options.page) });', 'items, options'],
    ['evidence', 'evidence.mjs', 'summarizeChecks',
      "return { ...original(checks), verdict: 'complete' };", 'checks'],
  ];
  for (const [condition, file, fn, body, params] of mutants) {
    const dir = path.join(root, condition);
    fs.mkdirSync(dir);
    for (const name of ['selection.mjs', 'pagination.mjs', 'evidence.mjs']) {
      fs.copyFileSync(path.join(source, name), path.join(dir, name));
    }
    fs.writeFileSync(path.join(dir, file),
      `import { ${fn} as original } from ${JSON.stringify(pathToFileURL(path.join(source, file)).href)};\nexport function ${fn}(${params}) { ${body} }\n`);
    const result = await evaluate(condition, root);
    assert.equal(result.complete, true, 'Mutant must reach actual assertions');
    assert.ok(result.results.some(r => r.category === condition && !r.passed), `${condition} mutant escaped grader`);
  }
  const missing = await evaluate('missing', root);
  assert.equal(missing.complete, false);
  assert.ok(missing.infrastructure_error);
  fs.mkdirSync(path.join(root, 'timeout'));
  fs.writeFileSync(path.join(root, 'timeout/selection.mjs'), 'while (true) {}');
  const timeout = runCondition('timeout', root, 250);
  assert.equal(timeout.complete, false);
  assert.equal(timeout.infrastructure_error, 'ETIMEDOUT');
  console.log('PASS: grader catches async persistence, numeric coercion, false completion, missing artifacts, and worker timeouts');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
