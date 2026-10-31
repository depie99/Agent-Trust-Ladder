import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const schedule = JSON.parse(fs.readFileSync(path.join(here, 'schedule-v2.json'), 'utf8'));
const resultsPath = path.join(here, 'results-v2.jsonl');
const done = new Set(fs.existsSync(resultsPath)
  ? fs.readFileSync(resultsPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line).trial_id)
  : []);
const graders = {
  'SIMPLE-FA-COPY': 'grade-simple-v2.mjs',
  'REAL-BUG-CLI-ONCE': 'grade-cli-once.mjs',
  'MULTILAYER-WORKER-ATL-BIN': 'grade-worker-atlbin.mjs',
  'UI-QUEUE-FILTER-COUNTS': 'grade-ui-queue-counts.mjs',
  'DOCS-LOCAL-EVIDENCE-PATHS': 'grade-docs-paths.mjs',
};
const remaining = schedule.trials.filter(trial => !done.has(trial.trial_id));
console.log(`[driver] ${done.size} already recorded, ${remaining.length} remaining`);

for (const trial of remaining) {
  const id = trial.trial_id;
  console.log(`[driver] === START ${id} at ${new Date().toISOString()}`);
  try {
    execFileSync(process.execPath, [path.join(here, 'run-trial-v2.mjs'), id], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 660_000 });
  } catch (error) {
    console.log(`[driver] RUN ERROR ${id}: ${String(error.stderr || error.message).slice(0, 500)}`);
    continue; // stays out of results; counted in driver log, not silently retried
  }
  {
    // Abort the whole sweep if the provider cut us off (quota/limit) — those are
    // infrastructure failures, not trials, and burning the schedule on them is waste.
    const raw = fs.readFileSync(path.resolve(here, '../../../../.atl-evidence/trials-v2', `${id}.jsonl`), 'utf8');
    if (/usage limit|rate limit/i.test(raw)) {
      console.log(`[driver] ABORT: provider usage/rate limit hit at ${id}; remaining schedule left untouched.`);
      process.exit(2);
    }
  }
  const meta = JSON.parse(fs.readFileSync(path.resolve(here, '../../../../.atl-evidence/trials-v2', `${id}.meta.json`), 'utf8'));
  let grade = 'incomplete';
  let detail = '';
  try {
    const stdout = execFileSync(process.execPath, [path.join(here, graders[trial.case_id]), meta.workspace], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 150_000 });
    grade = 'pass';
    detail = stdout.trim().split('\n').pop();
  } catch (error) {
    const message = String(error.stderr || error.message);
    grade = message.includes('ERR_ASSERTION') ? 'fail' : 'incomplete';
    detail = message.trim().split('\n').slice(-2).join(' | ').slice(0, 300);
  }
  try {
    execFileSync(process.execPath, [path.join(here, 'record-result-v2.mjs'), id, grade, `independent grader ${graders[trial.case_id]}`, detail], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`[driver] RECORDED ${id}: ${grade} :: ${detail}`);
  } catch (error) {
    console.log(`[driver] RECORD ERROR ${id}: ${String(error.stderr || error.message).slice(0, 400)}`);
  }
}
console.log(`[driver] DONE at ${new Date().toISOString()}`);
