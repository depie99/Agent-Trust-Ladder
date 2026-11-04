#!/usr/bin/env node
// Portable operational memory for the skills-only surface. The Control Plane
// imports this module, so both surfaces make the same decisions from the same
// files instead of keeping parallel implementations.
//
// What it does:
//   - records failure signatures from receipts/blockers and proposes a scoped
//     preventer that must be authorized with evidence before it is enforced
//   - selects a bounded, ranked context with provenance, validity and coverage
//   - keeps claim state honest: active, conflicted, unknown, expired,
//     superseded, and different predicates on one subject are not contradictions
//   - writes through a journal so an interrupted write is reconciled instead of
//     silently becoming verified knowledge
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const MEMORY_VERSION = 1;
export const MEMORY_STATUSES = Object.freeze(["active", "conflicted", "unknown", "expired", "superseded"]);

export function memoryPaths(root) {
  const dir = path.join(root, ".atl", "memory");
  return {
    dir,
    sources: path.join(dir, "sources.json"),
    claims: path.join(dir, "claims.json"),
    failures: path.join(dir, "failures.jsonl"),
    preventions: path.join(dir, "preventions.json"),
    journal: path.join(dir, "journal"),
    temporary: path.join(dir, "tmp"),
  };
}

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const iso = (value) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);
const isExpired = (item, now) => Boolean(item?.valid_until) && new Date(item.valid_until).getTime() <= now;
const isFuture = (item, now) => Boolean(item?.valid_from) && new Date(item.valid_from).getTime() > now;

export function failureSignature(record = {}) {
  const blocker = String(record.blocker || record.cause || record.signature || "unclassified").trim().toLowerCase();
  const reason = String(record.reason || record.message || "").trim();
  const normalized = reason
    .replace(/\d+(\.\d+)?/g, "N")
    .replace(/[A-Za-z]:\\[^\s'"]+/g, "<path>")
    .replace(/\s+/g, " ")
    .slice(0, 160);
  return { signature_id: `${blocker}:${digest(normalized).slice(0, 12)}`, cause_class: blocker, normalized_reason: normalized };
}

function readJson(file, fallback) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")), corrupt: false };
  } catch (error) {
    if (error.code === "ENOENT") return { value: fallback, corrupt: false };
    return { value: fallback, corrupt: true, error: error.message };
  }
}

// ---------- journaled writes ----------

function journalEntry(root, record) {
  const p = memoryPaths(root);
  fs.mkdirSync(p.journal, { recursive: true });
  const file = path.join(p.journal, `${Date.now()}-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...record }, null, 2) + "\n");
  return file;
}

export function writeJournaled(root, name, payload) {
  const p = memoryPaths(root);
  fs.mkdirSync(p.temporary, { recursive: true });
  const target = path.join(p.dir, name);
  const temporary = path.join(p.temporary, `${name}.${process.pid}.tmp`);
  const intent = journalEntry(root, { name, phase: "intent", bytes: Buffer.byteLength(JSON.stringify(payload)) });
  try {
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n");
    fs.renameSync(temporary, target);
  } catch (error) {
    journalEntry(root, { name, phase: "failed", reason: error.message, intent: path.basename(intent) });
    throw error;
  }
  journalEntry(root, { name, phase: "committed", intent: path.basename(intent) });
  return target;
}

export function recoverMemory(root, { now = Date.now() } = {}) {
  const p = memoryPaths(root);
  const problems = [];
  let reconciled = 0;
  if (fs.existsSync(p.journal)) {
    const entries = fs.readdirSync(p.journal).sort();
    const intents = new Map();
    for (const entry of entries) {
      const body = readJson(path.join(p.journal, entry), {}).value || {};
      if (body.phase === "intent") intents.set(body.name, entry);
      if (body.phase === "committed") intents.delete(body.name);
    }
    for (const [name, entry] of intents) {
      problems.push({ name, cause: "interrupted-write", journal: entry });
    }
    reconciled = intents.size;
  }
  if (fs.existsSync(p.temporary)) {
    for (const leftover of fs.readdirSync(p.temporary)) {
      problems.push({ name: leftover, cause: "partial-temporary-file" });
    }
  }
  for (const [name, file] of [["sources.json", p.sources], ["claims.json", p.claims], ["preventions.json", p.preventions]]) {
    if (fs.existsSync(file) && readJson(file, null).corrupt) problems.push({ name, cause: "corrupt-store" });
  }
  return {
    version: MEMORY_VERSION,
    checked_at: new Date(now).toISOString(),
    status: problems.length ? "inconsistent" : "clean",
    reconciled_interrupted_writes: reconciled,
    problems,
    verified: problems.length === 0,
  };
}

// ---------- failure signatures and preventers ----------

export function recordFailure(root, input = {}) {
  const signature = failureSignature(input);
  const p = memoryPaths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  const record = {
    at: iso(input.at) || new Date().toISOString(),
    signature_id: signature.signature_id,
    cause_class: signature.cause_class,
    normalized_reason: signature.normalized_reason,
    task_id: input.task_id || null,
    receipt: input.receipt || null,
    symptom: input.symptom || null,
    cause: input.cause || null,
  };
  fs.appendFileSync(p.failures, JSON.stringify(record) + "\n");
  return { signature, occurrence: failureOccurrences(root, signature.signature_id) };
}

export function listFailures(root) {
  const p = memoryPaths(root);
  if (!fs.existsSync(p.failures)) return [];
  return fs.readFileSync(p.failures, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function failureOccurrences(root, signatureId, { since = null } = {}) {
  const sinceTime = since ? new Date(since).getTime() : null;
  return listFailures(root).filter((item) => item.signature_id === signatureId && (!sinceTime || new Date(item.at).getTime() >= sinceTime)).length;
}

export function proposePrevention(root, { signature_id: signatureId, preventer, rationale = "", author = "atl", rollback = "" } = {}) {
  if (!signatureId) throw new Error("a prevention proposal needs the recurring failure signature");
  if (!preventer || !String(preventer).trim()) throw new Error("a prevention proposal needs a scoped preventer");
  const p = memoryPaths(root);
  const store = readJson(p.preventions, { version: MEMORY_VERSION, preventions: [] });
  if (store.corrupt) throw new Error("preventions store is corrupt; run recoverMemory before proposing a prevention");
  const before = failureOccurrences(root, signatureId);
  if (before < 2) throw new Error(`signature ${signatureId} occurred ${before} time(s); one anecdote is not a recurring failure`);
  const candidate = {
    candidate_id: `prevent-${digest(`${signatureId}:${preventer}`).slice(0, 12)}`,
    signature_id: signatureId,
    preventer: String(preventer).trim(),
    rationale: String(rationale || "").trim(),
    rollback: String(rollback || "").trim(),
    status: "proposed",
    author: String(author),
    proposed_at: new Date().toISOString(),
    before_occurrences: before,
    evidence: null,
    authorized_by: null,
    history: [{ at: new Date().toISOString(), status: "proposed", actor: String(author) }],
  };
  const preventions = [...store.value.preventions.filter((item) => item.candidate_id !== candidate.candidate_id), candidate];
  writeJournaled(root, "preventions.json", { version: MEMORY_VERSION, preventions });
  return candidate;
}

export function authorizePrevention(root, candidateId, { actor = null, evidence = null } = {}) {
  if (!actor) throw new Error("authorizing a prevention needs the acting authority");
  const command = String(evidence?.command || "").trim();
  const passing = evidence?.result === "passed";
  if (!command || !passing) throw new Error("a prevention is enforced only with a passing regression command that catches a recurrence");
  const p = memoryPaths(root);
  const store = readJson(p.preventions, { version: MEMORY_VERSION, preventions: [] });
  if (store.corrupt) throw new Error("preventions store is corrupt; refusing to enforce");
  const existing = store.value.preventions.find((item) => item.candidate_id === candidateId);
  if (!existing) throw new Error(`unknown prevention candidate: ${candidateId}`);
  const updated = {
    ...existing,
    status: "authorized",
    authorized_by: String(actor),
    authorized_at: iso(evidence.at) || new Date().toISOString(),
    evidence: { command, result: "passed", at: evidence.at || new Date().toISOString() },
    history: [...existing.history, { at: new Date().toISOString(), status: "authorized", actor: String(actor), command }],
  };
  writeJournaled(root, "preventions.json", { version: MEMORY_VERSION, preventions: store.value.preventions.map((item) => (item.candidate_id === candidateId ? updated : item)) });
  return updated;
}

export function rollbackPrevention(root, candidateId, { actor = null, reason = "" } = {}) {
  if (!actor) throw new Error("rolling back a prevention needs the acting authority");
  const p = memoryPaths(root);
  const store = readJson(p.preventions, { version: MEMORY_VERSION, preventions: [] });
  if (store.corrupt) throw new Error("preventions store is corrupt; refusing to change enforcement state");
  const existing = store.value.preventions.find((item) => item.candidate_id === candidateId);
  if (!existing) throw new Error(`unknown prevention candidate: ${candidateId}`);
  const updated = {
    ...existing,
    status: "rolled-back",
    rolled_back_at: new Date().toISOString(),
    rollback_reason: String(reason || "owner rolled back the prevention"),
    history: [...existing.history, { at: new Date().toISOString(), status: "rolled-back", actor: String(actor), reason }],
  };
  writeJournaled(root, "preventions.json", { version: MEMORY_VERSION, preventions: store.value.preventions.map((item) => (item.candidate_id === candidateId ? updated : item)) });
  return updated;
}

export function preventionStatus(root, { signature_id: signatureId = null } = {}) {
  const p = memoryPaths(root);
  const store = readJson(p.preventions, { version: MEMORY_VERSION, preventions: [] });
  if (store.corrupt) return { status: "inconsistent", enforced: [], proposed: [], problem: "preventions store is corrupt" };
  const items = store.value.preventions.filter((item) => !signatureId || item.signature_id === signatureId);
  const report = (item) => ({
    candidate_id: item.candidate_id,
    signature_id: item.signature_id,
    preventer: item.preventer,
    status: item.status,
    enforced: item.status === "authorized",
    evidence: item.evidence || null,
    before_occurrences: item.before_occurrences,
    after_occurrences: failureOccurrences(root, item.signature_id, { since: item.authorized_at || item.proposed_at }),
    rollback: item.rollback || null,
  });
  return {
    status: "ok",
    enforced: items.filter((item) => item.status === "authorized").map(report),
    proposed: items.filter((item) => item.status === "proposed").map(report),
    rolled_back: items.filter((item) => item.status === "rolled-back").map(report),
  };
}

// ---------- bounded retrieval with provenance ----------

export function tokenize(text) {
  return String(text || "")
    .replace(/\u200c/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

export function selectContext(root, { query = "", budgetChars = 1200, now = Date.now(), sources = null, maxItems = 12 } = {}) {
  const p = memoryPaths(root);
  let available = sources;
  let corrupt = false;
  if (!available) {
    const store = readJson(p.sources, { version: MEMORY_VERSION, sources: [] });
    corrupt = store.corrupt;
    available = store.value.sources || [];
  }
  if (corrupt) return { version: MEMORY_VERSION, query, status: "inconsistent", items: [], coverage: { considered: 0, selected: 0, omitted: 0, stale: 0, missing_evidence: true }, problem: "sources store is corrupt; no context is served from unverified state" };
  const tokens = tokenize(query);
  const scored = [];
  let stale = 0;
  for (const source of available) {
    if (isExpired(source, now) || isFuture(source, now)) { stale++; continue; }
    const haystack = `${source.title || ""} ${source.text || ""} ${(source.tags || []).join(" ")}`;
    const hayTokens = new Set(tokenize(haystack));
    const matched = tokens.filter((token) => hayTokens.has(token));
    scored.push({ source, score: tokens.length ? matched.length / tokens.length : 0, matched });
  }
  scored.sort((a, b) => (b.score - a.score)
    || String(b.source.observed_at || "").localeCompare(String(a.source.observed_at || ""))
    || String(a.source.source_id).localeCompare(String(b.source.source_id)));
  const items = [];
  let used = 0;
  for (const entry of scored.slice(0, maxItems)) {
    if (entry.score <= 0) continue;
    const text = String(entry.source.text || "");
    const remaining = budgetChars - used;
    if (remaining <= 24) break;
    const excerpt = text.length <= remaining ? text : `${text.slice(0, remaining - 1)}…`;
    used += excerpt.length;
    items.push({
      source_id: entry.source.source_id,
      uri: entry.source.uri || null,
      title: entry.source.title || null,
      excerpt,
      truncated: excerpt.length < text.length,
      revision: entry.source.revision || null,
      observed_at: entry.source.observed_at || null,
      valid_until: entry.source.valid_until || null,
      status: entry.source.status || "observed",
      score: Number(entry.score.toFixed(3)),
      selected_because: entry.matched.length ? `matched ${entry.matched.join(", ")}` : "unspecified",
    });
  }
  const considered = scored.filter((entry) => entry.score > 0).length;
  return {
    version: MEMORY_VERSION,
    query,
    status: items.length ? "ok" : "no-evidence",
    items,
    used_chars: used,
    budget_chars: budgetChars,
    coverage: {
      considered,
      selected: items.length,
      omitted: Math.max(0, considered - items.length),
      stale,
      duplicate_sources: available.length - considered - stale,
      missing_evidence: items.length === 0,
    },
  };
}

// ---------- claim state ----------

export function claimStates(claims = [], { now = Date.now() } = {}) {
  const byClaim = new Map();
  for (const claim of claims) {
    let status = "active";
    // A claim that names a successor is history; the successor itself stays active.
    if (claim.status === "SUPERSEDED" || claim.superseded_by) status = "superseded";
    else if (isExpired(claim, now)) status = "expired";
    else if (!claim.source_revision || claim.status === "UNKNOWN") status = "unknown";
    else if (claim.status === "PARTIAL") status = "active";
    byClaim.set(claim.claim_id, { ...claim, state: status });
  }
  const buckets = new Map();
  for (const claim of byClaim.values()) {
    if (claim.state !== "active") continue;
    const key = `${claim.subject || ""}\u0000${claim.predicate || ""}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(claim);
  }
  const conflicted = new Set();
  for (const group of buckets.values()) {
    const byValue = new Map();
    for (const claim of group) {
      const value = String(claim.value ?? claim.text ?? "");
      if (!byValue.has(value)) byValue.set(value, []);
      byValue.get(value).push(claim);
    }
    if (byValue.size < 2) continue;
    // Copies of one source corroborate; only independent sources disagree.
    const independentSources = new Set(group.map((claim) => claim.source_id));
    if (independentSources.size < 2) continue;
    for (const claim of group) conflicted.add(claim.claim_id);
  }
  const items = [...byClaim.values()].map((claim) => (conflicted.has(claim.claim_id) ? { ...claim, state: "conflicted" } : claim));
  const counts = Object.fromEntries(MEMORY_STATUSES.map((status) => [status, items.filter((item) => item.state === status).length]));
  return { version: MEMORY_VERSION, counts, items };
}
