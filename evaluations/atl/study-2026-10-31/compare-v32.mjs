import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(path.join(here, 'results-v3.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const mean = a => Math.round(a.reduce((s, r) => s + (r.subagent_tokens ?? 0), 0) / a.length);
const sel = (caseId, p) => rows.filter(r => r.case_id === caseId && p(r));
for (const caseId of ['FEATURE-CATEGORY', 'REFACTOR-STORAGE-TOLERANT']) {
  const base = mean(sel(caseId, r => r.condition === 'baseline'));
  const v3 = mean(sel(caseId, r => r.condition === 'atl' && r.trial_id.startsWith('V3-B')));
  const v31 = mean(sel(caseId, r => r.trial_id.startsWith('V31-')));
  const v32 = mean(sel(caseId, r => r.trial_id.startsWith('V32-')));
  const pass32 = sel(caseId, r => r.trial_id.startsWith('V32-')).every(r => r.task_success === 'pass');
  console.log(`${caseId}: baseline=${base} v3=${v3} v3.1=${v31} v3.2=${v32} (v3.2 vs baseline: ${(v32 / base).toFixed(2)}x) pass=${pass32 ? 'ok' : 'FAIL'}`);
}
