import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('.', import.meta.url);
const preregPath = new URL('preregistration-v2.json', root);
const preregBytes = fs.readFileSync(preregPath);
const prereg = JSON.parse(preregBytes);
const hash = value => createHash('sha256').update(value).digest('hex');
const rotate = (items, offset) => items.map((_, i) => items[(i + offset) % items.length]);
const cases = prereg.cases;
const conditions = Object.keys(prereg.conditions);
const trials = [];

for (let block = 0; block < prereg.design.repetitions_per_case_condition; block++) {
  const caseOrder = rotate(cases, block % cases.length);
  for (let position = 0; position < caseOrder.length; position++) {
    const testCase = caseOrder[position];
    const conditionOrder = rotate(conditions, (block + position) % conditions.length);
    for (let conditionPosition = 0; conditionPosition < conditionOrder.length; conditionPosition++) {
      const condition = conditionOrder[conditionPosition];
      trials.push({
        trial_id: `B${block + 1}-${testCase.id}-${condition}`,
        block: block + 1,
        case_id: testCase.id,
        repetition: block + 1,
        condition,
        task_order: position + 1,
        condition_order: conditionPosition + 1,
        prompt_sha256: hash(testCase.prompt),
      });
    }
  }
}

if (trials.length !== prereg.design.planned_trials) throw new Error('Schedule size differs from preregistration');
for (const testCase of cases) for (const condition of conditions) {
  const count = trials.filter(t => t.case_id === testCase.id && t.condition === condition).length;
  if (count !== prereg.design.repetitions_per_case_condition) throw new Error(`Bad repetition count: ${testCase.id}/${condition}`);
}

const schedule = {
  study_id: prereg.study_id,
  preregistration_sha256: hash(preregBytes),
  schedule_rule: prereg.design.order,
  trials,
};
const output = new URL('schedule-v2.json', root);
fs.writeFileSync(output, JSON.stringify(schedule, null, 2) + '\n');
console.log(JSON.stringify({ study_id: schedule.study_id, trials: trials.length,
  preregistration_sha256: schedule.preregistration_sha256, output: output.pathname }, null, 2));
