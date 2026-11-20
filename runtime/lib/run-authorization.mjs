import path from 'node:path';
import crypto from 'node:crypto';
import { loadState } from './state.mjs';
import { loadQueue } from './queue.mjs';
import { atomicJson, readJson, withFileLock } from './file-transaction.mjs';
const file = root => path.join(root, '.trust', 'manager', 'run-previews.json');
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fingerprint(root, options) {
  const state = loadState(root);
  const tasks = options.taskIds || loadQueue(root, options.queueId).items.map(item => item.id);
  return hash({ options, tasks: tasks.map(id => state.tasks[id]), queue: options.taskIds ? null : loadQueue(root, options.queueId) });
}
export function createRunPreview(root, options, preview) {
  if (!options.queueId && !options.taskIds?.length) throw new Error('Select a queue or explicit tasks');
  if (!Number.isFinite(options.maxMinutes) || options.maxMinutes <= 0 || !Number.isInteger(options.maxSessions) || options.maxSessions < 1 || options.maxSessions > 50) throw new Error('Explicit positive maxMinutes and maxSessions (1–50) are required');
  const record = { token: crypto.randomUUID(), options, fingerprint: fingerprint(root, options), created_at: Date.now(), expires_at: Date.now() + 15 * 60000, status: 'preview' };
  withFileLock(file(root), () => {
    const book = readJson(file(root), {});
    for (const [key, item] of Object.entries(book)) if (item.expires_at < Date.now()) delete book[key];
    book[record.token] = record; atomicJson(file(root), book);
  });
  return { previewToken: record.token, expires_at: record.expires_at, limits: options, preview, next_actions: ['approve_bounded_run'] };
}
export function consumeRunPreview(root, payload) {
  if (payload.confirm !== true || !payload.idempotencyKey) throw new Error('Run start needs explicit confirmation and an idempotency key');
  return withFileLock(file(root), () => {
    const book = readJson(file(root), {}), record = book[payload.previewToken];
    if (!record || record.expires_at < Date.now()) throw new Error('Run preview expired; preview again');
    if (record.status === 'submitted' && record.idempotency_key === payload.idempotencyKey) return { ...record.options, replay: true, run_id: record.run_id || null };
    if (record.status !== 'preview') throw new Error('Run preview already submitted; inspect run status before retrying');
    if (record.fingerprint !== fingerprint(root, record.options)) throw new Error('Tasks or queue changed after preview; preview again');
    record.status = 'submitted'; record.idempotency_key = payload.idempotencyKey; record.submitted_at = Date.now();
    atomicJson(file(root), book);
    return record.options;
  });
}
export function markRunPreviewStarted(root,token,runId){
  return withFileLock(file(root),()=>{
    const book=readJson(file(root),{}),record=book[token];
    if(!record||record.status!=='submitted')throw new Error('Run preview submission record is unavailable');
    if(record.run_id&&record.run_id!==runId)throw new Error('Run preview is bound to another run');
    record.run_id=runId;record.started_at=Date.now();atomicJson(file(root),book);return record;
  });
}
