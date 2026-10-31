import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prereg = JSON.parse(fs.readFileSync(path.join(here, 'preregistration-v3.json'), 'utf8'));
const evidence = path.resolve(here, '../../../../.atl-evidence/skillbench-trials');
const [trialId, gradeArg, ...noteParts] = process.argv.slice(2);
if (!trialId || !['pass', 'fail', 'incomplete'].includes(gradeArg)) {
  throw new Error('Usage: node record-trial-v3.mjs <trial_id> <pass|fail|incomplete> [grader-output...]');
}
const meta = JSON.parse(fs.readFileSync(path.join(evidence, `${trialId}.meta.json`), 'utf8'));
const workspace = meta.workspace;
const prepared = new Date(meta.prepared_at).getTime();
const changedPaths = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (fs.statSync(absolute).mtimeMs > prepared) changedPaths.push(path.relative(workspace, absolute).replaceAll(path.sep, '/'));
  }
};
walk(workspace);
const skillsPaths = changedPaths.filter(item => item.startsWith('skills/'));
const outOfScope = changedPaths.filter(item => !meta.expected_paths.some(expected => item === expected || item.startsWith(expected)) && !skillsPaths.includes(item));
const templateRoot = path.resolve(here, '../../../../.atl-evidence/skillbench-template');
let repoSuite = 'not-applicable';
try {
  execFileSync(process.execPath, ['--test', 'test/'], { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  repoSuite = 'pass';
} catch (error) {
  repoSuite = `fail: ${String(error.stderr || error.message).split('\n').filter(l => /fail|pass /.test(l)).slice(-1)[0]?.slice(0, 80) ?? 'failed'}`;
}
const record = {
  study_id: prereg.study_id, trial_id: trialId, case_id: meta.case_id, condition: meta.condition,
  model: meta.model, task_success: gradeArg,
  grader: meta.grader, grader_notes: noteParts.join(' '),
  changed_paths: changedPaths, skills_bundle_paths: skillsPaths.length,
  out_of_scope_changed_paths: outOfScope,
  repo_test_suite_after_trial: repoSuite,
  elapsed_seconds: process.env.TRIAL_ELAPSED_SECONDS ? Number(process.env.TRIAL_ELAPSED_SECONDS) : null,
  subagent_tokens: process.env.TRIAL_TOKENS ? Number(process.env.TRIAL_TOKENS) : null,
  tool_uses: process.env.TRIAL_TOOL_USES ? Number(process.env.TRIAL_TOOL_USES) : null,
  token_note: 'Aggregate subagent_tokens as reported by the ZCode Agent harness (input+output aggregate).',
};
fs.appendFileSync(path.join(here, 'results-v3.jsonl'), JSON.stringify(record) + '\n');
console.log(JSON.stringify(record, null, 2));
