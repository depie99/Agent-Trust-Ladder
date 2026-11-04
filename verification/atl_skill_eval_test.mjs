import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, grade, inventory } from '../evaluations/atl/lib.mjs';

const cases = [{ id: 'a', category: 'copy', routes: ['direct'], doses: ['Direct'], verdicts: ['conditional'] },
  { id: 'b', category: 'auth', routes: ['verify'], doses: ['Critical'], verdicts: ['conditional'] }];
const good = [{ id: 'a', route: 'direct', dose: 'Direct', verdict: 'conditional', next_action: 'Edit', reason: 'Local' },
  { id: 'b', route: 'verify', dose: 'Critical', verdict: 'conditional', next_action: 'Observe', reason: 'Unobserved' }];
assert.equal(grade(cases, good).filter(r => r.passed).length, 2);
assert.equal(grade(cases, []).filter(r => r.passed).length, 0, 'Missing results fail rather than vanish from denominator');
assert.throws(() => grade(cases, [...good, good[0]]), /duplicate/);
assert.throws(() => grade(cases, [{ ...good[0], id: 'unknown' }]), /Unknown/);
assert.throws(() => grade(cases, [{ ...good[0], route: 'invented' }]), /Malformed/);
assert.throws(() => grade(cases, [{ ...good[0], reason: '' }]), /Malformed/);
assert.throws(() => grade(cases, [null]), /Malformed/);
assert.throws(() => grade([], []), /empty/);
assert.throws(() => grade([cases[0], cases[0]], []), /Malformed/);
const bad = good.map(d => ({ ...d, verdict: 'complete' }));
assert.equal(grade(cases, bad).some(r => r.passed), false, 'Completion without evidence must fail');
assert.equal(grade(cases, [{ ...good[0], dose: 'Critical' }])[0].passed, false, 'Over-process fails Direct task');
assert.equal(grade(cases, [{ ...good[0], verdict: 'blocked' }])[0].passed, false, 'Unnecessary blocking fails a ready local task');
const uplift = compare(cases, bad, good);
assert.equal(uplift.delta_percentage_points, 100);
assert.equal(uplift.wins, 2);
assert.equal(compare(cases, good, bad).losses, 2);
assert.equal(compare(cases, good, good).delta_percentage_points, 0);
assert.equal(compare(cases, good, good).ties, 2);
const skills = inventory(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
assert.ok(skills.length > 0);
for (const skill of skills) {
  assert.equal(skill.metadata_basic_valid, true, `${skill.name}: basic name/description metadata`);
  assert.deepEqual(skill.broken_links, [], `${skill.name}: broken local Markdown links`);
}
console.log(`PASS: submission validation, premature completion, dose, paired outcomes; basic metadata and local links for ${skills.length} skills`);
