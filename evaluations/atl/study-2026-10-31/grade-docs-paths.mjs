import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: node grade-docs-paths.mjs <candidate-workspace>');
const docPath = path.join(workspace, 'docs/mock-system-e2e-2026-10-29.md');
const text = fs.readFileSync(docPath, 'utf8');

// The six local artifacts the operators must still be able to read as literal paths.
const requiredLocalPaths = [
  '../.atl-evidence/mock-regression/aggregate-2026-10-29.json',
  '../.atl-evidence/mock-regression/aggregate-2026-10-29.md',
  '../.atl-evidence/full-operation/2026-10-29/report.json',
  '../.atl-evidence/mock-regression/non-js-checks-2026-10-29.json',
  '../.atl-evidence/issue-overnight/2026-10-29T16-49-20-172Z.json',
  '../.atl-evidence/issue-sources/sources-desktop.png',
  '../.atl-evidence/issue-sources/sources-mobile.png',
];
for (const localPath of requiredLocalPaths) {
  assert.ok(text.includes(localPath), `local evidence path stays visible to operators: ${localPath}`);
}

// No local .atl-evidence path may remain a Markdown hyperlink.
const linkTargets = [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map(match => match[1]);
const evidenceLinks = linkTargets.filter(target => target.includes('.atl-evidence'));
assert.deepEqual(evidenceLinks, [], `no .atl-evidence path is a Markdown link (found: ${evidenceLinks.join(', ')})`);

// Each required path must appear inside a code span (backticks), so operators can copy it.
const codeSpans = [...text.matchAll(/`([^`\n]+)`/g)].map(match => match[1]);
for (const localPath of requiredLocalPaths) {
  assert.ok(codeSpans.some(span => span.includes(localPath)), `local evidence path is quoted as code text: ${localPath}`);
}

console.log('PASS: local evidence paths are visible code text, none is a Markdown link, public links remain links');
