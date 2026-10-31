import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: grade3-bug.mjs <workspace>');
const lib = await import(pathToFileURL(path.join(workspace, 'lib/expenses.mjs')).href);

// Grader-owned scenario (independent of any test file the candidate edits).
// Ana pays 30 split three ways: +30 -10 -6 = +14 (she also joins Ben's expense).
// Ben pays 12 split two ways: +12 -10 -6 = -4. Cleo: -10 = -10. Sum = 0.
const state = { expenses: [] };
lib.addExpense(state, { payer: 'Ana', amount: 30, participants: ['Ana', 'Ben', 'Cleo'] });
lib.addExpense(state, { payer: 'Ben', amount: 12, participants: ['Ana', 'Ben'] });
const balances = lib.computeBalances(state);
assert.equal(balances.Ana.toFixed(2), '14.00', `Ana net must be +14.00, got ${balances.Ana}`);
assert.equal(balances.Ben.toFixed(2), '-4.00', `Ben net must be -4.00, got ${balances.Ben}`);
assert.equal(balances.Cleo.toFixed(2), '-10.00', `Cleo net must be -10.00, got ${balances.Cleo}`);
const sum = Object.values(balances).reduce((a, b) => a + b, 0);
assert.equal(sum.toFixed(2), '0.00', `balances must sum to zero, got ${sum}`);
// Payer-only expense nets to zero, not -amount.
const solo = { expenses: [] };
lib.addExpense(solo, { payer: 'Zoe', amount: 10, participants: ['Zoe'] });
assert.equal(Math.abs(lib.computeBalances(solo).Zoe) < 1e-9, true, 'payer-only expense nets to zero');
lib.archiveExpense(state, state.expenses[1].id);
assert.equal(lib.totalSpend(state), 30, 'archived excluded from total');
console.log('PASS: payer credited, shares charged, balances sum to zero, archived excluded');
