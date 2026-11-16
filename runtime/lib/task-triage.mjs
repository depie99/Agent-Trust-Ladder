import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TRIAGE_VERSION = 'task-triage-1';
const weights = { impact: .4, timing: .3, blocking: .2, priority: .1 };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file); }
export function triageInput(item) {
  return { title: String(item.title || '').slice(0, 500), description: String(item.description_text || '').slice(0, 10000), acceptance_criteria: String(item.acceptance_criteria || '').slice(0, 4000), source_priority: item.source_priority || item.priority || null, due_at: item.due_at || null, dependencies: item.dependencies || [], business_impact: item.business_impact || null };
}
export function validateTriage(value, input) {
  if (!value || typeof value !== 'object' || !['low', 'medium', 'high'].includes(value.confidence)) throw Error('Invalid triage response');
  const factors = {};
  const source = JSON.stringify(input).toLowerCase();
  for (const name of Object.keys(weights)) {
    const factor = value.factors?.[name];
    if (factor == null) { factors[name] = null; continue; }
    if (!Number.isFinite(factor.score) || factor.score < 0 || factor.score > 100 || typeof factor.evidence !== 'string' || factor.evidence.length < 2 || factor.evidence.length > 600 || !source.includes(factor.evidence.toLowerCase())) throw Error(`Invalid ${name} evidence or score`);
    factors[name] = { score: factor.score, evidence: factor.evidence };
  }
  const explanations = {};
  for (const locale of ['en-US', 'fa-IR']) {
    const text = value.explanations?.[locale];
    if (!text || typeof text.reason !== 'string' || !text.reason.trim() || text.reason.length > 700 || !Array.isArray(text.missing) || text.missing.length > 6 || text.missing.some(v => typeof v !== 'string' || v.length > 200)) throw Error('Invalid triage explanation');
    explanations[locale] = { reason: text.reason, missing: text.missing };
  }
  return { factors, explanations, confidence: value.confidence };
}
export function scoreTriage(result, item, now = Date.now()) {
  if (!result || item.state_category === 'complete') return { score: null, level: item.state_category === 'complete' ? 'complete' : 'unknown' };
  const factors = { ...result.factors };
  if (item.due_at && Number.isFinite(Date.parse(item.due_at))) {
    const days = Math.ceil((Date.parse(item.due_at) - now) / 86400000);
    factors.timing = { score: days <= 0 ? 100 : days <= 1 ? 90 : days <= 3 ? 75 : days <= 7 ? 50 : days <= 14 ? 25 : 10, evidence: item.due_at };
  }
  // Source priority alone is insufficient to assert an urgency estimate.
  if (!['impact', 'timing', 'blocking'].some(key => factors[key])) return { score: null, level: 'unknown' };
  let sum = 0, total = 0;
  for (const [key, weight] of Object.entries(weights)) if (factors[key]) { sum += factors[key].score * weight; total += weight; }
  const score = Math.round(sum / total / 5) * 5;
  return { score, level: score >= 80 ? 'urgent' : score >= 60 ? 'high' : score >= 30 ? 'normal' : 'low', factors };
}

export function createTaskTriage(root, { items, invoke, canRun = () => true, now = () => Date.now(), intervalMs = 15000 } = {}) {
  const dir = path.join(root, '.trust/manager/my-tasks'), file = path.join(dir, 'triage.json'), settingsFile = path.join(dir, 'triage-settings.json'), lockFile = path.join(dir, 'triage-worker.lock');
  let timer, active = false, stopped = false;
  const settings = () => ({ enabled: false, provider: '', model: '', daily_limit: 250, ...read(settingsFile, {}) });
  const book = () => ({ entries: {}, jobs: [], attempts: {}, ...read(file, {}) });
  const fingerprint = item => digest([TRIAGE_VERSION, triageInput(item), settings().provider, settings().model]);
  function ensure(retryKey) {
    const data = book(), cfg = settings(), records = items();
    data.jobs = data.jobs.filter(j => records.some(i => i.key === j.key && i.state_category !== 'complete'));
    if (!cfg.enabled) return;
    for (const item of records.filter(i => i.state_category !== 'complete')) {
      const fp = fingerprint(item), entry = data.entries[item.key];
      if (entry?.fingerprint === fp && !(retryKey === item.key && entry.status === 'failed')) continue;
      data.entries[item.key] = { ...entry, fingerprint: fp, status: entry?.result ? 'stale' : 'queued', attempts: 0 };
      data.jobs = data.jobs.filter(j => j.key !== item.key);
      data.jobs.push({ key: item.key, fingerprint: fp });
    }
    write(file, data);
  }
  function detail(item, entry, locale = 'en-US') {
    if (!item) return null;
    const result = scoreTriage(entry?.result, item, now());
    return { ...result, status: entry?.status || (settings().enabled ? 'queued' : 'unconfigured'), stale: !!entry && (entry.status === 'stale' || entry.fingerprint !== fingerprint(item)), confidence: entry?.result?.confidence || null, explanation: entry?.result?.explanations?.[locale === 'fa-IR' ? locale : 'en-US'] || null, generated_at: entry?.generated_at || null, provider: entry?.provider || null, model: entry?.model || null, historical: item.state_category === 'complete' ? entry?.result || null : undefined };
  }
  function get(key, locale = 'en-US') { return detail(items().find(i => i.key === key), book().entries[key], locale); }
  async function tick() {
    if (active || stopped || !settings().enabled || !canRun()) return;
    fs.mkdirSync(dir, { recursive: true });
    try { const fd = fs.openSync(lockFile, 'wx'); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd); }
    catch { try { const pid = Number(fs.readFileSync(lockFile, 'utf8')); try { process.kill(pid, 0); return; } catch (error) { if (error.code !== 'ESRCH') return; } fs.unlinkSync(lockFile); } catch {} return; }
    active = true;
    try {
      ensure(); const data = book(), cfg = settings(), day = new Date(now()).toISOString().slice(0, 10);
      if ((data.attempts[day] || 0) >= cfg.daily_limit) return;
      const job = data.jobs.find(j => !j.due || j.due <= now()); if (!job) return;
      const item = items().find(i => i.key === job.key); if (!item) return;
      const entry = data.entries[job.key]; entry.status = 'running'; entry.attempts++; data.attempts[day] = (data.attempts[day] || 0) + 1; write(file, data);
      try {
        const input = triageInput(item); let timeout;
        const answer = await Promise.race([invoke({ input, settings: cfg, timeoutMs: 60000, logPath: path.join(dir, 'triage-logs', `${digest(job.key)}.log`) }), new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(Error('Triage timed out'), { temporary: true })), 60000); })]).finally(() => clearTimeout(timeout));
        if (answer.code || answer.timedOut || answer.providerFailure) throw Object.assign(Error(answer.timedOut ? 'Triage timeout' : 'Provider request failed'), { temporary: !!answer.timedOut || answer.providerFailure?.kind === 'provider-quota' });
        let output = answer.result || answer.text || answer.stdout || answer;
        if (typeof output === 'string') output = JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        const result = validateTriage(output, input), fresh = book();
        if (fresh.entries[job.key]?.fingerprint !== job.fingerprint || fingerprint(items().find(i => i.key === job.key) || {}) !== job.fingerprint) return;
        fresh.entries[job.key] = { ...entry, result, status: 'ready', generated_at: new Date(now()).toISOString(), provider: cfg.provider, model: cfg.model };
        fresh.jobs = fresh.jobs.filter(j => j.key !== job.key); write(file, fresh);
      } catch (error) {
        const fresh = book(); if (fresh.entries[job.key]?.fingerprint !== job.fingerprint) return;
        const temporary = error.temporary || /timeout|429|502|503|504|ECONNRESET/i.test(error.message);
        const retry = temporary && entry.attempts < 2;
        fresh.entries[job.key] = { ...entry, status: retry ? 'queued' : 'failed', error: 'Analysis unavailable. Check provider settings or retry.' };
        if (retry) fresh.jobs = fresh.jobs.map(j => j.key === job.key ? { ...j, due: now() + 60000 } : j); else fresh.jobs = fresh.jobs.filter(j => j.key !== job.key);
        write(file, fresh);
      }
    } finally { active = false; try { fs.unlinkSync(lockFile); } catch {} }
  }
  return { settings, ensure, get, tick,
    saveSettings(value) { const cfg = { ...settings(), ...value }; if (typeof cfg.enabled !== 'boolean' || typeof cfg.provider !== 'string' || (cfg.enabled && !/glm.*flash/i.test(cfg.model || '')) || !Number.isInteger(cfg.daily_limit) || cfg.daily_limit < 1 || cfg.daily_limit > 10000) throw Error('Choose a GLM Flash model, provider and daily limit (1–10000).'); write(settingsFile, cfg); ensure(); return cfg; },
    decorate(records) { const data = book(); return records.map(item => { const value = detail(item, data.entries[item.key]); return { ...item, source: item.source || 'azure', source_priority: item.source_priority || { rank: item.priority, label: item.priority ? `P${item.priority}` : null }, triage: value && { score: value.score, level: value.level, status: value.status, stale: value.stale } }; }); },
    status() { const data = book(); return { running: active, queued: data.jobs.length, ready: Object.values(data.entries).filter(e => e.status === 'ready').length, failed: Object.values(data.entries).filter(e => e.status === 'failed').length, settings: settings() }; },
    start() { stopped = false; ensure(); timer = setInterval(() => void tick(), intervalMs); timer.unref?.(); void tick(); },
    stop() { stopped = true; clearInterval(timer); }
  };
}
