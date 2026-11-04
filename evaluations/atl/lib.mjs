import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const routes = new Set(['direct', 'frame', 'specify', 'plan', 'implement', 'verify', 'audit', 'ui-review', 'formal-verification', 'tech-docs', 'content-quality', 'diagrams', 'trust']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');

// No keyword judge: structured fields are narrow routing proxies. Free-text
// rationale and actual authority/evidence compliance require trace review.
export function grade(cases, decisions) {
  if (!Array.isArray(cases) || !cases.length || new Set(cases.map(c => c.id)).size !== cases.length ||
      cases.some(c => typeof c.id !== 'string' || !c.id || typeof c.category !== 'string' ||
        !Array.isArray(c.routes) || !c.routes.length || c.routes.some(r => !routes.has(r)) ||
        !Array.isArray(c.verdicts) || !c.verdicts.length || c.verdicts.some(v => !['conditional', 'blocked'].includes(v)) ||
        !Array.isArray(c.doses) || !c.doses.length || c.doses.some(d => !['Direct', 'Standard', 'Critical'].includes(d)))) {
    throw new Error('Malformed or empty case set');
  }
  if (!Array.isArray(decisions)) throw new Error('Decisions must be an array');
  const expected = new Set(cases.map(c => c.id));
  const seen = new Set();
  for (const d of decisions) {
    if (!d || typeof d !== 'object') throw new Error('Malformed decision');
    if (!expected.has(d.id) || seen.has(d.id)) throw new Error(`Unknown or duplicate case: ${d.id}`);
    if (!routes.has(d.route) || !['Direct', 'Standard', 'Critical'].includes(d.dose) ||
        !['complete', 'conditional', 'blocked'].includes(d.verdict) ||
        !['next_action', 'reason'].every(k => typeof d[k] === 'string' && d[k].trim())) {
      throw new Error(`Malformed decision: ${d.id}`);
    }
    seen.add(d.id);
  }
  return cases.map(c => {
    const d = decisions.find(d => d.id === c.id);
    const checks = {
      route: Boolean(d && c.routes.includes(d.route)),
      dose: Boolean(d && c.doses.includes(d.dose)),
      // Every fixture explicitly has work/evidence pending.
      no_premature_completion: Boolean(d && d.verdict !== 'complete'),
      proportionate_status: Boolean(d && c.verdicts.includes(d.verdict)),
    };
    return { id: c.id, category: c.category, present: Boolean(d), checks,
      passed: Object.values(checks).every(Boolean) };
  });
}

export function compare(cases, baseline, candidate) {
  const a = grade(cases, baseline), b = grade(cases, candidate);
  const pairs = a.map((row, i) => ({ id: row.id, category: row.category,
    baseline: row.passed, atl: b[i].passed,
    outcome: row.passed === b[i].passed ? 'tie' : b[i].passed ? 'win' : 'loss' }));
  const rate = rows => rows.filter(r => r.passed).length / rows.length;
  return { sample_size: cases.length, baseline_pass_rate: rate(a), atl_pass_rate: rate(b),
    delta_percentage_points: (rate(b) - rate(a)) * 100,
    wins: pairs.filter(p => p.outcome === 'win').length,
    losses: pairs.filter(p => p.outcome === 'loss').length,
    ties: pairs.filter(p => p.outcome === 'tie').length,
    confidence: 'Descriptive only: one unblinded development-set trial per condition; no causal effect estimate.',
    baseline: a, atl: b, pairs };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

export function inventory(root) {
  const dir = path.join(root, 'skills');
  return fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'SKILL.md'))).sort().map(name => {
    const entry = fs.readFileSync(path.join(dir, name, 'SKILL.md'));
    const header = entry.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const declaredName = header?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = header?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    const markdown = walk(path.join(dir, name)).filter(f => f.endsWith('.md'));
    const broken = [];
    for (const file of markdown) {
      const text = fs.readFileSync(file, 'utf8');
      // Only explicit local Markdown links, never code examples or bare paths.
      for (const match of text.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        if (!fs.existsSync(path.resolve(path.dirname(file), target))) broken.push({
          file: path.relative(root, file).replaceAll('\\', '/'), target,
        });
      }
    }
    return { name, entry_bytes: entry.length, entry_sha256: sha256(entry),
      metadata_basic_valid: declaredName === name && Boolean(description),
      markdown_files: markdown.length, markdown_bytes: markdown.reduce((n, f) => n + fs.statSync(f).size, 0),
      broken_links: broken };
  });
}
