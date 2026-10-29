import assert from 'node:assert/strict';
import { intakeFromGitHub, normalizeGitHubRepo } from '../runtime/lib/intake.mjs';
assert.equal(normalizeGitHubRepo('https://github.com/example/demo/issues/'), 'example/demo');
const issue = { number: 17, title: 'Fix queued middleware', body: 'A vague request requiring a reviewed plan.', url: 'https://github.com/example/demo/issues/17', labels: [{ name: 'high' }, { name: 'bug' }], updatedAt: 'revision-1' };
let restCalls = 0;
const cli = await intakeFromGitHub({ repos: ['https://github.com/example/demo/issues/'] }, {
  cliListImpl: async repo => { assert.equal(repo, 'example/demo'); return [issue]; },
  restListImpl: async () => { restCalls++; throw new Error('unnecessary REST call'); },
});
assert.equal(restCalls, 0);
assert.equal(cli[0].priority, 'high', 'real gh CLI label objects retain priority');
assert.deepEqual(cli[0].labels, ['high', 'bug']);
assert.equal(cli[0].source.revision, 'revision-1');
assert.deepEqual(cli[0].completion_checks, [], 'vague prose is not invented acceptance evidence');
const fallback = await intakeFromGitHub({ repos: ['example/demo'] }, {
  cliListImpl: async () => { throw new Error('gh unavailable'); },
  restListImpl: async () => [{ ...issue, labels: ['critical'], updatedAt: undefined, updated_at: 'revision-2' }],
});
assert.equal(fallback[0].priority, 'urgent');
assert.equal(fallback[0].source.revision, 'revision-2');
await assert.rejects(() => intakeFromGitHub({ repos: ['example/demo'] }, { cliListImpl: async () => { throw new Error('no gh'); }, restListImpl: async () => { throw new Error('HTTP 401 fixture'); } }), /401/);
console.log('PASS: GitHub CLI label objects, normalized URLs, REST fallback, captured revisions and explicit authentication failure');
