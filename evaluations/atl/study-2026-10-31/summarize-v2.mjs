import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(path.join(here, 'results-v2.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const schedule = JSON.parse(fs.readFileSync(path.join(here, 'schedule-v2.json'), 'utf8'));

const cells = new Map();
for (const row of rows) {
  const key = `${row.case_id}|${row.condition}`;
  const cell = cells.get(key) ?? { pass: 0, fail: 0, incomplete: 0, cost: 0, elapsed: 0, input: 0, output: 0, oos: 0, questions: 0, n: 0 };
  cell[row.task_success] = (cell[row.task_success] ?? 0) + 1;
  cell.cost += row.api_equivalent_cost_usd;
  cell.elapsed += row.elapsed_seconds;
  cell.input += row.input_tokens;
  cell.output += row.output_tokens;
  cell.oos += row.out_of_scope_changed_paths.length;
  cell.questions += row.user_questions_or_blocks.length;
  cell.n++;
  cells.set(key, cell);
}

const caseIds = [...new Set(schedule.trials.map(t => t.case_id))];
const conditions = ['baseline', 'specialist-only', 'atl'];
console.log('Per case × condition (planned = 5 reps each):\n');
for (const caseId of caseIds) {
  console.log(caseId);
  for (const condition of conditions) {
    const cell = cells.get(`${caseId}|${condition}`) ?? { n: 0 };
    if (!cell.n) { console.log(`  ${condition.padEnd(16)} 0/5 run`); continue; }
    const passRate = `${cell.pass}/${cell.n}${cell.n < 5 ? ' (of planned 5)' : ''}`;
    console.log(`  ${condition.padEnd(16)} pass=${passRate.padEnd(12)} mean_cost=$${(cell.cost / cell.n).toFixed(3).padEnd(7)} mean_time=${Math.round(cell.elapsed / cell.n)}s  out_of_scope=${cell.oos}  questions=${cell.questions}`);
  }
}
console.log(`\nTotal recorded: ${rows.length} / ${schedule.trials.length} planned trials`);
console.log(`Critical failures to report separately: ${rows.filter(r => r.task_success === 'fail').map(r => `${r.trial_id}: ${r.verifier_result}`).join('\n  ') || 'none recorded yet'}`);
