// Throwaway: scan the INSTALLED ATL runtime for CJK + list what differs from repo.
import fs from 'node:fs';
import path from 'node:path';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const FA = /[\u0600-\u06FF]/;
const base = 'C:/Users/Sanaz/.atl/runtime';

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) yield* walk(path.join(dir, e.name)); continue; }
    if (/\.(html|css|js|mjs|json|md|svg)$/.test(e.name)) yield path.join(dir, e.name);
  }
}

const cjk = [], fa = [];
for (const f of walk(base)) {
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (CJK.test(s)) {
    cjk.push(f);
    const i = s.search(CJK);
    console.log('CJK:', f);
    console.log('   ', s.slice(Math.max(0, i - 100), i + 120).replace(/\n/g, ' '));
  } else if (FA.test(s) && /control-plane/.test(f)) {
    fa.push(f);
  }
}
console.log('\nCJK files:', cjk.length, '| CP files with Persian:', fa.join(', ') || 'none');
