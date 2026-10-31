import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const source = path.join(repo, 'skills');
const destination = path.resolve(repo, '../.atl-evidence/atl-skills-study-v31');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
const entries = fs.readdirSync(source, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && (entry.name === 'atl' || entry.name.startsWith('atl-')))
  .sort((a, b) => a.name.localeCompare(b.name));
const files = [];
for (const entry of entries) {
  const from = path.join(source, entry.name);
  const to = path.join(destination, entry.name);
  fs.cpSync(from, to, { recursive: true });
  const collect = dir => {
    for (const child of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, child.name);
      if (child.isDirectory()) collect(absolute);
      else files.push({ path: path.relative(destination, absolute).replaceAll(path.sep, '/'), sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') });
    }
  };
  collect(to);
}
const hash = createHash('sha256');
for (const file of files) hash.update(file.path).update('\0').update(file.sha256).update('\n');
const manifest = { source_root: 'skills/atl and skills/atl-* from Agent-Trust-Ladder working tree', snapshot_path: destination, sha256: hash.digest('hex'), files };
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ snapshot_path: destination, files: files.length, sha256: manifest.sha256 }, null, 2));

