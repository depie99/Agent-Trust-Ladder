// The research library: ATL's cumulative engineering-intelligence store.
//
// Research records (research/records/*.md) capture findings from watched
// sources — posts, releases, videos, interviews — each with source URLs,
// an evidence level, and an explicit ATL recommendation. index.json is the
// deduplicated evidence index; promotion (the human approval gate) turns a
// record into a real task in state.json. Research never edits code directly.
//
//   P0 — architectural: delegation, coordination, queues, recovery, memory
//   P1 — engineering:  skills, SDD/TDD, reviews, testing, observability
//   P2 — inspiration:  TUI/UX ideas and experiments

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths, loadState, saveState, createTask, logEvent } from "./state.mjs";
import { post as feedPost } from "./feed.mjs";
import { addClaim } from "./brain.mjs";

export const RESEARCH_VERSION = 1;
export const RECORD_STATUSES = ["pending", "approved", "promoted", "rejected"];
export const PRIORITIES = ["P0", "P1", "P2"];
export const EVIDENCE_LEVELS = ["verified", "second-hand", "speculation"];
export const RECORD_KINDS = [
  "post", "video", "interview", "release", "repo", "changelog",
  "announcement", "note", "retro",
];
// Research priority -> task priority at promotion (triage may still adjust).
export const PRIORITY_TO_TASK = { P0: "high", P1: "normal", P2: "low" };

export class ResearchError extends Error {}

export function researchPaths(root) {
  const dir = path.join(root, "research");
  return {
    dir,
    index: path.join(dir, "index.json"),
    sources: path.join(dir, "sources.json"),
    backlog: path.join(dir, "backlog.md"),
    records: path.join(dir, "records"),
    transcripts: path.join(dir, "transcripts"),
    briefs: path.join(dir, "briefs"),
    graph: path.join(dir, "graph.json"),
  };
}

function ensureDirs(root) {
  const p = researchPaths(root);
  for (const d of [p.dir, p.records, p.transcripts, p.briefs]) fs.mkdirSync(d, { recursive: true });
}

export function slugify(text, max = 48) {
  const slug = String(text).toLowerCase().normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/g, "") || "record";
}

function sha(text, len = 20) {
  return crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, len);
}

// Canonical form of a URL for dedup: strip tracking params, fragments,
// trailing slashes; collapse x.com/twitter.com; collapse YouTube watch forms.
export function canonicalUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  let u;
  try { u = new URL(text); } catch { return text.toLowerCase(); }
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if (u.hostname === "twitter.com") u.hostname = "x.com";
  const drop = [];
  for (const [k] of u.searchParams) {
    if (/^(utm_|mc_|ref_|fbclid$|gclid$|si$|feature$|app$)/i.test(k)) drop.push(k);
  }
  for (const k of drop) u.searchParams.delete(k);
  // YouTube: everything resolves to the video id.
  const id = youtubeId(`${u.hostname}${u.pathname}${u.search}`);
  if (u.hostname.endsWith("youtube.com") || u.hostname === "youtu.be") {
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  const search = u.searchParams.toString();
  return u.origin + u.pathname.replace(/\/+$/, "") + (search ? `?${search}` : "");
}

export function youtubeId(raw) {
  const m = String(raw || "").match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i
  );
  return m ? m[1] : null;
}

export function dedupKeysFor({ url = "", title = "" }) {
  const keys = [];
  const c = canonicalUrl(url);
  if (c) keys.push("url:" + sha(c));
  const t = String(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (t) keys.push("title:" + sha(t));
  return keys;
}

function recordFile(p, id) {
  return path.join(p.records, `${id}.md`);
}

export function renderRecordMarkdown(fields, body) {
  const fm = JSON.stringify(fields, null, 2);
  return `---\n${fm}\n---\n\n${body.replace(/\s+$/, "")}\n`;
}

export function parseRecordMarkdown(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new ResearchError("record file is missing JSON frontmatter");
  let fields;
  try { fields = JSON.parse(m[1]); } catch (err) {
    throw new ResearchError(`record frontmatter is not valid JSON: ${err.message}`);
  }
  return { fields, body: m[2].replace(/^\r?\n/, "") };
}

export function nextRecordId(index) {
  let max = 0;
  for (const id of Object.keys(index.records || {})) {
    const n = Number(String(id).match(/^R-(\d+)$/)?.[1] || 0);
    if (n > max) max = n;
  }
  return "R-" + String(max + 1).padStart(4, "0");
}

export function loadSources(root) {
  const p = researchPaths(root);
  if (!fs.existsSync(p.sources)) return { version: 1, sources: [] };
  return JSON.parse(fs.readFileSync(p.sources, "utf8"));
}

export function saveSources(root, store) {
  const p = researchPaths(root);
  fs.mkdirSync(path.dirname(p.sources), { recursive: true });
  const tmp = p.sources + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, p.sources);
}

export function loadIndex(root) {
  const p = researchPaths(root);
  if (!fs.existsSync(p.index)) return rebuildIndex(root);
  try {
    const index = JSON.parse(fs.readFileSync(p.index, "utf8"));
    if (index && index.version === RESEARCH_VERSION) return index;
  } catch { /* fall through to rebuild */ }
  return rebuildIndex(root);
}

export function saveIndex(root, index) {
  ensureDirs(root);
  const p = researchPaths(root);
  index.version = RESEARCH_VERSION;
  index.updated_at = new Date().toISOString();
  index.stats = statsFor(index);
  const tmp = p.index + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2) + "\n");
  fs.renameSync(tmp, p.index);
}

function statsFor(index) {
  const byStatus = {};
  const byPriority = {};
  for (const r of Object.values(index.records || {})) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;
  }
  return { total: Object.keys(index.records || {}).length, byStatus, byPriority };
}

// Rebuild the index from the record files — the files are the truth.
export function rebuildIndex(root) {
  ensureDirs(root);
  const p = researchPaths(root);
  const index = {
    version: RESEARCH_VERSION,
    updated_at: new Date().toISOString(),
    last_brief_at: null,
    records: {},
    dedup: {},
  };
  const files = fs.existsSync(p.records)
    ? fs.readdirSync(p.records).filter((f) => f.endsWith(".md")).sort()
    : [];
  for (const f of files) {
    try {
      const { fields } = parseRecordMarkdown(fs.readFileSync(path.join(p.records, f), "utf8"));
      index.records[fields.id] = summarizeRecord(fields);
      for (const k of fields.dedup || []) index.dedup[k] = fields.id;
    } catch (err) {
      if (process.env.ATL_DEBUG) console.error(`[research] skipping ${f}: ${err.message}`);
    }
  }
  saveIndex(root, index);
  return index;
}

function summarizeRecord(fields) {
  return {
    id: fields.id,
    title: fields.title,
    kind: fields.kind,
    priority: fields.priority,
    status: fields.status,
    evidence: fields.evidence,
    published: fields.published || null,
    captured: fields.captured,
    updated: fields.updated,
    people: fields.people || [],
    concepts: fields.concepts || [],
    sources: fields.sources || [],
    repos: fields.repos || [],
    tickets: fields.tickets || [],
    transcript: fields.transcript || null,
    atl_impact: fields.atl_impact || "",
    dedup: fields.dedup || [],
  };
}

// Create a record; throws with .existingId when the URL/title is already known.
export function createRecord(root, fields, { force = false } = {}) {
  if (!fields.title || !String(fields.title).trim()) throw new ResearchError("research add needs --title");
  if (!PRIORITIES.includes(fields.priority)) {
    throw new ResearchError(`--set priority must be one of ${PRIORITIES.join(" | ")}`);
  }
  if (fields.kind && !RECORD_KINDS.includes(fields.kind)) {
    throw new ResearchError(`unknown kind "${fields.kind}". Use: ${RECORD_KINDS.join(" | ")}`);
  }
  if (fields.evidence && !EVIDENCE_LEVELS.includes(fields.evidence)) {
    throw new ResearchError(`--set evidence must be one of ${EVIDENCE_LEVELS.join(" | ")}`);
  }
  ensureDirs(root);
  const p = researchPaths(root);
  const index = loadIndex(root);
  const keys = dedupKeysFor({ url: (fields.sources || [])[0], title: fields.title });
  if (!force) {
    for (const k of keys) {
      if (index.dedup[k]) {
        const err = new ResearchError(`already captured as ${index.dedup[k]} (dedup key ${k}). Use --set force=true to file anyway.`);
        err.existingId = index.dedup[k];
        throw err;
      }
    }
  }
  const id = nextRecordId(index);
  const now = new Date().toISOString();
  const record = {
    id,
    title: String(fields.title).trim(),
    kind: fields.kind || "post",
    priority: fields.priority,
    status: "pending",
    published: fields.published || null,
    captured: now,
    updated: now,
    people: fields.people || [],
    concepts: fields.concepts || [],
    sources: fields.sources || [],
    repos: fields.repos || [],
    evidence: fields.evidence || "second-hand",
    atl_impact: fields.atl_impact || "",
    checks: fields.checks || [],
    objective: fields.objective || "",
    tickets: [],
    transcript: null,
    decisions: [{ at: now, actor: fields.actor || "manager", action: "captured", note: "" }],
    dedup: keys,
  };
  const body = fields.body && String(fields.body).trim()
    ? String(fields.body).trim() + "\n"
    : defaultBody(record);
  fs.writeFileSync(recordFile(p, id), renderRecordMarkdown(record, body));
  addClaim(root, {
    text: record.atl_impact || record.title,
    subject: (record.concepts || [])[0] || record.title,
    source_id: record.id,
    source_uri: (record.sources || [])[0] || null,
    source_content: body,
    status: record.evidence === "verified" ? "VERIFIED" : record.evidence === "second-hand" ? "PARTIAL" : "UNKNOWN",
    project: "atl",
    owner: "knowledge-review",
  });
  index.records[id] = summarizeRecord(record);
  for (const k of keys) index.dedup[k] = id;
  saveIndex(root, index);
  return readRecord(root, id);
}

function defaultBody(record) {
  const lines = [];
  if (record.sources.length) lines.push(`Source: ${record.sources[0]}`);
  lines.push("", "## Summary", "", "(not yet written)", "");
  lines.push("## ATL recommendation", "", record.atl_impact || "(not yet assessed)");
  return lines.join("\n");
}

export function readRecord(root, id) {
  const p = researchPaths(root);
  const file = recordFile(p, id);
  if (!fs.existsSync(file)) return null;
  const { fields, body } = parseRecordMarkdown(fs.readFileSync(file, "utf8"));
  return { file, fields, body };
}

function writeRecord(root, record, body) {
  const p = researchPaths(root);
  record.updated = new Date().toISOString();
  fs.writeFileSync(recordFile(p, record.id), renderRecordMarkdown(record, body));
}

// Whitelisted field patch from the CLI (`research set <id> --set k=v`).
const SETTABLE = ["title", "kind", "priority", "evidence", "atl_impact", "objective", "published"];

export function patchRecord(root, id, patch, { actor = "manager" } = {}) {
  const rec = readRecord(root, id);
  if (!rec) throw new ResearchError(`unknown research record ${id}`);
  if (rec.fields.status === "promoted") throw new ResearchError(`${id}: promoted records are immutable`);
  const applied = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!SETTABLE.includes(k)) {
      throw new ResearchError(`cannot set "${k}" — settable fields: ${SETTABLE.join(", ")}`);
    }
    if (k === "priority" && !PRIORITIES.includes(v)) throw new ResearchError(`priority must be one of ${PRIORITIES.join(" | ")}`);
    if (k === "evidence" && !EVIDENCE_LEVELS.includes(v)) throw new ResearchError(`evidence must be one of ${EVIDENCE_LEVELS.join(" | ")}`);
    if (k === "kind" && !RECORD_KINDS.includes(v)) throw new ResearchError(`kind must be one of ${RECORD_KINDS.join(" | ")}`);
    rec.fields[k] = v;
    applied[k] = v;
  }
  rec.fields.decisions = [...(rec.fields.decisions || []), {
    at: new Date().toISOString(), actor, action: "set",
    note: Object.entries(applied).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", "),
  }];
  writeRecord(root, id, rec.body);
  const index = loadIndex(root);
  if (index.records[id]) Object.assign(index.records[id], summarizeRecord(rec.fields));
  saveIndex(root, index);
  return readRecord(root, id);
}

export function setRecordStatus(root, id, status, { note = "", actor = "manager" } = {}) {
  if (!RECORD_STATUSES.includes(status)) {
    throw new ResearchError(`status must be one of ${RECORD_STATUSES.join(" | ")}`);
  }
  const rec = readRecord(root, id);
  if (!rec) throw new ResearchError(`unknown research record ${id}`);
  if (rec.fields.status === status) throw new ResearchError(`${id}: already ${status}`);
  if (rec.fields.status === "promoted" && status !== "promoted") {
    throw new ResearchError(`${id}: promoted records are immutable (it became ${rec.fields.tickets.join(", ")})`);
  }
  const now = new Date().toISOString();
  rec.fields.status = status;
  rec.fields.decisions = [...(rec.fields.decisions || []), { at: now, actor, action: status, note }];
  writeRecord(root, id, rec.body);
  const index = loadIndex(root);
  if (index.records[id]) {
    index.records[id].status = status;
    index.records[id].updated = rec.fields.updated;
  }
  saveIndex(root, index);
  return readRecord(root, id);
}

// The approval gate: research proposes, a human promotes. Promotion files a
// real task (intake_key `research:<id>` keeps it idempotent with intake dedupe).
export function promoteRecord(root, id, { actor = "manager", note = "" } = {}) {
  const rec = readRecord(root, id);
  if (!rec) throw new ResearchError(`unknown research record ${id}`);
  if (rec.fields.status === "promoted") {
    return { taskId: rec.fields.tickets[0] || null, record: rec, already: true };
  }
  if (rec.fields.status === "rejected") {
    throw new ResearchError(`${id} was rejected — reopen it first (research approve ${id})`);
  }
  const state = loadState(root); // throws with the init hint when absent
  const task = createTask(state, {
    title: rec.fields.title,
    source: { type: "research", record: id, url: (rec.fields.sources || [])[0] || null },
    resources: rec.fields.sources || [],
    objective: rec.fields.objective || rec.fields.atl_impact || "",
    completion_checks: rec.fields.checks || [],
    priority: PRIORITY_TO_TASK[rec.fields.priority] || "normal",
    risk: "normal",
    labels: ["research", rec.fields.priority.toLowerCase()],
    intake_key: `research:${id}`,
  });
  task.depends_on = Array.isArray(rec.fields.depends_on) ? rec.fields.depends_on : [];
  logEvent(state, { task: task.id, actor, event: "research:promoted", detail: `${id} — ${rec.fields.title}` });
  saveState(root, state);

  const now = new Date().toISOString();
  rec.fields.status = "promoted";
  rec.fields.tickets = [...(rec.fields.tickets || []), task.id];
  rec.fields.decisions = [...(rec.fields.decisions || []), { at: now, actor, action: "promoted", note: note || `created ${task.id}` }];
  writeRecord(root, id, rec.body);
  const index = loadIndex(root);
  if (index.records[id]) {
    index.records[id].status = "promoted";
    index.records[id].tickets = rec.fields.tickets;
    index.records[id].updated = rec.fields.updated;
  }
  saveIndex(root, index);
  feedPost(root, {
    from: "beacon",
    kind: "card",
    task: task.id,
    status: "new",
    text: `Promoted research ${id} into the backlog: ${rec.fields.title}`,
    detail: `${rec.fields.priority} · ${rec.fields.evidence} · ${(rec.fields.sources || [])[0] || "no source url"}`,
  });
  return { taskId: task.id, record: readRecord(root, id), already: false };
}

export function listRecords(root, { status = null, priority = null, kind = null, person = null, concept = null } = {}) {
  const index = loadIndex(root);
  let rows = Object.values(index.records || {});
  if (status) rows = rows.filter((r) => r.status === status);
  if (priority) rows = rows.filter((r) => r.priority === priority);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (person) rows = rows.filter((r) => (r.people || []).includes(person));
  if (concept) rows = rows.filter((r) => (r.concepts || []).includes(concept));
  const rank = { P0: 0, P1: 1, P2: 2 };
  return rows.sort((a, b) =>
    (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || String(a.id).localeCompare(String(b.id)));
}

export function renderRecordList(records) {
  if (!records.length) return "No research records match.";
  const out = ["  ID      PRIO  STATUS    EVIDENCE      TITLE", "  ──────  ────  ────────  ────────────  ─────────────────────────────"];
  for (const r of records) {
    out.push(
      `  ${r.id}  ${r.priority}    ${(r.status || "").padEnd(8)}  ${(r.evidence || "").padEnd(12)}  ${r.title}`
    );
  }
  out.push("", "Show one with: atl research show <id>");
  return out.join("\n");
}

export function renderRecord(rec) {
  const f = rec.fields;
  const L = [];
  L.push(`${f.id} — ${f.title}`);
  L.push(`${f.priority} · ${f.kind} · ${f.status} · evidence: ${f.evidence}`);
  if (f.published) L.push(`published ${f.published} · captured ${String(f.captured).slice(0, 10)}`);
  if ((f.people || []).length) L.push(`people: ${f.people.join(", ")}`);
  if ((f.concepts || []).length) L.push(`concepts: ${f.concepts.join(", ")}`);
  for (const s of f.sources || []) L.push(`source: ${s}`);
  for (const r of f.repos || []) L.push(`repo: ${r}`);
  if (f.transcript) L.push(`transcript: ${f.transcript}`);
  if ((f.tickets || []).length) L.push(`tasks: ${f.tickets.join(", ")}`);
  L.push("", rec.body.trim());
  if ((f.decisions || []).length) {
    L.push("", "Decision log:");
    for (const d of f.decisions) L.push(`  ${String(d.at).slice(0, 16)} ${d.actor} ${d.action}${d.note ? ` — ${d.note}` : ""}`);
  }
  return L.join("\n");
}

export function researchStatus(root) {
  const index = loadIndex(root);
  const store = loadSources(root);
  const sources = (store.sources || []).map((s) => ({
    id: s.id, type: s.type, enabled: s.enabled !== false,
    requires_auth: !!s.requires_auth,
    last_checked: s.last_checked || null, last_result: s.last_result || null,
  }));
  return { stats: index.stats, last_brief_at: index.last_brief_at, sources };
}

// A light knowledge graph for the P2 explorer: nodes are records, people,
// repos, and concepts; edges are authored/tagged/references/promoted.
export function exportGraph(root) {
  const index = loadIndex(root);
  const nodes = new Map();
  const edges = [];
  const add = (id, type, label) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, label: label || id });
  };
  for (const r of Object.values(index.records || {})) {
    add(r.id, "record", r.title);
    for (const person of r.people || []) {
      add(`person:${person}`, "person", person);
      edges.push({ from: `person:${person}`, to: r.id, rel: "authored" });
    }
    for (const repo of r.repos || []) {
      add(`repo:${repo}`, "repo", repo);
      edges.push({ from: r.id, to: `repo:${repo}`, rel: "references" });
    }
    for (const c of r.concepts || []) {
      add(`concept:${c}`, "concept", c);
      edges.push({ from: r.id, to: `concept:${c}`, rel: "tagged" });
    }
    for (const t of r.tickets || []) {
      add(t, "task", t);
      edges.push({ from: r.id, to: t, rel: "promoted" });
    }
  }
  const graph = {
    version: RESEARCH_VERSION,
    exported_at: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges,
  };
  ensureDirs(root);
  const p = researchPaths(root);
  const tmp = p.graph + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(graph, null, 2) + "\n");
  fs.renameSync(tmp, p.graph);
  return graph;
}

// ---------- retrospective scan (deterministic, no model calls)

// Scan team history for patterns worth a retrospective ticket: tasks that
// needed repeat attempts, recurring blockers, escalations. Returns draft
// findings; the caller files them as pending records (or ignores them).
export function scanRetros(root) {
  const state = loadState(root);
  const byTask = new Map();
  for (const e of state.log || []) {
    if (!e.task) continue;
    if (!byTask.has(e.task)) byTask.set(e.task, []);
    byTask.get(e.task).push(e);
  }
  const findings = [];
  for (const task of Object.values(state.tasks || {})) {
    if (isRetroTerminal(task)) continue;
    const events = byTask.get(task.id) || [];
    const attempts = task.attempt_count || 0;
    const blocks = events.filter((e) => String(e.event).endsWith("-> blocked"));
    const escalations = events.filter((e) => String(e.event).endsWith("-> escalated"));
    if (attempts >= 2) {
      findings.push({
        task: task.id,
        pattern: "repeat-attempts",
        title: `Retro: ${task.id} needed ${attempts} attempts — ${task.title}`,
        observations: [
          `attempt_count = ${attempts}`,
          `status = ${task.status}`,
          ...blocks.slice(-3).map((e) => `${String(e.at).slice(0, 16)} ${e.actor}: ${e.detail || "(no detail)"}`),
        ],
        proposal: "Add a pre-flight check that would have caught the first failed attempt, then attach it to this task class.",
        check: `${task.id}: a repeat attempt records which check failed first and why`,
      });
    }
    if (blocks.length >= 2) {
      findings.push({
        task: task.id,
        pattern: "recurring-blockers",
        title: `Retro: ${task.id} was blocked ${blocks.length} times — ${task.title}`,
        observations: blocks.slice(-4).map((e) => `${String(e.at).slice(0, 16)} ${e.actor}: ${e.detail || "(no detail)"}`),
        proposal: "Find the shared cause across these blockers; if it is environmental, fix the environment (that is what /retro would do).",
        check: `${task.id}: the most recent blocker reason does not match any earlier blocker reason`,
      });
    }
    if (escalations.length >= 1) {
      findings.push({
        task: task.id,
        pattern: "escalation",
        title: `Retro: ${task.id} escalated to the owner — ${task.title}`,
        observations: escalations.map((e) => `${String(e.at).slice(0, 16)} ${e.actor}: ${e.detail || "(no detail)"}`),
        proposal: "Decide whether this escalation class deserves a durable owner gate (like approve) instead of ad-hoc escalation.",
        check: `escalations of class "${task.id}" have a documented owner decision`,
      });
    }
  }
  return findings;
}

function isRetroTerminal(task) {
  return ["done", "rejected", "archived"].includes(task.status);
}

// File one retro finding as a pending record (deduped by its title key,
// so re-running the scan never duplicates a retro ticket).
export function fileRetroFinding(root, finding) {
  return createRecord(root, {
    title: finding.title,
    kind: "retro",
    priority: "P1",
    evidence: "verified",
    people: [],
    concepts: ["retrospective", finding.pattern],
    sources: [],
    atl_impact: finding.proposal,
    objective: finding.proposal,
    checks: [finding.check],
    body: [
      `Observed on task ${finding.task} (pattern: ${finding.pattern}):`,
      "",
      ...finding.observations.map((o) => `- ${o}`),
      "",
      "## Proposed improvement",
      "",
      finding.proposal,
    ].join("\n"),
  });
}

// ---------- YouTube transcript ingestion (best-effort, honest failures)

// Fetches the watch page, finds a caption track, and returns timed cues.
// Throws ResearchError with the concrete reason when captions are unavailable.
export async function fetchYoutubeTranscript(rawUrl, { fetchImpl = fetch } = {}) {
  const id = youtubeId(rawUrl);
  if (!id) throw new ResearchError(`not a YouTube video url: ${rawUrl}`);
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
  };
  let page;
  try {
    const res = await fetchImpl(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    page = await res.text();
  } catch (err) {
    throw new ResearchError(`could not fetch the YouTube watch page (${err.message}) — transcript not saved`);
  }
  const title = decodeHtmlEntities(
    page.match(/<meta name="title" content="([^"]*)"/)?.[1]
    || page.match(/<title>([^<]*)<\/title>/)?.[1]
    || id
  );
  let tracks;
  try {
    const player = JSON.parse(extractJsonAfter(page, "ytInitialPlayerResponse"));
    tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) throw new Error("no caption tracks listed");
  } catch (err) {
    throw new ResearchError(`video "${title}" has no machine-readable caption track (${err.message}) — transcript not saved`);
  }
  const pick = tracks.find((t) => (t.languageCode || "").startsWith("en") && t.kind !== "asr")
    || tracks.find((t) => (t.languageCode || "").startsWith("en"))
    || tracks[0];
  if (!pick?.baseUrl) throw new ResearchError(`video "${title}" exposes no caption baseUrl — transcript not saved`);
  let cues;
  try {
    const res = await fetchImpl(pick.baseUrl + "&fmt=json3", { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse(await res.text());
    cues = (data.events || [])
      .filter((e) => Array.isArray(e.segs))
      .map((e) => ({
        start: (e.tStartMs || 0) / 1000,
        dur: (e.dDurationMs || 0) / 1000,
        text: e.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim(),
      }))
      .filter((c) => c.text);
  } catch (err) {
    throw new ResearchError(`caption fetch failed (${err.message}) — transcript not saved`);
  }
  if (!cues.length) throw new ResearchError("caption track was empty — transcript not saved");
  return { videoId: id, title: decodeHtmlEntities(title), language: pick.languageCode || "en", auto: pick.kind === "asr", cues };
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// Extract the balanced JSON object literal that follows a JS assignment
// marker in a page (e.g. `ytInitialPlayerResponse = {...};`), respecting
// strings and escapes so braces inside strings never end the scan early.
export function extractJsonAfter(page, marker) {
  const at = page.indexOf(marker);
  if (at < 0) throw new Error(`marker "${marker}" not found`);
  const start = page.indexOf("{", at);
  if (start < 0) throw new Error("no object literal after marker");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < page.length; i++) {
    const ch = page[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return page.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced object literal");
}

function fmtTs(sec) {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Save cues as json (machine) + md (readable, timestamped ~40s paragraphs),
// and link the transcript into the given record when provided.
export function saveTranscript(root, data, { recordId = null } = {}) {
  ensureDirs(root);
  const p = researchPaths(root);
  const base = `yt-${data.videoId}`;
  const jsonFile = path.join(p.transcripts, `${base}.json`);
  const mdFile = path.join(p.transcripts, `${base}.md`);
  const json = {
    version: RESEARCH_VERSION,
    video_id: data.videoId,
    title: data.title,
    language: data.language,
    auto_generated: !!data.auto,
    saved_at: new Date().toISOString(),
    cue_count: data.cues.length,
    cues: data.cues,
  };
  fs.writeFileSync(jsonFile, JSON.stringify(json, null, 2) + "\n");

  // Group cues into readable ~40 second blocks with [mm:ss] anchors.
  const blocks = [];
  let cur = null;
  for (const c of data.cues) {
    if (!cur || c.start - cur.start >= 40) {
      cur = { start: c.start, text: [] };
      blocks.push(cur);
    }
    cur.text.push(c.text);
  }
  const md = [
    `# Transcript — ${data.title}`,
    "",
    `video: https://www.youtube.com/watch?v=${data.videoId}`,
    `language: ${data.language}${data.auto ? " (auto-generated)" : ""} · cues: ${data.cues.length}`,
    "",
    ...blocks.map((b) => `[${fmtTs(b.start)}] ${b.text.join(" ")}`),
    "",
  ].join("\n");
  fs.writeFileSync(mdFile, md);

  const relPath = `research/transcripts/${base}.md`;
  if (recordId) {
    const rec = readRecord(root, recordId);
    if (rec) {
      rec.fields.transcript = relPath;
      rec.fields.decisions = [...(rec.fields.decisions || []), {
        at: new Date().toISOString(), actor: "manager", action: "transcript",
        note: `${data.cues.length} cues (${data.language})`,
      }];
      writeRecord(root, recordId, rec.body);
      const index = loadIndex(root);
      if (index.records[recordId]) index.records[recordId].transcript = relPath;
      saveIndex(root, index);
    }
  }
  return { json: jsonFile, markdown: mdFile, cues: data.cues.length, path: relPath };
}
