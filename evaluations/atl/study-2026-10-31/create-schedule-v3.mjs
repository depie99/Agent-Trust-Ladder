import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prereg = JSON.parse(fs.readFileSync(path.join(here, 'preregistration-v3.json'), 'utf8'));
const cases = prereg.cases.map(item => item.id);
const conditions = prereg.design.conditions;
const reps = prereg.design.repetitions_per_case_condition;

// Frozen deterministic rotation: task order shifts by block; condition order shifts by case index and block.
const trials = [];
for (let block = 1; block <= reps; block++) {
  const orderedCases = cases.map((_, i) => cases[(i + block - 1) % cases.length]);
  for (let ci = 0; ci < orderedCases.length; ci++) {
    const caseId = orderedCases[ci];
    for (let co = 0; co < conditions.length; co++) {
      const condition = conditions[(ci + block + co) % conditions.length];
      trials.push({
        trial_id: `V3-B${block}-${caseId}-${condition}`,
        block, case_id: caseId, condition,
        condition_order: co + 1,
      });
    }
  }
}
const schedule = {
  study_id: prereg.study_id,
  preregistration_sha256: createHash('sha256').update(fs.readFileSync(path.join(here, 'preregistration-v3.json'))).digest('hex'),
  schedule_rule: 'Task order rotates by block; condition order rotates by case index and block (deterministic, frozen).',
  trials,
};
fs.writeFileSync(path.join(here, 'schedule-v3.json'), JSON.stringify(schedule, null, 2));
console.log(`wrote schedule-v3.json with ${trials.length} trials`);
