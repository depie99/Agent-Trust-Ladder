import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeGitHubRepo } from './intake.mjs';

const fileFor = root => path.join(root, '.trust', 'manager', 'issue-connections.json');
const providers = new Set(['github', 'jira', 'azure']);
const clean = value => String(value || '').trim();
const identity = c => `${c.provider}:${c.provider === 'github' ? c.settings.repo.toLowerCase() : c.provider === 'jira' ? `${c.settings.base_url.toLowerCase()}/${c.settings.projects.join(',')}` : `${c.settings.org_url.toLowerCase()}/${c.settings.project.toLowerCase()}`}`;

export function validateConnection(payload) {
  const provider = clean(payload.provider);
  if (!providers.has(provider)) throw new Error('Choose GitHub, Jira, or Azure Boards.');
  const name = clean(payload.name);
  if (!name || name.length > 100) throw new Error('Enter a connection name (up to 100 characters).');
  let settings;
  if (provider === 'github') {
    const repo = normalizeGitHubRepo(clean(payload.repo));
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Enter one GitHub repository as owner/name or a repository URL.');
    settings = { repo };
  } else {
    const base = new URL(clean(provider === 'jira' ? payload.base_url : payload.org_url));
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Enter a plain HTTPS URL without credentials or query parameters.');
    if (provider === 'jira') {
      const projects = [...new Set(clean(payload.projects).split(/[\s,]+/).map(s => s.toUpperCase()).filter(Boolean))];
      if (!projects.length || projects.length > 20 || projects.some(p => !/^[A-Z][A-Z0-9_]{1,19}$/.test(p))) throw new Error('Enter 1–20 Jira project keys.');
      settings = { base_url: base.href.replace(/\/$/, ''), projects };
    } else {
      const project = clean(payload.project);
      if (!project || project.length > 128 || /[\\/\r\n]/.test(project) || /\/_workitems|\/_sprints/i.test(base.pathname)) throw new Error('Enter an Azure collection URL and project.');
      settings = { org_url: base.href.replace(/\/$/, ''), project, iteration_path: clean(payload.iteration_path) };
    }
  }
  const token_env = clean(payload.token_env || (provider === 'jira' ? 'JIRA_TOKEN' : 'AZDO_PAT'));
  if (provider !== 'github' && !/^[A-Z_][A-Z0-9_]*$/.test(token_env)) throw new Error('Choose a valid token environment variable name.');
  if (provider !== 'github') settings.token_env = token_env;
  return { provider, name, settings, enabled: payload.enabled !== false };
}

function fromLegacy(provider, cfg) {
  if (provider === 'github') return (cfg.repos || []).map(repo => ({ provider, name: repo, repo, enabled: Boolean(cfg.enabled) }));
  if (provider === 'jira' && cfg.base_url && cfg.projects?.length) return [{ provider, name: cfg.projects.join(', '), base_url: cfg.base_url, projects: cfg.projects.join(','), token_env: cfg.token_env, enabled: Boolean(cfg.enabled) }];
  if (provider === 'azure' && cfg.org_url && cfg.project) return [{ provider, name: `${cfg.project} (Azure Boards)`, org_url: cfg.org_url, project: cfg.project, iteration_path: cfg.iteration_path, token_env: cfg.token_env, enabled: Boolean(cfg.enabled) }];
  return [];
}

export function loadConnections(root, legacy = {}) {
  const file = fileFor(root);
  let data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, revision: 0, connections: [], defaults: {}, dismissed_legacy: [] };
  data.dismissed_legacy ||= [];
  let changed = !fs.existsSync(file);
  for (const provider of providers) {
    for (const candidate of fromLegacy(provider, legacy[provider] || {})) {
      let parsed; try { parsed = validateConnection(candidate); } catch { continue; }
      if (!data.dismissed_legacy.includes(identity(parsed)) && !data.connections.some(c => identity(c) === identity(parsed))) {
        const record = { id: crypto.randomUUID(), ...parsed, status: 'unchecked', checked_at: null, legacy: true };
        data.connections.push(record);
        data.defaults[provider] ||= record.id;
        changed = true;
      }
    }
  }
  if (changed) saveConnections(root, data, data.revision);
  return data;
}

export function saveConnections(root, data, expectedRevision) {
  const file = fileFor(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let handle;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { handle = fs.openSync(lock, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.rmSync(lock); } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  if (handle == null) { const error = new Error('Connections are busy. Try again.'); error.status = 409; throw error; }
  try {
    const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { revision: 0 };
    if (current.revision !== expectedRevision) { const error = new Error('Connections changed. Refresh and try again.'); error.status = 409; throw error; }
    data.revision = expectedRevision + 1;
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temp, file);
    return data;
  } finally { fs.closeSync(handle); fs.rmSync(lock, { force: true }); }
}

export const sameConnection = (a, b) => identity(a) === identity(b);
export const connectionIdentity = identity;
