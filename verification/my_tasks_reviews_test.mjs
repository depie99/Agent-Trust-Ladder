import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMyTasksReviews, resolveReviewRepositories, validateReview, reviewMermaid } from '../runtime/lib/my-tasks-reviews.mjs';
import { emptyMyTasksStore, writeMyTasksStore, readMyTasksStore } from '../runtime/lib/my-tasks.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-review-contract-'));
const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
const git = args => execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'pipe' });
git(['init']); fs.writeFileSync(path.join(repo, 'cart.js'), 'export function cart() { return "old"; }\n');
fs.mkdirSync(path.join(repo, '.agents/skills/cart'), { recursive: true });
fs.writeFileSync(path.join(repo, '.agents/skills/cart/SKILL.md'), 'Cart task instructions are agent guidance, not application behavior.');
git(['add', '.']); git(['-c', 'user.name=ATL Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
const connection = 'https://azure.invalid/collection';
const item = (id, state_category) => ({ key: `${connection}|Alpha|${id}`, connection, project: 'Alpha', id, rev: 1, title: 'Cart item request', description_text: 'Change cart item behavior.', acceptance_criteria: 'Cart persists.', area_path: 'Alpha\\Cart\\Web', state_category, priority: 2, changed_at: '2026-11-13T09:00:00Z', url: `${connection}/Alpha/_workitems/edit/${id}` });
const records = [item(1, 'proposed'), item(2, 'inprogress'), item(3, 'complete')];
const store = emptyMyTasksStore(); store.records = Object.fromEntries(records.map(i => [i.key, i])); writeMyTasksStore(root, store);
const registry = () => [{ id: 'repoA', name: 'Cart', root: repo }, { id: 'repoB', name: 'Other', root: repo }];
const output = packet => ({ brief: packet.locale === 'fa-IR' ? 'درخواست تغییر سبد خرید' : 'Change the cart behavior', summary: 'Understand the requested cart change.', expected: 'Cart items persist.', ambiguity: '', findings: [{ text: 'Review cart behavior before changing it.', evidence_ids: packet.evidence.slice(0, 1).map(e => e.id) }], checks: ['Confirm cart persistence.'], diagram: { nodes: [{ label: 'Current cart', kind: packet.evidence.length ? 'observed' : 'unknown', evidence_ids: packet.evidence.slice(0, 1).map(e => e.id) }, { label: 'Requested change', kind: 'proposed', evidence_ids: [] }, { label: 'Expected result', kind: 'proposed', evidence_ids: [] }], edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }] } });
const engines = [];
const create = options => { const engine = createMyTasksReviews(root, { registry, imported: () => [], ...options }); engines.push(engine); return engine; };
const settle = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(predicate(), 'queue settles within bounded fixture time'); };
try {
  const bindings = { rules: [{ connection, project: 'Alpha', area: '', repository_ids: ['repoB'] }, { connection, project: 'Alpha', area: 'Alpha\\Cart', repository_ids: ['repoA'] }], items: {} };
  assert.deepEqual(resolveReviewRepositories(records[0], bindings), ['repoA'], 'longest matching area rule wins');
  const imported = [{ source: { type: 'azure', url: records[0].url }, repository_ids: ['repoB', 'repoA'] }];
  assert.deepEqual(resolveReviewRepositories(records[0], bindings, imported), ['repoB', 'repoA'], 'exact imported association wins over project rules');
  assert.deepEqual(resolveReviewRepositories(records[0], { ...bindings, items: { [records[0].key]: [] } }, imported), [], 'explicit empty item override disables inherited code access');
  assert.deepEqual(resolveReviewRepositories({ ...records[0], area_path: 'Alpha\\Cartoon' }, bindings), ['repoB'], 'area prefix must match a complete path segment');

  let calls = [];
  let engine = create({ invoke: async packet => { calls.push(packet); return { result: output(packet), provider: 'fixture', model: 'fixture' }; } });
  engine.saveBindings(bindings);
  await engine.tick();
  assert.equal(calls[0].item.id, 2, 'in-progress precedes To Do and Done');
  await settle(() => engine.status().ready === 3);
  assert.deepEqual(calls.map(p => p.item.id), [2, 1, 3], 'all statuses are reviewed, including Done');
  assert.ok(calls[0].evidence.some(e => e.path === 'cart.js'), 'review reads a bounded excerpt of the linked repository');
  assert.ok(calls.every(call => call.evidence.every(entry => !entry.path.startsWith('.agents/'))), 'agent skill instructions cannot consume the application evidence budget');
  assert.equal(engine.get(records[0].key).coverage, 'code');
  const originalCalls = calls.length; engine.get(records[0].key); engine.decorate(records); engine.status();
  assert.equal(calls.length, originalCalls, 'all reads are pure and never invoke an agent');
  engine.ensure('en-US'); assert.equal(engine.status().queued, 0, 'unchanged snapshots do not generate duplicate jobs');
  engine.stop();

  fs.writeFileSync(path.join(repo, 'cart.js'), 'export function cart() { return "new"; }\n');
  engine = create({ invoke: async packet => { calls.push(packet); return { result: output(packet) }; } });
  engine.ensure('en-US');
  assert.equal(engine.get(records[0].key).status, 'stale', 'dirty code invalidates a cached review');
  assert.ok(engine.get(records[0].key).result, 'old review remains available during regeneration');
  await engine.tick(); await settle(() => engine.status().ready === 3);
  engine.ensure('fa-IR'); await engine.tick(); await settle(() => engine.status('fa-IR').ready === 3);
  assert.match(engine.get(records[0].key, 'fa-IR').result.brief, /سبد/);
  const beforeLanguageSwitch = calls.length; engine.ensure('en-US'); assert.equal(engine.status().queued, 0); assert.equal(calls.length, beforeLanguageSwitch, 'returning to an existing language uses its cache');
  engine.stop();

  const changed = readMyTasksStore(root); changed.records[records[0].key].rev++; writeMyTasksStore(root, changed);
  engine = create({ invoke: async packet => ({ result: output(packet) }) }); engine.ensure('en-US');
  assert.equal(engine.status().queued, 1, 'only changed task is queued after restart');
  await engine.tick(); await settle(() => engine.status().ready === 3); engine.stop();

  engine = create({ invoke: async () => { throw new Error('auth provider unavailable'); } });
  engine.ensure('en-US', { retryKey: records[0].key }); await engine.tick();
  assert.equal(engine.status().paused.reason, 'provider', 'auth/quota failures pause reviews without deleting task results'); engine.stop();
  engine = create({ invoke: async packet => ({ result: output(packet) }) }); engine.ensure('en-US', { resume: true }); await engine.tick(); await settle(() => !engine.status().paused && engine.status().ready === 3); engine.stop();

  let failures = 0;
  engine = create({ retryMs: 0, invoke: async () => { failures++; throw new Error('temporary network error'); } });
  engine.ensure('en-US', { retryKey: records[0].key }); await engine.tick(); await settle(() => engine.status().failed === 1);
  assert.equal(failures, 2, 'one retry only'); engine.ensure(); assert.equal(engine.status().queued, 0, 'failed reviews do not spin indefinitely'); engine.stop();

  engine = create({ invoke: async packet => ({ result: output(packet) }) });
  engine.saveBindings({ rules: [], items: {} }); await engine.tick(); await settle(() => engine.status().ready === 3);
  assert.equal(engine.get(records[0].key).coverage, 'task-only', 'unbound tasks receive explicitly limited text reviews');
  assert.throws(() => engine.saveBindings({ rules: [{ connection, project: 'Alpha', repository_ids: ['not-registered'] }], items: {} }), /registered/);
  engine.stop();

  const feedback = [];
  engine = create({ retryMs: 0, invoke: async packet => {
    feedback.push(packet.validation_feedback);
    const result = output(packet);
    if (!packet.validation_feedback) result.findings[0].evidence_ids = ['task'];
    return { result };
  } });
  engine.ensure('en-US', { retryKey: records[0].key }); await engine.tick(); await settle(() => engine.status().ready === 3);
  assert.equal(feedback.length, 2, 'unsupported task citations are rejected and corrected in the one retry');
  assert.match(feedback[1], /not read/, 'retry receives the validation failure rather than repeating the same prompt'); engine.stop();

  let raceCalls = 0;
  engine = create({ invoke: async packet => {
    raceCalls++;
    if (raceCalls === 1) { const data = readMyTasksStore(root); data.records[packet.item.key].rev++; writeMyTasksStore(root, data); }
    return { result: output(packet) };
  } });
  engine.ensure('en-US', { retryKey: records[0].key }); await engine.tick(); await settle(() => engine.status().ready === 3);
  assert.equal(raceCalls, 2, 'a result from a superseded revision is discarded and replaced');
  assert.equal(engine.get(records[0].key).source_revision, readMyTasksStore(root).records[records[0].key].rev); engine.stop();

  let blockedCalls = 0;
  engine = create({ canRun: () => false, invoke: async packet => { blockedCalls++; return { result: output(packet) }; } });
  engine.ensure('en-US', { retryKey: records[0].key }); await engine.tick(); assert.equal(blockedCalls, 0, 'foreground/capacity gate prevents provider invocation'); engine.stop();
  engine = create({ invoke: async packet => ({ result: output(packet) }) }); await engine.tick(); await settle(() => engine.status().ready === 3);
  assert.equal(engine.status().queued, 0, 'persisted work resumes when capacity becomes available');
  const invalid = output({ evidence: [] }); invalid.diagram.nodes[0].kind = 'observed';
  assert.throws(() => validateReview(invalid, []), /require code evidence/, 'code observations require real references');
  invalid.diagram.nodes[0].kind = 'unknown'; invalid.findings[0].evidence_ids = ['invented'];
  assert.throws(() => validateReview(invalid, []), /not read/);
  const diagram = output({ evidence: [] }).diagram; diagram.nodes = diagram.nodes.map((node, i) => ({ ...node, id: `n${i}` })); diagram.nodes[0].label = '"] --> injected["<script>';
  assert.ok(!reviewMermaid(diagram).includes('<script>'), 'Mermaid labels are escaped and graph identities are server-controlled');
  diagram.nodes[0].label = 'Unknown: Unknown: cart persistence';
  diagram.nodes[0].kind = 'unknown';
  assert.match(reviewMermaid(diagram), /Unknown: cart persistence/);
  assert.ok(!reviewMermaid(diagram).includes('Unknown: Unknown:'), 'generated node labels get one status prefix');
  console.log('PASS: review queue, all statuses, bindings, code evidence, dirty/revision invalidation, locale cache, restart, auth pause, retry ceiling, task-only fallback, citation validation and safe diagrams');
} finally { engines.forEach(engine => engine.stop()); }
