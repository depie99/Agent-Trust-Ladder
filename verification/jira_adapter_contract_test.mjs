import assert from 'node:assert/strict';
import { intakeFromJira } from '../runtime/lib/intake.mjs';
const cfg = { base_url: 'https://jira.example.invalid/jira', projects: ['IT'], token_env: 'ATL_JIRA_CONTRACT_TOKEN' };
const oldToken = process.env.ATL_JIRA_CONTRACT_TOKEN;
let calls = 0;
const fetchImpl = async (url, options) => {
  calls++;
  assert.equal(new URL(url).pathname, '/jira/rest/api/2/search');
  assert.equal(options.headers.Authorization, 'Bearer synthetic');
  return { ok: true, json: async () => ({ issues: [
    { key: 'IT-100', fields: { summary: 'Vague middleware request', description: { content: [{ content: [{ text: 'Plan this description before executing.' }] }] }, updated: 'revision-1', labels: ['planning'] } },
    { key: 'IT-101', fields: { summary: 'Missing description' } },
    { key: 'OTHER-1', fields: { summary: 'Excluded project' } },
  ] }) };
};
try {
  delete process.env.ATL_JIRA_CONTRACT_TOKEN;
  await assert.rejects(() => intakeFromJira(cfg, { fetchImpl }), /server environment/);
  assert.equal(calls, 0);
  process.env.ATL_JIRA_CONTRACT_TOKEN = 'synthetic';
  for (const base_url of ['http://jira.example.invalid', 'https://user:secret@jira.example.invalid', 'https://jira.example.invalid?token=secret']) {
    await assert.rejects(() => intakeFromJira({ ...cfg, base_url }, { fetchImpl }), /HTTPS/);
  }
  await assert.rejects(() => intakeFromJira({ ...cfg, projects: [] }, { fetchImpl }), /project key/);
  const candidates = await intakeFromJira(cfg, { fetchImpl });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].objective_hint, 'Plan this description before executing.');
  assert.equal(candidates[0].source.revision, 'revision-1');
  assert.equal(candidates[0].source.url, 'https://jira.example.invalid/jira/browse/IT-100');
  assert.deepEqual(candidates[0].completion_checks, []);
  assert.equal(candidates[1].objective_hint, '');
  assert.equal(candidates[1].source.revision, null, 'missing revision is not fabricated');
  await assert.rejects(() => intakeFromJira(cfg, { fetchImpl: async () => ({ ok: false, status: 401 }) }), /401/);
  console.log('PASS: Jira HTTPS/auth/project failures, context path, rich text, missing description/revision and description-only planning input');
} finally {
  if (oldToken === undefined) delete process.env.ATL_JIRA_CONTRACT_TOKEN; else process.env.ATL_JIRA_CONTRACT_TOKEN = oldToken;
}
