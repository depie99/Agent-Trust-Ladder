import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(path.join(here, 'results-v3.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const mean = arr => arr.length ? arr.reduce((s, r) => s + (r.subagent_tokens ?? 0), 0) / arr.length : null;
const pick = (caseId, filter) => rows.filter(r => r.case_id === caseId && filter(r));

console.log('ATL token cost: frozen v3 snapshot vs improved v3.1 snapshot (post-hoc confirmation, n=3 per cell)\n');
for (const caseId of ['FEATURE-CATEGORY', 'REFACTOR-STORAGE-TOLERANT']) {
  const oldAtl = mean(pick(caseId, r => r.condition === 'atl' && r.trial_id.startsWith('V3-B')));
  const newAtl = mean(pick(caseId, r => r.trial_id.startsWith('V31-')));
  const base = mean(pick(caseId, r => r.condition === 'baseline'));
  const newPass = pick(caseId, r => r.trial_id.startsWith('V31-')).every(r => r.task_success === 'pass');
  const pct = ((newAtl - oldAtl) / oldAtl * 100).toFixed(1);
  console.log(`${caseId}: baseline=${Math.round(base)}  atl-v3=${Math.round(oldAtl)}  atl-v3.1=${Math.round(newAtl)}  (Δ ${pct}% vs v3)  pass=${newPass ? '3/3' : 'NOT ALL PASS'}`);
}
