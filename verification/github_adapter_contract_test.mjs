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
  restListImpl: async (repo, token) => {
    restCalls++;
    assert.equal(repo, 'example/demo', 'REST fallback receives the normalized repo');
    assert.equal(token, null, 'without a session token the REST fallback gets no override');
    return [{ ...issue, labels: ['critical'], updatedAt: undefined, updated_at: 'revision-2' }];
  },
});
assert.equal(fallback[0].priority, 'urgent');
assert.equal(fallback[0].source.revision, 'revision-2');
assert.equal(restCalls, 1);
const withToken = await intakeFromGitHub({ repos: ['example/demo'] }, {
  cliListImpl: async () => { throw new Error('gh unavailable'); },
  restListImpl: async (repo, token) => {
    restCalls++;
    assert.equal(repo, 'example/demo', 'token fallback also receives the normalized repo');
    assert.equal(token, 'gh-contract-token', 'the session GitHub token reaches the REST fallback');
    return [{ ...issue, updatedAt: 'revision-3' }];
  },
  token: 'gh-contract-token',
});
assert.equal(withToken[0].source.revision, 'revision-3', 'token-authenticated REST fallback results are kept');
assert.equal(restCalls, 2);
await assert.rejects(() => intakeFromGitHub({ repos: ['example/demo'] }, { cliListImpl: async () => { throw new Error('no gh'); }, restListImpl: async () => { throw new Error('HTTP 401 fixture'); } }), /401/);
console.log('PASS: GitHub CLI label objects, normalized URLs, REST fallback, captured revisions and explicit authentication failure');
