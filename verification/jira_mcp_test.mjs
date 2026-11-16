import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJiraMcp, normalizeJiraIssue } from '../runtime/lib/jira-mcp.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-jira-mcp-'));
const site = { id: 'cloud-one', name: 'Fixture', url: 'https://fixture.atlassian.net' };
let revision = '2026-11-13T10:00:00Z', failSync = false, writes = 0, loseResponse = false, searches = 0;
const issue = id => ({ id: String(id), key: `APP-${id}`, fields: { summary: `Task ${id}`, updated: revision, status: { name: id % 3 ? 'Doing' : 'Closed', statusCategory: { key: id % 3 ? 'indeterminate' : 'done' } }, project: { key: 'APP' }, priority: { id: '9', name: 'Highest' }, description: { content: [{ text: '<script>alert(1)</script>' }] } } });
const jira = createJiraMcp(root, { transportCall: async (op, args) => {
  if (op === 'sites') return [site];
  assert.equal(args.cloudId, site.id, 'configured site cannot be overridden');
  if (op === 'search') { searches++; if (failSync) throw Error('403'); const start = args.startAt || 0; return { issues: Array.from({ length: Math.min(100, 205 - start) }, (_, i) => issue(start + i + 1)), total: 205 }; }
  if (op === 'issue') return issue(1);
  if (['comment', 'edit', 'transition'].includes(op)) { writes++; if (loseResponse) throw Error('timeout'); return { ok: true }; }
  return [];
} });
await jira.saveSettings({ site_id: site.id, projects: ['APP'] });
assert.equal((await jira.sync()).count, 205); assert.equal(searches, 3);
assert.ok(jira.items().some(i => i.state_category === 'complete'));
assert.ok(jira.items().every(i => i.key.startsWith('jira|cloud-one|')));
assert.equal(normalizeJiraIssue(issue(1), site).source_priority.rank, null, 'Jira priority ID is not a ranking');
failSync = true; await jira.sync(); assert.equal(jira.items().length, 205, 'failed sync preserves cached tasks');
let p = await jira.preview('comment', 'APP-1', { commentBody: 'A reviewed comment' }); assert.equal(writes, 0);
await jira.commit(p.id, false); assert.equal(writes, 0); await assert.rejects(() => jira.commit(p.id, true));
p = await jira.preview('edit', 'APP-1', { fields: { summary: 'New title' } }); revision = '2026-11-13T11:00:00Z';
await assert.rejects(() => jira.commit(p.id, true), /changed/); assert.equal(writes, 0);
p = await jira.preview('comment', 'APP-1', { commentBody: 'Confirmed comment' }); assert.equal((await jira.commit(p.id, true)).status, 'sent'); assert.equal(writes, 1);
await assert.rejects(() => jira.commit(p.id, true));
loseResponse = true; p = await jira.preview('transition', 'APP-1', { transition: { id: '31' } });
assert.equal((await jira.commit(p.id, true)).status, 'needs_reconciliation'); await assert.rejects(() => jira.commit(p.id, true)); assert.equal(writes, 2);
await assert.rejects(() => jira.preview('edit', 'APP-1', { fields: { arbitrary: 'x' } }));
await assert.rejects(() => jira.finish('code', 'invented-state'), /state/);
await jira.read('issue', { cloudId: 'other', issueIdOrKey: 'APP-1' });
await jira.disconnect(); assert.equal(jira.config().enabled, false);
console.log('PASS: Jira 205-item pagination, category mapping, source identity, cached error recovery, scoped tools, preview/cancel/revision conflict, exactly-once dispatch and ambiguous-write reconciliation');
