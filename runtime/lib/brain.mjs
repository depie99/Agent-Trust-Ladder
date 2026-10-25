// Evidence-linked project memory. Human-readable knowledge may live in
// research/, but consequential claims live here with immutable source facts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const CLAIM_STATUSES = ["VERIFIED", "PARTIAL", "UNKNOWN", "CONFLICTED", "SUPERSEDED"];

export function brainPaths(root) {
  const dir = path.join(root, ".trust", "manager", "brain");
  return { dir, claims: path.join(dir, "claims.json"), contexts: path.join(dir, "contexts") };
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

export function addClaim(root, input) {
  if (!input.text || !input.source_id) throw new Error("claim requires text and source_id");
  const status = input.status || "UNKNOWN";
  if (!CLAIM_STATUSES.includes(status)) throw new Error(`unknown claim status: ${status}`);
  const store = load(root);
  const sourceRevision = input.source_revision || (input.source_content != null ? digest(input.source_content) : null);
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
