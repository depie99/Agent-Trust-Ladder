// Explicitly invoked after verification; never run by workers or at module import.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { learnLocal, recallLocal } from '../runtime/lib/learning.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, '.atl-evidence/mock-regression');
const since = process.argv[2];
if (!since) throw new Error('Pass the first evidence run directory timestamp to bound this learning record');
const runs = fs.readdirSync(base).filter(name => name >= since && fs.existsSync(path.join(base, name, 'results.json'))).sort();
const latest = new Map(), failures = [];
for (const run of runs) {
  for (const result of JSON.parse(fs.readFileSync(path.join(base, run, 'results.json'), 'utf8')).results) {
    const row = { ...result, run, log: path.relative(root, path.join(base, run, result.test.replaceAll('/', '_') + '.log')).replaceAll('\\', '/') };
    latest.set(row.test, row);
    if (row.status !== 'passed') failures.push(row);
  }
}
assert.ok(latest.size > 0);
assert.ok([...latest.values()].every(row => row.status === 'passed'), 'Do not record a successful aggregate while any latest verifier fails');
const lessons = [
  'Mock E2E isolation: do not force ATL_PROJECT to the development checkout in a parent test runner. Let each CLI test choose its scratch root; strip inherited credentials and block external network and gh calls. A dirty checkout needs a pre-run config snapshot before claims of preservation.',
  'Issue intake success: keep source identity and revision, preview without task writes, require a grounded reviewed plan for vague descriptions, reject source revision drift, and execute dependencies in a fresh queue before declaring delivery.',
  'GitHub intake lesson: gh CLI labels are objects with a name property, while REST normalization can return strings. Test both shapes to retain priority and labels, including repository URLs with trailing issue paths.',
  'Provider quota lesson: worker diagnostics and recovery classifiers must share recognized wording. Provider reported exhausted quota and provider reported a rate limit must not trigger an unchanged blind retry; use eligible configured failover or remain blocked.',
  'Model routing success: choose the cheapest configured model that meets the observed capability tier; a lower planner estimate cannot downgrade observed risk. Preserve owner ceilings, explicit overrides, quota cooldowns and independent review capacity. Fixture runs cannot measure real quality or actual token savings.',
  'Mock delivery evidence limit: passing fixture workers and fixture reviewers prove bounded orchestration, executable checks and local delivery branches for the tested cases. They do not prove live-model reasoning, production authentication, remote PR publication or an hours-long overnight soak.',
];
const recorded = lessons.map(text => learnLocal(root, { kind: 'lesson', text, source: 'docs/mock-system-e2e-2026-10-29.md', tags: ['mock-e2e', 'intake', 'queue', 'verification'] }));
const recalled = recallLocal(root, 'mock E2E isolation ATL_PROJECT', { limit: 20 });
assert.ok(recalled.results.some(row => row.id === recorded[0].id), 'stored isolation lesson must be retrievable');
const report = { date: '2026-10-29', runs, verifiers: [...latest.values()].sort((a, b) => a.test.localeCompare(b.test)), historicalFailures: failures, lessons: recorded, recallVerified: true, limits: ['mock workers and reviews', 'no real source authentication', 'no remote publication', 'no multi-hour soak', 'no measured live-model cost or quality'] };
fs.writeFileSync(path.join(base, 'aggregate-2026-10-29.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(base, 'aggregate-2026-10-29.md'), `# Mock regression evidence, 2026-10-29\n\n${latest.size}/${latest.size} latest verifier results passed across ${runs.length} retained runs. ${failures.length} historical failures remain recorded. These are verifier programs, not a count of individual assertions.\n\n| Verifier | Latest result | Duration (ms) | Log |\n| --- | --- | --- | --- |\n${report.verifiers.map(row => `| ${row.test} | ${row.status} | ${row.durationMs} | [log](../../${row.log}) |`).join('\n')}\n`);
console.log(`Recorded ${recorded.length} local lessons and verified recall; ${latest.size}/${latest.size} latest verifiers passed. Historical failed attempts: ${failures.length}.`);
