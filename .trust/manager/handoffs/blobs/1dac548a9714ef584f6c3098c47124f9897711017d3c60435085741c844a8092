// Small local learning store. It is deterministic, inspectable, and never calls a model.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_ENTRIES = 200;
const KINDS = new Set(["preference", "style", "prompt", "lesson", "outcome"]);

function fileFor(root) {
  return path.join(root, ".trust", "manager", "learning.json");
}

function empty() {
  return { version: 1, updated_at: new Date().toISOString(), entries: [] };
}

function load(root) {
  const file = fileFor(root);
  if (!fs.existsSync(file)) return empty();
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.version !== 1 || !Array.isArray(value.entries)) throw new Error(`Invalid local learning store at ${file}`);
  return value;
}

function save(root, store) {
  const file = fileFor(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  store.updated_at = new Date().toISOString();
  store.entries = store.entries.slice(-MAX_ENTRIES);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function idFor(kind, text) {
  return crypto.createHash("sha256").update(`${kind}\n${text.trim().toLowerCase()}`).digest("hex").slice(0, 12);
}

function tokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9\u0600-\u06ff]+/g) || []);
}

export function learnLocal(root, { kind = "lesson", text, source = "explicit", tags = [] } = {}) {
  const clean = String(text || "").trim();
  if (!KINDS.has(kind)) throw new Error(`Unknown learning kind "${kind}". Use: ${[...KINDS].join(", ")}`);
  if (!clean) throw new Error("Learning text cannot be empty");
  const store = load(root);
  const id = idFor(kind, clean);
  const existing = store.entries.find((entry) => entry.id === id);
  if (existing) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.last_seen_at = new Date().toISOString();
  } else {
    store.entries.push({
      id,
      kind,
      text: clean.slice(0, 1200),
      source,
      tags: tags.slice(0, 12),
      occurrences: 1,
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    });
  }
  save(root, store);
  return { stored: true, id, kind, file: fileFor(root) };
}

export function recallLocal(root, query, { limit = 5 } = {}) {
  const queryTokens = tokens(query);
  if (!queryTokens.size) return { results: [], provider: "local" };
  const store = load(root);
  const results = store.entries.map((entry) => {
    const entryTokens = tokens(`${entry.kind} ${entry.text} ${(entry.tags || []).join(" ")}`);
    const overlap = [...queryTokens].filter((token) => entryTokens.has(token)).length;
    return { ...entry, score: overlap / queryTokens.size };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.last_seen_at.localeCompare(a.last_seen_at))
    .slice(0, limit);
  return { results, provider: "local" };
}

export function forgetLocal(root, id) {
  const store = load(root);
  const before = store.entries.length;
  store.entries = store.entries.filter((entry) => entry.id !== id);
  if (store.entries.length !== before) save(root, store);
  return { removed: before !== store.entries.length, id, file: fileFor(root) };
}

export function learningStatus(root) {
  const store = load(root);
  return {
    provider: "local",
    enabled: true,
    file: fileFor(root),
    entries: store.entries.length,
    kinds: Object.fromEntries([...KINDS].map((kind) => [kind, store.entries.filter((entry) => entry.kind === kind).length])),
  };
}
