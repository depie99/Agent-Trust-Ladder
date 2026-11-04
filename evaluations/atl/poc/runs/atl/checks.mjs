import assert from 'node:assert/strict';
import { resolveSelection } from './selection.mjs';
import { paginate } from './pagination.mjs';
import { summarizeChecks } from './evidence.mjs';

let assertions = 0;
const equal = (a, b) => { assert.deepEqual(a, b); assertions++; };
const throws = fn => { assert.throws(fn); assertions++; };
const rejects = async fn => { await assert.rejects(fn); assertions++; };
const stores = Object.freeze([Object.freeze({ id: 'store-a', sellerId: 'seller-a' })]);
let calls = [];
for (const input of [{ sellerId: 'seller-a', extra: true }, { storeId: 'store-a' }]) {
  equal(await resolveSelection(Object.freeze(input), stores, async id => calls.push(id)),
    { storeId: 'store-a', sellerId: 'seller-a' });
}
equal(calls, ['store-a', 'store-a']);
for (const input of [null, [], 1, 'seller-a', {}, { sellerId: '' }, { sellerId: ' ' },
  { sellerId: 1 }, { sellerId: 'seller-a', storeId: undefined },
  { sellerId: null, storeId: 'store-a' }, { sellerId: 'seller-a', storeId: 'store-a' },
  { sellerId: 'missing' }]) {
  await rejects(() => resolveSelection(input, stores, () => { throw new Error('must not persist'); }));
}
let invalidCalls = 0;
for (const badStores of [null, [null], [{}], [...stores, ...stores], new Array(1)]) {
  await rejects(() => resolveSelection({ sellerId: 'seller-a' }, badStores, () => invalidCalls++));
}
equal(invalidCalls, 0);
const failure = new Error('persistence failed');
await assert.rejects(resolveSelection({ storeId: 'store-a' }, stores, async () => { throw failure; }),
  error => error === failure); assertions++;
let release;
const pending = new Promise(resolve => { release = resolve; });
let returned = false;
const result = resolveSelection({ sellerId: 'seller-a' }, stores, () => pending)
  .then(value => { returned = true; return value; });
await Promise.resolve();
equal(returned, false);
release();
equal(await result, { storeId: 'store-a', sellerId: 'seller-a' });

const items = Object.freeze([1, 2, 3, 4, 5]);
equal(paginate(items, Object.freeze({ page: 2, pageSize: 2 })),
  { items: [3, 4], page: 2, pageSize: 2, total: 5, totalPages: 3 });
equal(paginate([], { page: 1, pageSize: 2 }),
  { items: [], page: 1, pageSize: 2, total: 0, totalPages: 0 });
equal(paginate(items, { page: 4, pageSize: 2 }).items, []);
assert.notStrictEqual(paginate(items, { page: 1, pageSize: 10 }).items, items); assertions++;
for (const options of [undefined, null, [], {}, { page: 1 }, { page: '1', pageSize: 2 },
  { page: 0, pageSize: 2 }, { page: -1, pageSize: 2 }, { page: 1.5, pageSize: 2 },
  { page: 1, pageSize: NaN }, { page: Infinity, pageSize: 2 },
  { page: Number.MAX_SAFE_INTEGER + 1, pageSize: 1 },
  { page: Number.MAX_SAFE_INTEGER, pageSize: 2 },
  { page: 2, pageSize: Number.MAX_SAFE_INTEGER }]) throws(() => paginate(items, options));
throws(() => paginate({}, { page: 1, pageSize: 2 }));
equal(paginate(items, { page: Number.MAX_SAFE_INTEGER, pageSize: 1 }).items, []);

const check = (name, required, status) => ({ name, required, status });
equal(summarizeChecks([]), { verdict: 'conditional', skipped: [], unknown: [] });
equal(summarizeChecks([check('optional', false, 'passed')]).verdict, 'conditional');
equal(summarizeChecks(Object.freeze([
  Object.freeze(check('required', true, 'passed')), Object.freeze(check('skip', false, 'skipped')),
  Object.freeze(check('unknown', false, 'unknown'))
])), { verdict: 'complete', skipped: ['skip'], unknown: ['unknown'] });
equal(summarizeChecks([check('required', true, 'passed'), check('optional', false, 'failed')]).verdict, 'failed');
for (const status of ['skipped', 'unknown', 'failed']) {
  equal(summarizeChecks([check('required', true, status)]).verdict,
    status === 'failed' ? 'failed' : 'conditional');
}
equal(summarizeChecks([check('s1', false, 'skipped'), check('u1', false, 'unknown'),
  check('s2', false, 'skipped'), check('u2', false, 'unknown')]),
  { verdict: 'conditional', skipped: ['s1', 's2'], unknown: ['u1', 'u2'] });
for (const malformed of [null, {}, [null], [[]], [{}], [check('', true, 'passed')],
  [check(' ', true, 'passed')], [check('a', 1, 'passed')], [check('a', true, 'green')],
  [check('a', true, 'passed'), check('a', false, 'passed')], new Array(1)]) {
  throws(() => summarizeChecks(malformed));
}
console.log(JSON.stringify({ status: 'passed', assertions,
  coverage: ['selection validation and compatibility', 'persistence awaiting and failure identity',
    'frozen caller inputs', 'pagination validation and safe offsets', 'evidence verdicts and ordered gaps'] }));
