import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prereg = JSON.parse(fs.readFileSync(path.join(here, 'preregistration-v3.json'), 'utf8'));
const schedule = JSON.parse(fs.readFileSync(path.join(here, 'schedule-v3.json'), 'utf8'));
const trialId = process.argv[2];
if (!trialId) throw new Error('Usage: node prep-trial-v3.mjs <trial_id>');
const trial = schedule.trials.find(row => row.trial_id === trialId);
if (!trial) throw new Error(`Unknown trial: ${trialId}`);
const testCase = prereg.cases.find(row => row.id === trial.case_id);

const evidence = path.resolve(here, '../../../../.atl-evidence/skillbench-trials');
fs.mkdirSync(evidence, { recursive: true });
const workspace = path.join(evidence, trialId);
const promptPath = path.join(evidence, `${trialId}.prompt.txt`);
const metaPath = path.join(evidence, `${trialId}.meta.json`);
if (fs.existsSync(workspace) || fs.existsSync(promptPath) || fs.existsSync(metaPath)) {
  throw new Error(`Refusing duplicate trial artifacts for ${trialId}`);
}
fs.cpSync(path.resolve(here, '../../../../.atl-evidence/skillbench-template'), workspace, { recursive: true });

let skillText = '';
if (trial.condition === 'specialist-only') {
  const relative = testCase.specialist.source === 'cursor/plugins/pstack'
    ? path.resolve(here, '../../../../.atl-evidence/cursor-plugins/pstack', testCase.specialist.skill.replace(/^skills\//, 'skills/'), 'SKILL.md')
    : path.resolve(here, '../../../../.atl-evidence/mattpocock-skills/skills', testCase.specialist.skill, 'SKILL.md');
  skillText = `\n\nFollow this one specialist skill only (verbatim snapshot):\n<skill>\n${fs.readFileSync(relative, 'utf8')}\n</skill>`;
}
if (trial.condition === 'atl') {
  const snapshot = path.resolve(here, '../../../../.atl-evidence/atl-skills-study-v2');
  for (const entry of fs.readdirSync(snapshot, { withFileTypes: true }).filter(item => item.name !== 'manifest.json')) {
    fs.cpSync(path.join(snapshot, entry.name), path.join(workspace, 'skills', entry.name), { recursive: true });
  }
  skillText = `\n\nAn ATL skills bundle is installed at <workspace>/skills/. Enter through the workflow router at skills/atl/SKILL.md and use its applicable specialist. Follow progressive disclosure; do not load unrelated skill bodies.`;
}
const prompt = `You are working in the repository at ${workspace} (treat it as the project root).\n\nTask: ${testCase.prompt}\n\nWork directly in that repository. Implement the smallest appropriate change and run the relevant verification yourself. Do not ask the user questions; state reasonable assumptions. Report the files you changed and the checks you ran honestly. Do not modify anything outside that repository.${skillText}`;
fs.writeFileSync(promptPath, prompt, 'utf8');
const meta = {
  study_id: prereg.study_id, trial_id: trialId, case_id: trial.case_id, condition: trial.condition,
  model: prereg.model.slug, workspace, prompt_path: promptPath,
  expected_paths: testCase.expected_paths, grader: testCase.grader,
  prepared_at: new Date().toISOString(),
};
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
console.log(metaPath);
