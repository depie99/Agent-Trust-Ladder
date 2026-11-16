import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '../assets/jira-mcp-sdk.mjs';
import { protect } from './azure-connection.mjs';
import { sanitizeWorkItemHtml } from './my-tasks.mjs';

const endpoint = 'https://mcp.atlassian.com/v2/mcp?tools=all';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
function write(p, value) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + '.tmp', JSON.stringify(value), { mode: 0o600 }); fs.renameSync(p + '.tmp', p); }
export const jiraPlainText = value => typeof value === 'string' ? value : value && typeof value === 'object' ? [value.text, ...(value.content || []).map(jiraPlainText)].filter(Boolean).join('\n') : '';
export function normalizeJiraIssue(issue, site) {
  const f = issue.fields || {}, priority = f.priority || {}, project = f.project?.key || issue.key.split('-')[0];
  const category = { new: 'proposed', indeterminate: 'inprogress', done: 'complete' }[f.status?.statusCategory?.key] || 'proposed';
  const description = jiraPlainText(f.description);
  return { key: `jira|${site.id}|${issue.id}`, source: 'jira', connection: `jira:${site.id}`, project, id: issue.key, remote_id: issue.id, rev: f.updated, title: f.summary || issue.key, type: f.issuetype?.name || 'Task', state: f.status?.name || '', state_category: category, source_priority: { label: priority.name || null, rank: Number.isFinite(priority.rank) ? priority.rank : null }, priority: null, description_text: description, description_html: sanitizeWorkItemHtml(description.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')), acceptance_criteria: '', due_at: f.duedate || null, dependencies: (f.issuelinks || []).map(link => ({ type: link.type?.name, key: link.inwardIssue?.key || link.outwardIssue?.key })), tags: f.labels || [], area_path: [project, ...(f.components || []).map(c => c.name)].join('\\'), assignee_name: f.assignee?.displayName || null, changed_at: f.updated || null, url: `${site.url}/browse/${encodeURIComponent(issue.key)}` };
}
function unwrap(result) {
  if (result.isError) throw Error('Jira tool failed; check site permissions and reconnect if necessary.');
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  try { return JSON.parse(text); } catch { throw Error('Jira returned an unsupported response format.'); }
}
const toolNames = { sites: ['getAccessibleAtlassianResources'], projects: ['listJiraProjects', 'getVisibleJiraProjects'], search: ['searchJiraIssuesUsingJql'], issue: ['getJiraIssue'], comments: ['listJiraIssueComments', 'getJiraIssueComments'], transitions: ['listJiraIssueTransitions', 'getTransitionsForJiraIssue'], comment: ['addOrEditJiraIssueComment', 'addCommentToJiraIssue'], edit: ['editJiraIssue'], transition: ['transitionJiraIssue'] };
export function createJiraMcp(root, { transportCall, mcpEndpoint = endpoint, now = () => Date.now(), onSynced = () => {} } = {}) {
  const dir = path.join(root, '.trust/manager/my-tasks'), configFile = path.join(dir, 'jira-settings.json'), storeFile = path.join(dir, 'jira.json'), proposalsFile = path.join(dir, 'jira-proposals.json');
  const secretsFile = path.join(process.env.ATL_HOME || path.join(os.homedir(), '.atl'), 'connections', `jira-${hash(path.resolve(root))}.json`);
  let client, transport, connecting, tools = [], authState, authorizationUrl, secret, callbackUrl, syncing, timer, stopped = false;
  const config = () => ({ site: null, projects: [], enabled: false, interval_minutes: 15, ...read(configFile, {}) });
  const store = () => read(storeFile, { items: [], status: 'unconfigured' });
  async function loadSecret() { if (secret) return secret; const saved = read(secretsFile, null); secret = saved ? JSON.parse(saved.encrypted ? await protect(saved.encrypted, true) : saved.value) : {}; callbackUrl ||= secret.callbackUrl; return secret; }
  async function saveSecret() { const value = JSON.stringify(secret); write(secretsFile, process.platform === 'win32' ? { encrypted: await protect(value) } : { value }); }
  const provider = {
    get redirectUrl() { return callbackUrl; },
    get clientMetadata() { return { client_name: 'ATL Jira', redirect_uris: [callbackUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
    state() { authState = { value: crypto.randomBytes(32).toString('hex'), expires: now() + 600000 }; return authState.value; },
    async clientInformation() { return (await loadSecret()).client; },
    async saveClientInformation(value) { (await loadSecret()).client = value; await saveSecret(); },
    async tokens() { return (await loadSecret()).tokens; },
    async saveTokens(value) { (await loadSecret()).tokens = value; await saveSecret(); },
    redirectToAuthorization(url) { authorizationUrl = url.href; },
    saveCodeVerifier(value) { secret.verifier = value; },
    codeVerifier() { if (!secret?.verifier) throw Error('Jira authorization expired. Reconnect.'); return secret.verifier; },
    async invalidateCredentials(scope) { await loadSecret(); if (scope === 'all') secret = {}; else if (scope === 'tokens') delete secret.tokens; else if (scope === 'client') delete secret.client; else delete secret.verifier; await saveSecret(); }
  };
  async function connect() {
    if (connecting) return connecting;
    if (transportCall || client) return;
    connecting = (async () => {
      await loadSecret();
      client = new Client({ name: 'atl-jira', version: '1.0.0' });
      transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint), { authProvider: provider });
      try {
        await client.connect(transport); let cursor;
        do { const page = await client.listTools(cursor ? { cursor } : {}); tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
      } catch (error) { await client.close().catch(() => {}); client = null; throw error; }
    })().finally(() => { connecting = null; });
    return connecting;
  }
  async function call(operation, args = {}) {
    await connect();
    if (transportCall) return transportCall(operation, args);
    const tool = tools.find(t => toolNames[operation]?.includes(t.name));
    if (!tool) throw Error(`Jira capability unavailable: ${operation}`);
    const properties = tool.inputSchema?.properties;
    const parameters = properties ? Object.fromEntries(Object.entries(args).filter(([key]) => Object.hasOwn(properties, key))) : args;
    return unwrap(await client.callTool({ name: tool.name, arguments: parameters }, undefined, { timeout: 60000 }));
  }
  const scoped = args => { const cfg = config(); if (!cfg.site) throw Error('Choose a Jira site first.'); return { ...args, cloudId: cfg.site.id }; };
  async function sync() {
    if (syncing) return syncing;
    const cfg = config(); if (!cfg.enabled || !cfg.site || !cfg.projects.length) return { status: 'unconfigured' };
    syncing = (async () => {
      try {
        const issues = [], seen = new Set(); let nextPageToken, startAt = 0;
        do {
          const result = await call('search', scoped({ jql: `assignee = currentUser() AND project in (${cfg.projects.map(p => `"${p}"`).join(',')}) ORDER BY updated DESC`, fields: ['summary', 'description', 'status', 'priority', 'project', 'issuetype', 'assignee', 'updated', 'duedate', 'issuelinks', 'labels', 'components'], maxResults: 100, ...(nextPageToken ? { nextPageToken } : { startAt }) }));
          const batch = result.issues || result.data?.issues; if (!Array.isArray(batch)) throw Error('Unsupported Jira search response');
          const countBefore = seen.size;
          for (const issue of batch) if (!seen.has(issue.id)) { issues.push(normalizeJiraIssue(issue, cfg.site)); seen.add(issue.id); }
          if (batch.length && seen.size === countBefore) throw Error('Jira pagination repeated a page');
          const previous = nextPageToken; nextPageToken = result.nextPageToken;
          startAt += batch.length;
          if (result.isLast === true || (!nextPageToken && (result.total == null || startAt >= result.total))) break;
          if (!batch.length || (previous && nextPageToken === previous)) throw Error('Jira pagination did not advance');
        } while (true);
        if (!config().enabled || config().site?.id !== cfg.site.id || JSON.stringify(config().projects) !== JSON.stringify(cfg.projects)) return { status: 'superseded' };
        write(storeFile, { items: issues, status: 'fresh', last_sync: new Date(now()).toISOString() }); onSynced(); return { status: 'fresh', count: issues.length };
      } catch { const previous = store(); write(storeFile, { ...previous, status: 'error', error: 'Jira sync failed. Check permissions or reconnect; cached tasks are retained.' }); return { status: 'error' }; }
    })().finally(() => { syncing = null; }); return syncing;
  }
  async function preview(operation, issueKey, changes) {
    if (!['comment', 'edit', 'transition'].includes(operation) || !/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) throw Error('Invalid Jira action');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Error('Invalid Jira changes');
    const allowed = operation === 'comment' ? ['commentBody'] : operation === 'transition' ? ['transition'] : ['fields'];
    if (Object.keys(changes).some(k => !allowed.includes(k))) throw Error('Unsupported Jira changes');
    if (operation === 'comment' && (typeof changes.commentBody !== 'string' || !changes.commentBody.trim() || changes.commentBody.length > 16000)) throw Error('A non-empty comment up to 16000 characters is required');
    if (operation === 'transition' && (!changes.transition || typeof changes.transition.id !== 'string' || !/^\d+$/.test(changes.transition.id))) throw Error('Choose a valid Jira transition');
    if (operation === 'edit' && (!changes.fields || Object.keys(changes.fields).some(k => !['summary', 'description', 'priority', 'labels', 'duedate', 'assignee'].includes(k)))) throw Error('Unsupported Jira fields');
    const current = await call('issue', scoped({ issueIdOrKey: issueKey }));
    const revision = current.fields?.updated; if (!revision) throw Error('Jira revision unavailable');
    const proposal = { id: crypto.randomUUID(), site: config().site, issueKey, operation, changes: structuredClone(changes), revision, before: current.fields, expires: now() + 600000, status: 'pending' };
    const data = read(proposalsFile, {}); data[proposal.id] = proposal; write(proposalsFile, data); return proposal;
  }
  async function commit(id, approved) {
    const data = read(proposalsFile, {}), proposal = data[id];
    if (!proposal || proposal.status !== 'pending' || proposal.expires < now() || proposal.site.id !== config().site?.id) throw Error('Jira preview expired or already used');
    if (approved !== true) { proposal.status = 'cancelled'; write(proposalsFile, data); return { status: 'cancelled' }; }
    proposal.status = 'checking'; write(proposalsFile, data);
    const current = await call('issue', scoped({ issueIdOrKey: proposal.issueKey }));
    if (current.fields?.updated !== proposal.revision) { proposal.status = 'conflict'; write(proposalsFile, data); throw Error('Jira changed. Create a new preview.'); }
    proposal.status = 'sending'; write(proposalsFile, data);
    try { const result = await call(proposal.operation, scoped({ issueIdOrKey: proposal.issueKey, ...proposal.changes })); proposal.status = 'sent'; write(proposalsFile, data); return { status: 'sent', result }; }
    catch { proposal.status = 'needs_reconciliation'; write(proposalsFile, data); return { status: 'needs_reconciliation', error: 'Delivery is uncertain. Check Jira before creating another action; this action will not be replayed.' }; }
  }
  return { config, sync, preview, commit,
    proposals: () => Object.values(read(proposalsFile, {})).filter(p => ['pending', 'sending', 'needs_reconciliation'].includes(p.status)).map(({ before, ...p }) => ({ ...p, before: Object.fromEntries(Object.keys(p.changes.fields || {}).map(k => [k, before?.[k]])) })),
    items: () => { const cfg = config(); return store().items.filter(item => item.connection === `jira:${cfg.site?.id}` && cfg.projects.includes(item.project)); },
    status: () => ({ ...config(), status: store().status, last_sync: store().last_sync, error: store().error, capabilities: Object.fromEntries(Object.entries(toolNames).map(([name, aliases]) => [name, tools.some(t => aliases.includes(t.name))])) }),
    async authorize(origin) { const u = new URL(origin); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.protocol !== 'http:') throw Error('OAuth callback must use local ATL'); callbackUrl = `${u.origin}/api/my-tasks/jira/oauth/callback`; authorizationUrl = null; await loadSecret(); if (secret.callbackUrl && secret.callbackUrl !== callbackUrl) delete secret.client; delete secret.tokens; secret.callbackUrl = callbackUrl; await saveSecret(); await client?.close(); client = null; tools = []; try { await connect(); } catch { if (!authorizationUrl) throw Error('Jira authorization could not start'); } return { authorization_url: authorizationUrl, connected: !!client }; },
    async finish(code, state) { if (!authState || state !== authState.value || now() > authState.expires || !code) throw Error('Invalid or expired Jira OAuth state'); authState = null; await transport.finishAuth(code); client = null; tools = []; await connect(); return { connected: true }; },
    async sites() { const result = await call('sites'); return Array.isArray(result) ? result : result.resources || result.data || []; },
    async projects(siteId) { const sites = await this.sites(), site = sites.find(s => s.id === (siteId || config().site?.id)); if (!site) throw Error('Choose an accessible Jira site'); const result = await call('projects', { cloudId: site.id, maxResults: 100 }); return result.values || result.projects || result.data || []; },
    async saveSettings(value) { const cfg = config(), sites = await this.sites(), site = sites.find(s => s.id === value.site_id); if (!site || !/^https:\/\/[a-z0-9.-]+\.atlassian\.net\/?$/i.test(site.url)) throw Error('Choose an accessible Jira Cloud site'); if (!Array.isArray(value.projects) || value.projects.some(p => !/^[A-Z][A-Z0-9_]{0,30}$/.test(p))) throw Error('Invalid Jira project keys'); write(configFile, { ...cfg, site: { id: site.id, name: site.name, url: site.url.replace(/\/$/, '') }, projects: [...new Set(value.projects)], enabled: true, interval_minutes: Math.max(1, Math.min(1440, Number(value.interval_minutes) || 15)) }); return config(); },
    async read(operation, args) { if (!['search', 'issue', 'comments', 'transitions'].includes(operation)) throw Error('Unknown Jira read action'); return call(operation, scoped(args)); },
    async disconnect() { await client?.close(); client = null; tools = []; secret = {}; authState = null; fs.rmSync(secretsFile, { force: true }); write(configFile, { ...config(), enabled: false }); },
    start() { stopped = false; timer = setInterval(() => { const last = Date.parse(store().last_sync || '') || 0; if (!stopped && now() - last >= config().interval_minutes * 60000) void sync(); }, 60000); timer.unref?.(); void sync(); },
    async stop() { stopped = true; clearInterval(timer); await client?.close(); client = null; }
  };
}
