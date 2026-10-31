import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: grade3-feature.mjs <workspace>');
const lib = await import(pathToFileURL(path.join(workspace, 'lib/expenses.mjs')).href);

assert.equal(typeof lib.filterByCategory, 'function', 'filterByCategory is exported');
assert.equal(typeof lib.totalByCategory, 'function', 'totalByCategory is exported');

const state = { expenses: [
  { id: 'e1', payer: 'Ana', amount: 20, participants: ['Ana'], archived: false, category: 'food' },
  { id: 'e2', payer: 'Ben', amount: 10, participants: ['Ben'], archived: false, category: 'food' },
  { id: 'e3', payer: 'Cleo', amount: 40, participants: ['Cleo'], archived: false, category: 'travel' },
  { id: 'e4', payer: 'Dan', amount: 5, participants: ['Dan'], archived: true, category: 'food' },
  { id: 'e5', payer: 'Eli', amount: 8, participants: ['Eli'], archived: false, note: 'no category' },
] };

const food = lib.filterByCategory(state, 'food');
assert.deepEqual(food.map(item => item.id).sort(), ['e1', 'e2'], 'food filter returns only active food expenses');
const travel = lib.filterByCategory(state, 'travel');
assert.deepEqual(travel.map(item => item.id), ['e3'], 'travel filter returns the travel expense');
const general = lib.filterByCategory(state, 'general');
assert.deepEqual(general.map(item => item.id), ['e5'], 'expenses without a category count as general');
assert.equal(lib.totalByCategory(state, 'food'), 30, 'totalByCategory sums active expenses only (archived excluded)');
assert.equal(lib.totalByCategory(state, 'travel'), 40, 'travel total');
assert.equal(lib.totalByCategory(state, 'general'), 8, 'general total');
assert.deepEqual(lib.filterByCategory(state, 'nope'), [], 'unknown category returns empty list');
console.log('PASS: category filter/total behave, archived excluded, uncategorized = general');
