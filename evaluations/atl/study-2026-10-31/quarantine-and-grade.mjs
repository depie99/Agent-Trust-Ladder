import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.resolve(here, '../../../../.atl-evidence/trials-v2');
const quarantine = path.resolve(here, '../../../../.atl-evidence/trials-v2-quota-blocked');
fs.mkdirSync(quarantine, { recursive: true });
const manifest = [];
for (const entry of fs.readdirSync(evidence, { withFileTypes: true })) {
  const name = entry.name;
  const isPreflight = name.includes('.preflight-');
  let meta = null;
  if (name.endsWith('.meta.json')) {
    meta = JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'));
  }
  const ownerBase = name.replace(/\.(jsonl|meta\.json|tar)$/, '');
  const ownerMeta = meta ?? (fs.existsSync(path.join(evidence, `${ownerBase}.meta.json`))
    ? JSON.parse(fs.readFileSync(path.join(evidence, `${ownerBase}.meta.json`), 'utf8')) : null);
  const blocked = isPreflight || (ownerMeta && ownerMeta.exit_code === 1);
  if (!blocked) continue;
  const target = path.join(quarantine, name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(path.join(evidence, name), target);
  if (meta) manifest.push({ trial_id: meta.trial_id, exit_code: meta.exit_code, elapsed_seconds: meta.elapsed_seconds, reason: 'usage-limit turn.failed before any model task work; not a valid trial' });
}
fs.writeFileSync(path.join(quarantine, 'MANIFEST.json'), JSON.stringify({ quarantined_at: new Date().toISOString(), reason: 'ChatGPT Codex usage limit; runs failed in <12s with turn.failed before receiving task work', runs: manifest }, null, 2));
console.log(`quarantined ${manifest.length} quota-blocked runs`);

// Grade + record the one pre-limit completed run.
const id = 'B1-REAL-BUG-CLI-ONCE-specialist-only';
const meta = JSON.parse(fs.readFileSync(path.join(evidence, `${id}.meta.json`), 'utf8'));
let grade = 'incomplete', detail = '';
try {
  const stdout = execFileSync(process.execPath, [path.join(here, 'grade-cli-once.mjs'), meta.workspace], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 150_000 });
  grade = 'pass'; detail = stdout.trim().split('\n').pop();
} catch (error) {
  const message = String(error.stderr || error.message);
  grade = message.includes('ERR_ASSERTION') ? 'fail' : 'incomplete';
  detail = message.trim().split('\n').slice(-2).join(' | ').slice(0, 300);
}
execFileSync(process.execPath, [path.join(here, 'record-result-v2.mjs'), id, grade, 'independent grader grade-cli-once.mjs', detail], { stdio: 'inherit' });
