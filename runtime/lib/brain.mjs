// Evidence-linked project memory. Human-readable knowledge may live in
// research/, but consequential claims live here with immutable source facts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const CLAIM_STATUSES = ["VERIFIED", "PARTIAL", "UNKNOWN", "CONFLICTED", "SUPERSEDED"];

export function brainPaths(root) {
  const dir = path.join(root, ".trust", "manager", "brain");
  return { dir, claims: path.join(dir, "claims.json"), contexts: path.join(dir, "contexts"), raw: path.join(dir, "raw"), sources: path.join(dir, "sources.json"), events: path.join(dir, "events.jsonl") };
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function load(root) {
  const p = brainPaths(root);
  if (!fs.existsSync(p.claims)) return { version: 1, claims: [], updated_at: null };
  return JSON.parse(fs.readFileSync(p.claims, "utf8"));
}

function save(root, store) {
  const p = brainPaths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  store.updated_at = new Date().toISOString();
  const tmp = `${p.claims}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, p.claims);
}

function loadSources(root) {
  const p = brainPaths(root);
  if (!fs.existsSync(p.sources)) return { version: 1, sources: [], revision: 0 };
  return JSON.parse(fs.readFileSync(p.sources, "utf8"));
}

function saveSources(root, store, expectedRevision = null) {
  const p = brainPaths(root);
  const current = loadSources(root);
  if (expectedRevision != null && current.revision !== expectedRevision) {
    const error = new Error(`source snapshot conflict: expected revision ${expectedRevision}, found ${current.revision}`);
    error.code = "SOURCE_REVISION_CONFLICT";
    throw error;
  }
  fs.mkdirSync(p.dir, { recursive: true });
  store.revision = (current.revision || 0) + 1;
  store.updated_at = new Date().toISOString();
  const tmp = `${p.sources}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, p.sources);
  return store;
}

function appendEvent(root, event) {
  const p = brainPaths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.events, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

export function archiveSource(root, { sourceId, uri = null, content, result = "ok", error = null, observedAt = new Date().toISOString(), expectedRevision = null }) {
  if (!sourceId) throw new Error("source archive requires sourceId");
  if (content == null && result === "ok") throw new Error("successful source archive requires content");
  const bytes = content == null ? null : Buffer.from(String(content), "utf8");
  const revision = bytes ? digest(bytes) : null;
  const store = loadSources(root);
  const existing = store.sources.find((source) => source.id === sourceId && source.revision === revision && source.result === result);
  if (existing) return { source: existing, duplicate: true };
  if (expectedRevision != null && store.revision !== expectedRevision) {
    const error = new Error(`source snapshot conflict: expected revision ${expectedRevision}, found ${store.revision}`);
    error.code = "SOURCE_REVISION_CONFLICT";
    throw error;
  }
  if (bytes) {
    const rawDir = path.join(brainPaths(root).raw, revision);
    fs.mkdirSync(rawDir, { recursive: true });
    const rawFile = path.join(rawDir, "content");
    if (!fs.existsSync(rawFile)) fs.writeFileSync(rawFile, bytes);
  }
  const source = { id: sourceId, uri, revision, observed_at: observedAt, result, error, raw_path: revision ? `.trust/manager/brain/raw/${revision}/content` : null };
  saveSources(root, { ...store, sources: [...store.sources, source] }, store.revision);
  appendEvent(root, { type: "source_intake", source_id: sourceId, revision, result, error });
  return { source, duplicate: false };
}

export function sourceStatus(root) {
  const store = loadSources(root);
  const byResult = {};
  for (const source of store.sources) byResult[source.result] = (byResult[source.result] || 0) + 1;
  return { revision: store.revision || 0, total: store.sources.length, by_result: byResult, sources: store.sources };
}

export function addClaim(root, input) {
  if (!input.text || !input.source_id) throw new Error("claim requires text and source_id");
  const status = input.status || "UNKNOWN";
  if (!CLAIM_STATUSES.includes(status)) throw new Error(`unknown claim status: ${status}`);
  const store = load(root);
  const sourceRevision = input.source_revision || (input.source_content != null ? digest(Buffer.from(String(input.source_content), "utf8")) : null);
  if (!sourceRevision) throw new Error("claim requires source_revision or source_content");
  const source = { id: input.source_id, uri: input.source_uri || null, revision: sourceRevision };
  const existing = store.claims.find((c) => c.text === input.text && c.source_id === input.source_id && c.source_revision === sourceRevision);
  if (existing) return { claim: existing, duplicate: true };
  const claim = {
    claim_id: input.claim_id || `claim-${digest(`${input.source_id}:${sourceRevision}:${input.text}`).slice(0, 12)}`,
    text: String(input.text), source_id: source.id, source_uri: source.uri,
    source_revision: source.revision, observed_at: input.observed_at || new Date().toISOString(),
    checked_at: input.checked_at || null, status, project: input.project || "atl",
    owner: input.owner || "knowledge-review", subject: input.subject || null,
  };
  const conflicts = store.claims.filter((c) => c.subject && claim.subject && c.subject === claim.subject && c.text !== claim.text && c.status !== "SUPERSEDED");
  if (conflicts.length) {
    claim.status = "CONFLICTED";
    for (const other of conflicts) if (other.status === "VERIFIED" || other.status === "PARTIAL") other.status = "CONFLICTED";
  }
  store.claims.push(claim);
  save(root, store);
  return { claim, duplicate: false, conflicts: conflicts.map((c) => c.claim_id) };
}

export function listClaims(root, { subject = null, status = null } = {}) {
  return load(root).claims.filter((c) => (!subject || c.subject === subject) && (!status || c.status === status));
}

export function buildContextPack(root, { query = "", subjects = [], maxClaims = 20 } = {}) {
  const q = String(query).toLowerCase();
  const wanted = new Set(subjects);
  const claims = listClaims(root).filter((c) => (!wanted.size || wanted.has(c.subject)) && (!q || `${c.text} ${c.subject || ""}`.toLowerCase().includes(q))).slice(0, maxClaims);
  return { version: 1, generated_at: new Date().toISOString(), query, claims: claims.map((c) => ({ claim_id: c.claim_id, text: c.text, status: c.status, source_id: c.source_id, source_revision: c.source_revision, checked_at: c.checked_at })) };
}

export function saveContextPack(root, pack, name = "latest") {
  const p = brainPaths(root); fs.mkdirSync(p.contexts, { recursive: true });
  const file = path.join(p.contexts, `${name}.json`); fs.writeFileSync(file, JSON.stringify(pack, null, 2) + "\n"); return file;
}
