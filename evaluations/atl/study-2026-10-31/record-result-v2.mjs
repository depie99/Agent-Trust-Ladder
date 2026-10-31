import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prereg = JSON.parse(fs.readFileSync(path.join(here, 'preregistration-v2.json'), 'utf8'));
const evidence = path.resolve(here, '../../../../.atl-evidence/trials-v2');
const [trialId, gradeArg, grader, verifier = 'not-run', ...noteParts] = process.argv.slice(2);
if (!trialId || !['pass', 'fail', 'incomplete'].includes(gradeArg) || !grader) {
  throw new Error('Usage: node record-result-v2.mjs <trial_id> <pass|fail|incomplete> <grader> [verifier-result] [notes...]');
}
const meta = JSON.parse(fs.readFileSync(path.join(evidence, `${trialId}.meta.json`), 'utf8'));
const raw = fs.readFileSync(path.join(evidence, `${trialId}.jsonl`), 'utf8');
const workspace = meta.workspace;
const rawStat = fs.statSync(path.join(evidence, `${trialId}.jsonl`));
const changedPaths = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (fs.statSync(absolute).mtimeMs > rawStat.birthtimeMs) changedPaths.push(path.relative(workspace, absolute).replaceAll(path.sep, '/'));
  }
};
walk(workspace);
let usage = null;
let toolCalls = 0;
let failedCalls = 0;
const agentMessages = [];
for (const line of raw.split(/\r?\n/).filter(Boolean)) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (event.type === 'turn.completed' && event.usage) usage = event.usage;
  if (event.type === 'item.started' && event.item?.type === 'command_execution') toolCalls++;
  if (event.type === 'item.completed' && event.item?.type === 'command_execution' && event.item.exit_code !== 0) failedCalls++;
  if (event.type === 'item.completed' && event.item?.type === 'agent_message') agentMessages.push(event.item.text);
}
if (!usage) throw new Error(`No final usage event in ${trialId}`);
const rate = prereg.pricing.usd_per_million_tokens;
const uncachedInput = Math.max(0, usage.input_tokens - (usage.cached_input_tokens ?? 0) - (usage.cache_write_input_tokens ?? 0));
const cost = (uncachedInput * rate.uncached_input + (usage.cached_input_tokens ?? 0) * rate.cached_input + (usage.cache_write_input_tokens ?? 0) * rate.cache_write_input + usage.output_tokens * rate.output) / 1_000_000;
const expectedPaths = {
  'SIMPLE-FA-COPY': ['verification/control_plane_fa_queue_test.mjs'],
  'REAL-BUG-CLI-ONCE': ['runtime/atl-manager.mjs', 'verification/control_room_test.mjs'],
  'MULTILAYER-WORKER-ATL-BIN': ['runtime/lib/worker.mjs', 'runtime/lib/launch.mjs', 'runtime/lib/supervisor.mjs'],
  'UI-QUEUE-FILTER-COUNTS': ['runtime/control-plane-client.js', 'verification/control_plane_task_count_test.mjs'],
  'DOCS-LOCAL-EVIDENCE-PATHS': ['docs/mock-system-e2e-2026-10-29.md'],
}[meta.case_id] ?? [];
const harnessPaths = changedPaths.filter(item => item.startsWith('.trust/') || item.startsWith('node_modules/'));
const outOfScope = changedPaths.filter(item => !expectedPaths.includes(item) && !harnessPaths.includes(item));
const record = {
  study_id: prereg.study_id, trial_id: trialId, case_id: meta.case_id, condition: meta.condition,
  task_success: gradeArg, grader, verifier_result: verifier,
  critical_failure: gradeArg === 'fail' ? 'task acceptance failed' : null,
  user_questions_or_blocks: agentMessages.filter(text => /\b(?:need you to|please confirm|could you|can you)\b|\?\s*$/im.test(text)),
  changed_paths: changedPaths,
  out_of_scope_changed_paths: outOfScope,
  harness_generated_paths: harnessPaths,
  input_tokens: usage.input_tokens, cached_input_tokens: usage.cached_input_tokens ?? 0,
  output_tokens: usage.output_tokens, reasoning_tokens: usage.reasoning_output_tokens ?? 0,
  api_equivalent_cost_usd: Number(cost.toFixed(6)), elapsed_seconds: meta.elapsed_seconds,
  tool_calls: toolCalls, failed_tool_calls: failedCalls,
  timeout: Boolean(meta.timed_out), failure_cause: gradeArg === 'fail' ? verifier : null,
  notes: noteParts.join(' '), raw_output: meta.raw_output,
};
const resultsPath = path.join(here, 'results-v2.jsonl');
fs.appendFileSync(resultsPath, JSON.stringify(record) + '\n', { flag: 'a' });
console.log(JSON.stringify(record, null, 2));
