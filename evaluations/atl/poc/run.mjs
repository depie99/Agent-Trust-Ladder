import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256 } from '../lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const freeze = value => Object.freeze(value);

export async function evaluate(condition, runRoot = path.join(here, 'runs')) {
  const dir = path.join(runRoot, condition);
  const results = [], hashes = {};
  const test = async (category, name, fn) => {
    try { await fn(); results.push({ category, name, passed: true }); }
    catch (error) { results.push({ category, name, passed: false, error: String(error.message) }); }
  };
  // Loading failures are infrastructure failures, never silently missing tests.
  const load = async file => {
    const full = path.join(dir, file);
    hashes[file] = sha256(fs.readFileSync(full));
    return import(pathToFileURL(full).href);
  };
  try {
    const { resolveSelection } = await load('selection.mjs');
    const stores = freeze([freeze({ id: 'old-1', sellerId: 'new-1' }), freeze({ id: 'old-2', sellerId: 'new-2' })]);
    for (const [label, input] of [['new', freeze({ sellerId: 'new-2' })], ['legacy', freeze({ storeId: 'old-2' })]]) {
      await test('selection', label, async () => {
        const calls = [];
        const actual = await resolveSelection(input, stores, async id => { calls.push(id); });
        assert.deepEqual(actual, { storeId: 'old-2', sellerId: 'new-2' });
        assert.deepEqual(calls, ['old-2']);
      });
    }
    const invalid = [null, [], 'new-1', {}, { sellerId: '' }, { sellerId: 1 },
      { sellerId: 'missing' }, { storeId: 'missing' }, { sellerId: 'new-1', storeId: 'old-1' },
      { sellerId: 'new-1', storeId: null }];
    for (const [i, input] of invalid.entries()) await test('selection', `reject-invalid-${i}`, async () => {
      let calls = 0;
      await assert.rejects(async () => resolveSelection(input, stores, async () => { calls++; }));
      assert.equal(calls, 0, 'Invalid input must not persist');
    });
    await test('selection', 'duplicate-match', async () => {
      let calls = 0;
      await assert.rejects(async () => resolveSelection({ sellerId: 'new-1' }, [...stores, { id: 'old-3', sellerId: 'new-1' }], async () => { calls++; }));
      assert.equal(calls, 0);
    });
    await test('selection', 'duplicate-legacy-match', async () => {
      let calls = 0;
      await assert.rejects(async () => resolveSelection({ storeId: 'old-1' }, [...stores, { id: 'old-1', sellerId: 'new-3' }], async () => { calls++; }));
      assert.equal(calls, 0);
    });
    for (const [i, records] of [null, {}, [null], [{ id: '', sellerId: 'new-1' }],
      [{ id: 'old-1', sellerId: 1 }], [{ sellerId: 'new-1' }]].entries()) {
      await test('selection', `malformed-stores-${i}`, async () => {
        let calls = 0;
        await assert.rejects(async () => resolveSelection({ sellerId: 'new-1' }, records, async () => { calls++; }));
        assert.equal(calls, 0);
      });
    }
    await test('selection', 'persistence-failure', async () => {
      const failure = new Error('disk unavailable');
      await assert.rejects(async () => resolveSelection({ storeId: 'old-1' }, stores, async () => { throw failure; }), e => e === failure);
    });
    await test('selection', 'await-before-return', async () => {
      let release;
      const barrier = new Promise(resolve => { release = resolve; });
      let finished = false;
      const task = resolveSelection({ sellerId: 'new-1', extra: true }, stores, () => barrier).then(result => { finished = true; return result; });
      await Promise.resolve(); await Promise.resolve();
      assert.equal(finished, false);
      release();
      assert.deepEqual(await task, { storeId: 'old-1', sellerId: 'new-1' });
    });

    const { paginate } = await load('pagination.mjs');
    const items = freeze([1, 2, 3, 4, 5]);
    await test('pagination', 'partial-last-page', () => assert.deepEqual(paginate(items, freeze({ page: 3, pageSize: 2 })),
      { items: [5], page: 3, pageSize: 2, total: 5, totalPages: 3 }));
    await test('pagination', 'empty', () => assert.deepEqual(paginate([], { page: 1, pageSize: 2 }),
      { items: [], page: 1, pageSize: 2, total: 0, totalPages: 0 }));
    await test('pagination', 'beyond-last-page', () => assert.deepEqual(paginate(items, { page: 20, pageSize: 2 }).items, []));
    await test('pagination', 'fresh-array', () => assert.notEqual(paginate(items, { page: 1, pageSize: 20 }).items, items));
    for (const [i, options] of [{ page: 0, pageSize: 2 }, { page: 1, pageSize: 0 },
      { page: 1.5, pageSize: 2 }, { page: '1', pageSize: 2 }, { page: 1, pageSize: Infinity },
      { page: NaN, pageSize: 2 }, { page: 1 }, {}, null,
      { page: Number.MAX_SAFE_INTEGER, pageSize: 4 }].entries()) {
      await test('pagination', `invalid-options-${i}`, () => assert.throws(() => paginate(items, options)));
    }
    await test('pagination', 'invalid-items', () => assert.throws(() => paginate('123', { page: 1, pageSize: 2 })));

    const { summarizeChecks } = await load('evidence.mjs');
    const check = (name, required, status) => freeze({ name, required, status });
    await test('evidence', 'required-pass', () => assert.deepEqual(summarizeChecks(freeze([check('unit', true, 'passed')])),
      { verdict: 'complete', skipped: [], unknown: [] }));
    await test('evidence', 'empty-not-complete', () => assert.equal(summarizeChecks([]).verdict, 'conditional'));
    await test('evidence', 'optional-only-not-complete', () => assert.equal(summarizeChecks([check('lint', false, 'passed')]).verdict, 'conditional'));
    for (const status of ['skipped', 'unknown']) await test('evidence', `required-${status}`, () => {
      const result = summarizeChecks([check('unit', true, 'passed'), check('runtime', true, status)]);
      assert.equal(result.verdict, 'conditional'); assert.deepEqual(result[status], ['runtime']);
    });
    await test('evidence', 'optional-failure-dominates', () => assert.equal(summarizeChecks([check('unit', true, 'passed'), check('lint', false, 'failed')]).verdict, 'failed'));
    await test('evidence', 'failure-over-unknown', () => assert.equal(summarizeChecks([check('runtime', true, 'unknown'), check('unit', true, 'failed')]).verdict, 'failed'));
    await test('evidence', 'optional-gaps-visible-in-order', () => assert.deepEqual(summarizeChecks([
      check('unit', true, 'passed'), check('e2e', false, 'skipped'), check('a11y', false, 'skipped'), check('prod', false, 'unknown')]),
      { verdict: 'complete', skipped: ['e2e', 'a11y'], unknown: ['prod'] }));
    for (const [i, input] of [null, {}, [null], [check('', true, 'passed')],
      [check('unit', 'yes', 'passed')], [check('unit', true, 'not-run')],
      [check('unit', true, 'passed'), check('unit', false, 'passed')]].entries()) {
      await test('evidence', `malformed-${i}`, () => assert.throws(() => summarizeChecks(input)));
    }
  } catch (error) {
    return { condition, infrastructure_error: String(error.message), results, hashes, complete: false };
  }
  return { condition, results, hashes, complete: true,
    categories: Object.fromEntries(['selection', 'pagination', 'evidence'].map(category => {
      const rows = results.filter(r => r.category === category);
      return [category, { passed: rows.filter(r => r.passed).length, total: rows.length }];
    })), passed: results.filter(r => r.passed).length, total: results.length };
}

export function runCondition(condition, runRoot = path.join(here, 'runs'), timeoutMs = 10_000) {
  const child = spawnSync(process.execPath, [path.join(here, 'worker.mjs'), condition, runRoot],
    { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true });
  if (child.error || child.status !== 0) return { condition, complete: false,
    infrastructure_error: child.error?.code || child.stderr || `Worker exited ${child.status}` };
  try { return JSON.parse(child.stdout); }
  catch { return { condition, complete: false, infrastructure_error: 'Invalid worker report' }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runs = [];
  for (const condition of ['baseline', 'atl']) runs.push(runCondition(condition));
  const report = { kind: 'implementation-poc', created_at: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform },
    task_sha256: sha256(fs.readFileSync(path.join(here, 'task.md'))),
    evaluator_sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))), runs,
    evaluator_dependency_sha256: {
      'lib.mjs': sha256(fs.readFileSync(path.join(here, '../lib.mjs'))),
      'worker.mjs': sha256(fs.readFileSync(path.join(here, 'worker.mjs'))),
    },
    limits: ['One run per condition; no statistical or causal conclusion.',
      'Development fixtures, not independent real-repository tasks.',
      'No measured token cost or comparable end-to-end latency.',
      'Passing fixtures establish only the tested bounded contracts.'] };
  fs.writeFileSync(path.join(here, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(runs.map(({ condition, categories, passed, total, infrastructure_error }) => ({ condition, categories, passed, total, infrastructure_error })), null, 2));
  if (runs.some(r => !r.complete || r.passed !== r.total)) process.exitCode = 1;
}
