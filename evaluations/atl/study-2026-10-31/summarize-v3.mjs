import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(path.join(here, 'results-v3.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const schedule = JSON.parse(fs.readFileSync(path.join(here, 'schedule-v3.json'), 'utf8'));
const cases = [...new Set(schedule.trials.map(t => t.case_id))];
const conditions = ['baseline', 'specialist-only', 'atl'];

const fmt = n => n == null ? 'n/a' : Number(n).toLocaleString('en-US');
console.log(`recorded ${rows.length}/45 trials\n`);
for (const caseId of cases) {
  console.log(caseId);
  for (const condition of conditions) {
    const cell = rows.filter(r => r.case_id === caseId && r.condition === condition);
    if (!cell.length) { console.log(`  ${condition.padEnd(16)} none`); continue; }
    const pass = cell.filter(r => r.task_success === 'pass').length;
    const mean = (key) => cell.reduce((s, r) => s + (r[key] ?? 0), 0) / cell.length;
    const oos = cell.reduce((s, r) => s + r.out_of_scope_changed_paths.length, 0);
    console.log(`  ${condition.padEnd(16)} pass=${pass}/${cell.length}  tokens~${fmt(Math.round(mean('subagent_tokens'))).padStart(9)}  time=${Math.round(mean('elapsed_seconds') ?? 0)}s  tools=${(mean('tool_uses') ?? 0).toFixed(1)}  out_of_scope_paths=${oos}`);
    for (const r of cell) if (r.out_of_scope_changed_paths.length) console.log(`      ^ ${r.trial_id}: ${r.out_of_scope_changed_paths.join(', ')}`);
  }
}
const totalTokens = cond => { const cell = rows.filter(r => r.condition === cond); return Math.round(cell.reduce((s, r) => s + (r.subagent_tokens ?? 0), 0) / cell.length); };
console.log(`\nAggregate mean subagent_tokens per condition: baseline=${fmt(totalTokens('baseline'))}  specialist-only=${fmt(totalTokens('specialist-only'))}  atl=${fmt(totalTokens('atl'))}`);
console.log(`Mean elapsed: ${conditions.map(c => `${c}=${Math.round(rows.filter(r => r.condition === c).reduce((s, r) => s + r.elapsed_seconds, 0) / rows.filter(r => r.condition === c).length)}s`).join('  ')}`);
console.log(`Pass totals: ${conditions.map(c => `${c}=${rows.filter(r => r.condition === c && r.task_success === 'pass').length}/15`).join('  ')}`);
