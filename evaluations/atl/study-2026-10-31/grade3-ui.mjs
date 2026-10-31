import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: grade3-ui.mjs <workspace>');
const { renderSummary } = await import(pathToFileURL(path.join(workspace, 'lib/summary.mjs')).href);

const state = { expenses: [
  { id: 'e1', payer: 'Ana', amount: 20, participants: ['Ana', 'Ben'], archived: false },
  { id: 'e2', payer: 'Ben', amount: 10, participants: ['Ben'], archived: false },
  { id: 'e3', payer: 'Zed', amount: 99, participants: ['Zed'], archived: true },
] };
const html = renderSummary(state);
assert.match(html, /<p>\s*2\s+expenses\s*<\/p>/, `summary counts only active expenses (got: ${html.slice(0, 200)})`);
assert.ok(!html.includes('Zed'), `archived expense does not appear in the summary list (got: ${html})`);
assert.ok(html.includes('Ana') && html.includes('Ben'), 'active expenses still listed');
console.log('PASS: summary counts and lists only active expenses; archived excluded');
