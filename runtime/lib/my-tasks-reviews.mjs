import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readMyTasksStore } from './my-tasks.mjs';
import { supervisorSnapshot } from './supervisor.mjs';
import { loadState } from './state.mjs';

export const REVIEW_VERSION = 'my-tasks-review-2';
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const language = value => value === 'fa-IR' ? 'fa-IR' : 'en-US';
const home = root => path.join(root, '.trust', 'manager', 'my-tasks');
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
const freshBook = () => ({ version: 1, locale: 'en-US', entries: {}, jobs: [], paused: null });
const slot = (key, locale) => hash([key, locale]);
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
const safeFile = name => !/(^|[/\\])(node_modules|vendor|dist|\.git|\.trust|\.agents|\.claude|\.codex|\.zcode|skills)([/\\]|$)|(^|[/\\])(AGENTS|CLAUDE|SKILL)\.md$|(^|[/\\])\.env|secret|credential|private.?key|\.lock$/i.test(name) && /\.(m?[jt]sx?|[cm]js|py|cs|go|rs|java|php|rb|vue|svelte|sql|html|scss|css|md|json|ya?ml)$/i.test(name);

export function resolveReviewRepositories(item, bindings, imported = []) {
  const override = bindings.items?.[item.key];
  if (override) return override;
  const exact = imported.find(task => task.source?.type === (item.source || 'azure') && String(task.source?.url || '').replace(/\/$/, '').toLowerCase() === String(item.url).replace(/\/$/, '').toLowerCase());
  if (exact) {
    const ids = exact.repository_ids || (exact.repository_id ? [exact.repository_id] : []);
    if (ids.length) return ids;
  }
  const rules = (bindings.rules || []).filter(rule => rule.connection === item.connection && rule.project === item.project && (!rule.area || item.area_path === rule.area || item.area_path?.startsWith(rule.area + '\\')));
  rules.sort((a, b) => (b.area?.length || 0) - (a.area?.length || 0));
  return rules[0]?.repository_ids || [];
}

function snapshot(repository) {
  try {
    const root = fs.realpathSync(repository.root);
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    const files = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    const status = git(root, ['status', '--porcelain=v1', '-z']);
    // Hash actual dirty/untracked bytes, including same-size edits with an unchanged mtime.
    const changes = status.split('\0').filter(Boolean).map(entry => entry.length > 3 && /^[ MARCUD?!]{2} /.test(entry) ? entry.slice(3) : entry);
    const dirty = changes.map(name => {
      try {
        const file = fs.realpathSync(path.join(root, name));
        if (!file.startsWith(root + path.sep)) return [name, 'outside'];
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return [name, stat.size, stat.mtimeMs];
        return [name, hash(fs.readFileSync(file).toString('base64'))];
      } catch { return [name, 'missing']; }
    });
    return { id: repository.id, name: repository.name, root, head, fingerprint: hash([head, status, dirty]), files: files.filter(safeFile).slice(0, 4000) };
  } catch { return { id: repository.id, name: repository.name, fingerprint: 'unavailable', error: 'Repository is missing or is not a readable Git repository.' }; }
}

function collectEvidence(item, repositories) {
  const words = [...new Set(`${item.title} ${item.area_path || ''} ${item.description_text || ''}`.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || [])].filter(w => !['the', 'and', 'this', 'that', 'with', 'task', 'item', 'برای', 'شده'].includes(w)).slice(0, 24);
  const evidence = [];
  for (const repo of repositories) {
    if (repo.error) continue;
    const ranked = repo.files.map(name => ({ name, score: words.reduce((sum, word) => sum + (name.toLowerCase().includes(word) ? 5 : 0), /readme|package\.json/i.test(name) ? 1 : 0) })).sort((a, b) => b.score - a.score);
    let size = 0;
    for (const candidate of ranked.slice(0, 160)) {
      try {
        const file = fs.realpathSync(path.join(repo.root, candidate.name));
        if (!file.startsWith(repo.root + path.sep) || fs.statSync(file).size > 100000) continue;
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        const match = lines.findIndex(line => words.some(word => line.toLowerCase().includes(word)));
        if (!candidate.score && match < 0) continue;
        const start = Math.max(0, match - 8), end = Math.min(lines.length, start + 65);
        const excerpt = lines.slice(start, end).join('\n').replace(/((?:api[_-]?key|password|access[_-]?token|secret)\s*[=:]\s*["'])[^"'\r\n]+/gi, '$1[redacted]');
        if (size + excerpt.length > 18000 || evidence.filter(e => e.repository_id === repo.id).length >= 7) break;
        size += excerpt.length;
        evidence.push({ id: `e${evidence.length + 1}`, repository_id: repo.id, repository_name: repo.name, path: candidate.name, line: start + 1, end_line: end, excerpt, snapshot: repo.fingerprint });
      } catch { /* unreadable file is not evidence */ }
    }
  }
  return evidence;
}

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');
function reviewSkills() {
  return ['atl-frame', 'atl-audit', 'atl-diagrams'].map(name => {
    try { const text = fs.readFileSync(path.join(skillRoot, name, 'SKILL.md'), 'utf8'); return { name, version: hash(text), checklist: text.slice(0, 7500) }; }
    catch { return { name, version: 'unavailable', checklist: 'Use evidence, separate observed facts from proposals, report missing context.' }; }
  });
}

export function validateReview(output, evidence) {
  const text = (value, max, required = false) => {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid review text.');
    return value.trim();
  };
  const ids = new Set(evidence.map(e => e.id));
  const refs = value => {
    if (!Array.isArray(value) || value.some(id => !ids.has(id))) throw new Error('Review cites evidence that was not read.');
    return [...new Set(value)];
  };
  if (!Array.isArray(output.findings) || output.findings.length > 3 || !Array.isArray(output.checks) || output.checks.length > 3) throw new Error('Review must stay short.');
  const nodes = output.diagram?.nodes;
  if (!Array.isArray(nodes) || nodes.length < 3 || nodes.length > 7) throw new Error('Diagram needs 3–7 nodes.');
  const nodesOut = nodes.map((n, index) => {
    if (!['observed', 'proposed', 'unknown'].includes(n.kind)) throw new Error('Invalid diagram evidence category.');
    const evidence_ids = refs(n.evidence_ids || []);
    if (n.kind === 'observed' && !evidence_ids.length) throw new Error('Observed diagram nodes require code evidence.');
    return { id: `n${index}`, label: text(n.label, 100, true), kind: n.kind, evidence_ids };
  });
  const edges = output.diagram.edges;
  if (!Array.isArray(edges) || edges.length > 10 || edges.some(e => !Number.isInteger(e.from) || !Number.isInteger(e.to) || e.from < 0 || e.to < 0 || e.from >= nodes.length || e.to >= nodes.length)) throw new Error('Invalid diagram edges.');
  return { brief: text(output.brief, 220, true), summary: text(output.summary, 650, true), expected: text(output.expected, 350, true), next_step: text(output.next_step || '', 350), ambiguity: text(output.ambiguity || '', 350), findings: output.findings.map(f => ({ text: text(f.text, 500, true), evidence_ids: refs(f.evidence_ids || []) })), checks: output.checks.map(c => text(c, 300, true)), diagram: { nodes: nodesOut, edges } };
}

export function reviewMermaid(diagram, locale = 'en-US') {
  const labels = locale === 'fa-IR' ? { observed: 'مشاهده‌شده', proposed: 'پیشنهادی', unknown: 'نامشخص' } : { observed: 'Observed', proposed: 'Proposed', unknown: 'Unknown' };
  const escape = value => String(value).replace(/[&<>"\[\]{}|`\r\n]/g, char => `#${char.charCodeAt(0)};`);
  const label = node => String(node.label).replace(/^(?:(?:Observed|Proposed|Unknown|مشاهده‌شده|پیشنهادی|نامشخص)\s*:\s*)+/iu, '');
  return ['flowchart TB', ...diagram.nodes.map(n => `${n.id}["${escape(labels[n.kind] + ': ' + label(n))}"]:::${n.kind}`), ...diagram.edges.map(e => `n${e.from} --> n${e.to}`), 'classDef observed fill:#e4f2ec,stroke:#197653,color:#123d2d', 'classDef proposed fill:#e8eefb,stroke:#496eb2,color:#233758', 'classDef unknown fill:#fff4de,stroke:#997119,color:#543d0d,stroke-dasharray:5 4'].join('\n');
}

export function createMyTasksReviews(root, { invoke, getItems = null, registry = () => supervisorSnapshot().projects, imported = () => { try { return Object.values(loadState(root).tasks || {}); } catch { return []; } }, canRun = () => true, now = () => Date.now(), intervalMs = 15000, retryMs = 60000 } = {}) {
  const file = path.join(home(root), 'reviews.json'), bindingFile = path.join(home(root), 'repository-bindings.json');
  let timer, active = false, stopped = false;
  const book = () => read(file, freshBook());
  const bindings = () => read(bindingFile, { version: 1, rules: [], items: {} });
  const items = () => getItems ? getItems() : Object.values(readMyTasksStore(root).records);
  const skills = reviewSkills();
  function contexts(records) {
    const map = new Map(registry().map(r => [r.id, r])), cache = new Map(), links = bindings(), imports = imported();
    return records.map(item => {
      const repositories = resolveReviewRepositories(item, links, imports).map(id => {
        if (!cache.has(id)) cache.set(id, map.has(id) ? snapshot(map.get(id)) : { id, name: id, fingerprint: 'unavailable', error: 'Repository is no longer registered.' });
        return cache.get(id);
      });
      return { item, repositories, fingerprint: hash([REVIEW_VERSION, item.key, item.rev, item.title, item.description_text, item.acceptance_criteria, item.state_category, repositories.map(r => [r.id, r.fingerprint]), skills.map(s => s.version)]) };
    });
  }
  function ensure(locale, { retryKey = null, resume = false } = {}) {
    const data = book();
    data.locale = language(locale || data.locale);
    const records = items(), keys = new Set(records.map(i => i.key));
    data.jobs = data.jobs.filter(j => keys.has(j.key));
    for (const context of contexts(records)) {
      const id = slot(context.item.key, data.locale), old = data.entries[id];
      if (old?.fingerprint === context.fingerprint && old.status === 'ready' && retryKey !== context.item.key) continue;
      if (old?.fingerprint === context.fingerprint && old.status === 'failed' && retryKey !== context.item.key) continue;
      const job = data.jobs.find(j => j.id === id);
      if (job?.fingerprint === context.fingerprint && retryKey !== context.item.key) continue;
      data.jobs = data.jobs.filter(j => j.id !== id);
      data.jobs.push({ id, key: context.item.key, locale: data.locale, fingerprint: context.fingerprint, attempts: 0, due: now(), priority: { inprogress: 0, proposed: 1, complete: 2 }[context.item.state_category] ?? 1, item_priority: context.item.priority ?? 99, changed: context.item.changed_at || '' });
      data.entries[id] = { ...old, key: context.item.key, locale: data.locale, fingerprint: context.fingerprint, status: old?.result ? 'stale' : 'queued', error: null };
    }
    if (retryKey || resume) data.paused = null;
    data.jobs.sort((a, b) => a.priority - b.priority || a.item_priority - b.item_priority || b.changed.localeCompare(a.changed));
    write(file, data);
    return status(data.locale);
  }
  function status(locale = book().locale) {
    const data = book(), records = items(), entries = records.map(item => data.entries[slot(item.key, language(locale))]);
    return { locale: language(locale), total: records.length, ready: entries.filter(e => e?.status === 'ready').length, queued: data.jobs.filter(j => j.locale === language(locale)).length, failed: entries.filter(e => e?.status === 'failed').length, running: active, paused: data.paused };
  }
  function get(key, locale = book().locale) {
    const data = book(), entry = data.entries[slot(key, language(locale))];
    const previous = Object.values(data.entries).filter(e => e.key === key && e.locale !== language(locale) && e.result).map(e => ({ locale: e.locale, generated_at: e.generated_at }));
    return { ...(entry || { key, locale: language(locale), status: 'queued' }), previous, mermaid: entry?.result ? reviewMermaid(entry.result.diagram, entry.locale) : null };
  }
  async function tick() {
    if (active || stopped || !canRun()) return;
    const data = book();
    if (data.paused) return;
    const job = data.jobs.find(j => j.due <= now());
    if (!job) return;
    const lockFile = path.join(home(root), 'review-worker.lock');
    try {
      if (fs.existsSync(lockFile)) {
        const pid = Number(fs.readFileSync(lockFile, 'utf8'));
        let alive = false;
        if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch { /* old host died */ } }
        if (alive) return;
        fs.rmSync(lockFile, { force: true });
      }
      fs.mkdirSync(home(root), { recursive: true });
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    } catch { return; }
    active = true;
    try {
      const item = items().find(i => i.key === job.key);
      if (!item) { const latest = book(); latest.jobs = latest.jobs.filter(j => j.id !== job.id); write(file, latest); return; }
      const context = contexts([item])[0];
      if (context.fingerprint !== job.fingerprint) { ensure(job.locale); return; }
      const evidence = collectEvidence(item, context.repositories);
      const response = await invoke({ item, locale: job.locale, validation_feedback: job.feedback || null, repositories: context.repositories.map(({ root: _, files: __, ...r }) => r), evidence, skills, timeoutMs: 180000, logPath: path.join(home(root), 'review-runs', `${job.id}-${job.fingerprint.slice(0, 12)}.log`) });
      if (response.code && response.code !== 0) throw Object.assign(new Error('Review provider could not complete the request.'), { providerFailure: response.providerFailure });
      let output = response.result || response.text || response.stdout || response;
      if (typeof output === 'string') output = JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
      const result = validateReview(output, evidence);
      if (stopped) return;
      const currentItem = items().find(i => i.key === job.key);
      if (!currentItem || contexts([currentItem])[0].fingerprint !== job.fingerprint) { ensure(job.locale); return; }
      const latest = book(), current = latest.jobs.find(j => j.id === job.id);
      if (current?.fingerprint !== job.fingerprint) return;
      latest.entries[job.id] = { key: job.key, locale: job.locale, fingerprint: job.fingerprint, status: 'ready', result, evidence, repositories: context.repositories.map(({ root: _, files: __, ...r }) => r), coverage: evidence.length ? 'code' : 'task-only', source_revision: item.rev, generated_at: new Date(now()).toISOString(), provider: response.provider || null, model: response.model || null, skills: skills.map(({ checklist, ...s }) => s) };
      latest.jobs = latest.jobs.filter(j => j.id !== job.id);
      write(file, latest);
    } catch (error) {
      if (stopped) return;
      const latest = book(), current = latest.jobs.find(j => j.id === job.id);
      if (current?.fingerprint !== job.fingerprint) return;
      current.attempts++;
      if (/^Invalid |^Review |^Observed |^Diagram /.test(error.message)) current.feedback = error.message;
      const blocked = error.code === 'REVIEW_PROVIDER_UNAVAILABLE' || /auth|quota|budget|limit|sign.in|not installed|not configured|model.*ceiling/i.test(error.message) || error.providerFailure;
      // Surface a safe action rather than raw provider output (which may contain credentials).
      const message = blocked ? 'Review provider needs attention in Settings. Saved tasks remain available.' : 'Review could not be generated. Retry this review.';
      latest.entries[job.id].error = message;
      if (blocked) { latest.paused = { reason: 'provider', message }; }
      else if (current.attempts < 2) current.due = now() + retryMs;
      else { latest.entries[job.id].status = 'failed'; latest.jobs = latest.jobs.filter(j => j.id !== job.id); }
      write(file, latest);
    } finally {
      active = false;
      try { fs.rmSync(lockFile, { force: true }); } catch { /* host shutdown */ }
      if (!stopped) { const next = setTimeout(() => { void tick(); }, 0); next.unref?.(); }
    }
  }
  return {
    ensure, status, get, tick, bindings,
    decorate(records, locale) { const data = book(), lang = language(locale || data.locale); return records.map(item => { const entry = data.entries[slot(item.key, lang)]; return { ...item, brief: entry?.result?.brief || null, review_status: entry?.status || 'queued', review_version: entry?.fingerprint || null }; }); },
    saveBindings(value) {
      const ids = new Set(registry().map(r => r.id));
      const validateIds = list => { if (!Array.isArray(list) || list.length > 10 || list.some(id => !ids.has(id))) throw new Error('Choose registered repositories.'); return [...new Set(list)]; };
      if (!Array.isArray(value.rules) || value.rules.length > 200 || !value.items || typeof value.items !== 'object' || Array.isArray(value.items)) throw new Error('Invalid repository bindings.');
      const rules = value.rules.map(rule => { if (typeof rule.connection !== 'string' || typeof rule.project !== 'string' || typeof (rule.area || '') !== 'string') throw new Error('Invalid binding rule.'); return { connection: rule.connection, project: rule.project, area: rule.area || '', repository_ids: validateIds(rule.repository_ids) }; });
      const overrides = Object.fromEntries(Object.entries(value.items).map(([key, list]) => [key, validateIds(list)]));
      write(bindingFile, { version: 1, rules, items: overrides }); ensure(); return bindings();
    },
    start() { if (timer) return; stopped = false; ensure(); timer = setInterval(() => { try { ensure(); void tick(); } catch { /* next interval retries disk/context reads */ } }, intervalMs); timer.unref?.(); void tick(); },
    stop() { stopped = true; clearInterval(timer); timer = null; },
  };
}
