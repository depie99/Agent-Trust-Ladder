import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const prereg = JSON.parse(fs.readFileSync(path.join(here, 'preregistration.json'), 'utf8'));
const schedule = JSON.parse(fs.readFileSync(path.join(here, 'schedule.json'), 'utf8'));
const trialId = process.argv[2];
if (!trialId) throw new Error('Usage: node run-trial.mjs <trial_id>');
const trial = schedule.trials.find(row => row.trial_id === trialId);
if (!trial) throw new Error(`Unknown trial: ${trialId}`);
const testCase = prereg.cases.find(row => row.id === trial.case_id);
const condition = prereg.conditions[trial.condition];

const evidence = path.resolve(repo, '../.atl-evidence/trials');
fs.mkdirSync(evidence, { recursive: true });
const workspace = path.join(evidence, trialId);
const archive = path.join(evidence, `${trialId}.tar`);
const rawPath = path.join(evidence, `${trialId}.jsonl`);
const metadataPath = path.join(evidence, `${trialId}.meta.json`);
if (fs.existsSync(workspace) || fs.existsSync(rawPath) || fs.existsSync(metadataPath)) {
  throw new Error(`Refusing duplicate trial artifacts for ${trialId}`);
}

const revision = testCase.base_revision;
const git = (args, opts = {}) => new Promise((resolve, reject) => {
  const child = spawn('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(stderr) : reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr}`)));
});
const rev = (await new Promise((resolve, reject) => {
  const child = spawn('git', ['rev-parse', revision], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
}));
await git(['archive', '--format=tar', `--output=${archive}`, rev]);
fs.mkdirSync(workspace, { recursive: false });
await new Promise((resolve, reject) => {
  const child = spawn('tar', ['-xf', archive, '-C', workspace], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`tar failed (${code}): ${stderr}`)));
});
fs.rmSync(path.join(workspace, '.trust'), { recursive: true, force: true });

let skillText = '';
if (trial.condition === 'specialist-only') {
  const relative = testCase.specialist.skill === 'atl-ui-review'
    ? path.join(repo, 'skills/atl-ui-review/SKILL.md')
    : testCase.specialist.skill === 'skills/technical-writing'
      ? path.resolve(repo, '../.atl-evidence/cursor-plugins/pstack/skills/technical-writing/SKILL.md')
      : path.resolve(repo, `../.atl-evidence/mattpocock-skills/skills/${testCase.specialist.skill}/SKILL.md`);
  skillText = `\n\nFollow this one specialist skill only (verbatim snapshot):\n<skill>\n${fs.readFileSync(relative, 'utf8')}\n</skill>`;
}
if (trial.condition === 'atl') {
  skillText = `\n\nUse the ATL workflow router at skills/atl/SKILL.md and its applicable specialist. Follow progressive disclosure; do not load unrelated skill bodies.`;
}
const prompt = `${testCase.prompt}\n\nWork directly in this repository. Implement the smallest appropriate change and run relevant verification. Do not ask the user questions; state reasonable assumptions. Report changes and checks honestly.${skillText}`;
const model = prereg.model.slug;
const codexPath = process.env.ATL_CODEX_JS ?? path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js');
const raw = fs.createWriteStream(rawPath, { flags: 'wx' });
const started = Date.now();
const env = { ...process.env };
delete env.CODEX_SESSION_ID;
delete env.CODEX_THREAD_ID;
delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
const args = [codexPath, 'exec', '--skip-git-repo-check', '--ignore-user-config', '--json', '--ephemeral', '--sandbox', 'workspace-write', '-C', workspace, '--model', model, '-c', `model_reasoning_effort=${prereg.model.reasoning_effort}`, '-c', `service_tier=${prereg.model.service_tier}`, prompt];
const result = await new Promise(resolve => {
  const child = spawn(process.execPath, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(raw);
  child.stderr.pipe(raw);
  const timeout = setTimeout(() => child.kill('SIGTERM'), prereg.model.budget.wall_clock_seconds_per_trial * 1000);
  child.on('error', error => { clearTimeout(timeout); resolve({ code: null, signal: null, error: String(error) }); });
  child.on('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
});
await new Promise(resolve => raw.end(resolve));
const meta = {
  study_id: prereg.study_id, trial_id: trialId, case_id: trial.case_id, condition: trial.condition,
  model, reasoning_effort: prereg.model.reasoning_effort, service_tier: prereg.model.service_tier,
  revision: rev, workspace, raw_output: rawPath, exit_code: result.code, signal: result.signal,
  launch_error: result.error ?? null, elapsed_seconds: (Date.now() - started) / 1000,
};
fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(meta, null, 2));
