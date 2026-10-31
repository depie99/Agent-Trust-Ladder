import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: node grade-worker-atlbin.mjs <candidate-workspace>');
const { workerEnvPolicy, CLAUDE_SUBSCRIPTION_UNSET_ENV } = await import(pathToFileURL(path.join(workspace, 'runtime/lib/worker.mjs')).href);

const expectedAtlBin = path.join(workspace, 'runtime', 'atl-manager.mjs');
const resolvesToCandidateManager = value => {
  if (typeof value !== 'string' || !value) return false;
  let resolved;
  try { resolved = path.resolve(value); } catch { return false; }
  return fs.existsSync(resolved) && path.relative(expectedAtlBin, resolved) === '';
};

// 1. Non-Claude supported workers must receive an ATL_BIN inside this checkout.
for (const [worker, auth] of [['codex', 'subscription'], ['codex', 'api'], ['claude', 'api']]) {
  const policy = workerEnvPolicy(worker, auth, {});
  assert.ok(resolvesToCandidateManager(policy.set?.ATL_BIN), `${worker}/${auth}: ATL_BIN set and resolves to this checkout's runtime/atl-manager.mjs (got ${JSON.stringify(policy.set?.ATL_BIN)})`);
}

// 2. Claude subscription keeps its credential unset/stripping contract unchanged…
const fakeEnv = Object.fromEntries([...CLAUDE_SUBSCRIPTION_UNSET_ENV, 'UNRELATED_KEEP_ME'].map(key => [key, 'x']));
const claudePolicy = workerEnvPolicy('claude', 'subscription', fakeEnv);
assert.deepEqual(claudePolicy.unset, [...CLAUDE_SUBSCRIPTION_UNSET_ENV], 'claude subscription unset list unchanged');
assert.deepEqual(claudePolicy.stripped, [...CLAUDE_SUBSCRIPTION_UNSET_ENV], 'claude subscription strips exactly the credential keys present in env');
assert.ok(!claudePolicy.unset.includes('UNRELATED_KEEP_ME'), 'unrelated env keys are not stripped');

// 3. …and ALSO receives ATL_BIN (the fix must add, not trade away, the path).
assert.ok(resolvesToCandidateManager(claudePolicy.set?.ATL_BIN), 'claude subscription also gets ATL_BIN');

// 4. Launch contract: the launch path must merge the policy's set map into the child env.
const launchSource = fs.readFileSync(path.join(workspace, 'runtime/lib/launch.mjs'), 'utf8');
assert.match(launchSource, /useEnvPolicy\s*\.\s*set/, 'launch.mjs merges workerEnvPolicy set map into child env');
assert.match(launchSource, /useEnvPolicy\s*\.\s*unset/, 'launch.mjs still applies the unset policy');

console.log('PASS: workerEnvPolicy exposes a valid in-checkout ATL_BIN for supported auth modes; claude credential stripping unchanged; launch merges the set map');
