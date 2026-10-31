import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: grade3-docs.mjs <workspace>');
const readme = fs.readFileSync(path.join(workspace, 'README.md'), 'utf8');

// Extract shell commands the README tells operators to run.
const commands = [];
for (const match of readme.matchAll(/```(?:sh|bash|shell|console)?\n([^`]*)```/g)) {
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim().replace(/^[$>]\s*/, '');
    if (trimmed.startsWith('node app.mjs')) commands.push(trimmed);
  }
}
for (const match of readme.matchAll(/^\s{4,}(node app\.mjs[^\n]*)$/gm)) {
  commands.push(match[1].trim());
}
assert.ok(commands.length >= 2, `README documents at least two CLI commands (found ${commands.length})`);

// Substitute documented placeholders with valid sample values, then run the
// documented commands sequentially in one fresh directory (in documented order,
// so a data-creating command listed before a consuming one works).
const sample = token => ({
  '<payer>': 'Ana', '<amount>': '10', '<person...>': 'Ana Ben',
  '<expense-id>': 'e1', '<id>': 'e1', '[person...]': 'Ana Ben',
})[token] ?? 'Ana';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillbench-docs-'));
try {
  for (const command of commands) {
    const argv = command.replace(/^node app\.mjs\s*/, '').split(/\s+/).map(word => /^[(<[]/.test(word) ? sample(word) : word);
    try {
      execFileSync(process.execPath, [path.join(workspace, 'app.mjs'), ...argv], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
      });
    } catch (error) {
      const stderr = String(error.stderr || error.message).slice(0, 160);
      assert.fail(`documented command fails against the real CLI: "${command}" (as: ${argv.join(' ')}) -> ${stderr}`);
    }
  }
  console.log(`PASS: all ${commands.length} documented CLI commands run successfully against the real CLI`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
