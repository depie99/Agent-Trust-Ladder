// Throwaway: exhaustive CJK + Arabic-script scan over the whole repo, and
// live-site probe of the pages the user might have open.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const ARABIC = /[\u0600-\u06FF]/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'diagrams']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name)); continue; }
    if (/\.(html|css|js|mjs|json|md|svg|cmd|ps1|py)$/.test(e.name)) yield path.join(dir, e.name);
  }
}

const cjkHits = [], faHits = [];
for (const base of ['docs', 'runtime', 'config', 'skills', 'verification', 'scripts', 'problems']) {
  if (!fs.existsSync(base)) continue;
  for (const f of walk(base)) {
    let s;
    try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (CJK.test(s)) cjkHits.push(f);
    // Persian only in user-facing chrome (docs pages + control plane), not prompts/skills which may legitimately carry Persian
    if (ARABIC.test(s) && (f.startsWith('docs/') || f.startsWith('runtime/control-plane'))) faHits.push(f);
  }
}
console.log('CJK files:', cjkHits.length ? cjkHits.join(', ') : 'NONE');
console.log('Arabic-script in docs/control-plane:', faHits.length ? faHits.join(', ') : 'NONE');

console.log('--- origin sync state ---');
console.log(execSync('git fetch origin 2>&1 && git status --short --branch | findstr /b "##"').toString());
console.log('--- origin/main recent ---');
console.log(execSync('git log origin/main --oneline -4').toString());
