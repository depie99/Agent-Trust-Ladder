import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.resolve(here, '../../../../.atl-evidence/trials-v2');
const expected = {
  'SIMPLE-FA-COPY': ['verification/control_plane_fa_queue_test.mjs'],
  'REAL-BUG-CLI-ONCE': ['runtime/atl-manager.mjs', 'verification/control_room_test.mjs'],
  'MULTILAYER-WORKER-ATL-BIN': ['runtime/lib/worker.mjs', 'runtime/lib/launch.mjs', 'runtime/lib/supervisor.mjs'],
  'UI-QUEUE-FILTER-COUNTS': ['runtime/control-plane-client.js', 'verification/control_plane_task_count_test.mjs'],
  'DOCS-LOCAL-EVIDENCE-PATHS': ['docs/mock-system-e2e-2026-10-29.md'],
};
const walk = (dir, root, threshold, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, root, threshold, out);
    else if (fs.statSync(file).mtimeMs > threshold) out.push(path.relative(root, file).replaceAll(path.sep, '/'));
  }
  return out;
};
const resultPath = path.join(here, 'results-v2.jsonl');
const rows = fs.readFileSync(resultPath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
for (const row of rows) {
  const raw = path.join(evidence, `${row.trial_id}.jsonl`);
  const meta = JSON.parse(fs.readFileSync(path.join(evidence, `${row.trial_id}.meta.json`), 'utf8'));
  row.changed_paths = walk(meta.workspace, meta.workspace, fs.statSync(raw).birthtimeMs).sort();
  row.harness_generated_paths = row.changed_paths.filter(item => item.startsWith('.trust/') || item.startsWith('node_modules/'));
  row.out_of_scope_changed_paths = row.changed_paths.filter(item => !(expected[row.case_id] ?? []).includes(item) && !row.harness_generated_paths.includes(item));
}
const temp = `${resultPath}.tmp`;
fs.writeFileSync(temp, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
fs.renameSync(temp, resultPath);
console.log(JSON.stringify(rows.map(({ trial_id, changed_paths, out_of_scope_changed_paths, harness_generated_paths }) => ({ trial_id, changed_paths, out_of_scope_changed_paths, harness_generated_paths })), null, 2));
