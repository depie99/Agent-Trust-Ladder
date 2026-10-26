// Throwaway: find CJK characters in user-facing surfaces.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

function scanFile(p) {
  const s = fs.readFileSync(p, 'utf8');
  const hits = [...s.matchAll(CJK)].map((m) => m[0]);
  if (hits.length) {
    console.log(p + ' :: ' + hits.length + ' CJK runs, sample: ' + hits.slice(0, 8).join(' | '));
    const i = s.search(CJK);
    console.log('   context: ' + s.slice(Math.max(0, i - 80), i + 80).replace(/\n/g, ' '));
  }
}

console.log('=== git HEAD files (committed state) ===');
for (const f of ['runtime/control-plane.html', 'runtime/control-plane-client.js', 'runtime/atl-manager.mjs', 'docs/brain.html', 'docs/team-interfaces.html']) {
  try { scanFile(f); } catch (e) {}
}
console.log('=== docs pages ===');
for (const f of fs.readdirSync('docs').filter((x) => x.endsWith('.html'))) scanFile('docs/' + f);
console.log('=== runtime libs ===');
for (const f of fs.readdirSync('runtime/lib').filter((x) => x.endsWith('.mjs') || x.endsWith('.js'))) scanFile('runtime/lib/' + f);

console.log('=== recent commits ===');
console.log(execSync('git log --oneline -6').toString());
console.log('=== client.js worktree diff (in-flight) ===');
console.log(execSync('git diff -- runtime/control-plane-client.js').toString().slice(0, 2000));
