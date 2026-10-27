// scripts/intel-brief.mjs — the daily ATL Agent Intelligence Brief.
//
// Pulls the watched sources (research/sources.json), dedupes everything
// against the cumulative evidence index, files genuinely new items as
// pending research records, and writes research/briefs/<date>.md with
// source health and backlog movement. Network failures are recorded in
// the brief, never faked: a source that could not be fetched says so.
//
//   node scripts/intel-brief.mjs             # fetch sources + write brief
//   node scripts/intel-brief.mjs --offline   # re-render brief from the index
//
// Designed to be idempotent: re-running files nothing twice (canonical-url
// and title dedup keys), so schedules and humans can both invoke it.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ResearchError, loadSources, saveSources, loadIndex, saveIndex,
  createRecord, listRecords, researchPaths, canonicalUrl,
} from "../runtime/lib/research.mjs";

const TIMEOUT_MS = 20000;

function rootFrom(argv) {
  const at = argv.indexOf("--project");
  return at >= 0 ? path.resolve(argv[at + 1]) : process.cwd();
}

async function get(url, { headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": "atl-intel-brief/0.1 (local research pipeline)", accept: "*/*", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// Minimal RSS 2.0 + Atom item extraction (regex-level, zero-dep, good
// enough for well-formed feeds; malformed feeds fail loudly per source).
export function parseFeedItems(xml, { baseUrl = "" } = {}) {
  const items = [];
  const blocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g),
  ];
  for (const b of blocks) {
    const block = b[0];
    const pick = (re) => {
      const m = block.match(re);
      if (!m) return "";
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
    };
    const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] || pick(/<link>([\s\S]*?)<\/link>/);
    items.push({
      title: pick(/<title[^>]*>([\s\S]*?)<\/title>/),
      url: link ? new URL(link, baseUrl || undefined).toString() : "",
      published: pick(/<pubDate>([\s\S]*?)<\/pubDate>/) || pick(/<published>([\s\S]*?)<\/published>/) || pick(/<updated>([\s\S]*?)<\/updated>/),
    });
  }
  return items.filter((i) => i.title || i.url);
}

function toDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchGithubReleases(source) {
  const res = await get(`https://api.github.com/repos/${source.repo}/releases?per_page=10`,
    { headers: { accept: "application/vnd.github+json" } });
  const rels = JSON.parse(await res.text());
  return rels
    .filter((r) => !r.draft)
    .map((r) => ({
      title: r.name || r.tag_name,
      url: r.html_url,
      published: toDate(r.published_at),
      kind: "release",
      body: [
        `Tag: ${r.tag_name} · author: ${r.author?.login || "unknown"}`,
        "",
        (r.body || "").slice(0, 1200),
      ].join("\n"),
    }));
}

async function resolveChannelId(source) {
  if (source.channel_id) return source.channel_id;
  if (!source.handle) throw new Error("youtube_channel source needs channel_id or handle");
  const res = await get(`https://www.youtube.com/@${String(source.handle).replace(/^@/, "")}/videos`);
  const page = await res.text();
  const channelId = page.match(/"(UC[\w-]{22})"/)?.[1];
  if (!channelId) throw new Error("could not resolve the channel id from the channel page");
  return channelId;
}

async function fetchYoutubeChannel(source) {
  const channelId = await resolveChannelId(source);
  source.channel_id = channelId; // cached for next run
  const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const xml = await res.text();
  return parseFeedItems(xml).map((item) => {
    const id = item.url.match(/[?&]v=([\w-]{11})/)?.[1];
    return {
      title: item.title,
      url: id ? `https://www.youtube.com/watch?v=${id}` : canonicalUrl(item.url),
      published: toDate(item.published),
      kind: "video",
    };
  });
}

async function fetchFeed(source) {
  const res = await get(source.url);
  const xml = await res.text();
  return parseFeedItems(xml, { baseUrl: source.url }).map((item) => ({
    title: item.title,
    url: item.url,
    published: toDate(item.published),
    kind: source.kind || "post",
  }));
}

// Page monitor: a source we cannot parse into items (JS-rendered archives,
// dashboards). Hash the visible text; when it changes, file a review note.
async function fetchPage(source) {
  const res = await get(source.url);
  const html = await res.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || source.id;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(text.slice(0, 100000)).digest("hex").slice(0, 32);
  const changed = source.last_hash && source.last_hash !== hash;
  const firstLook = !source.last_hash;
  source.last_hash = hash;
  if (firstLook) return { items: [], note: "baseline captured (no record filed)" };
  if (!changed) return { items: [], note: "unchanged" };
  return {
    items: [{
      title: `Source changed: ${title}`,
      url: source.url,
      published: new Date().toISOString().slice(0, 10),
      kind: "note",
      body: [
        "The page monitor for this source saw its content change since the last run.",
        "Open the source and file a proper research record if the change matters to ATL.",
        "",
        `Page title: ${title}`,
      ].join("\n"),
    }],
    note: "content changed — review note filed",
  };
}

const FETCHERS = {
  github_releases: fetchGithubReleases,
  youtube_channel: fetchYoutubeChannel,
  rss: fetchFeed,
  atom: fetchFeed,
  page: fetchPage,
};

// Pull one source; returns { status: "ok"|"failed"|"skipped", note, items }.
export async function checkSource(source, { fetchers = FETCHERS } = {}) {
  if (source.enabled === false) return { status: "skipped", note: "disabled" };
  if (source.requires_auth) return { status: "skipped", note: "requires authenticated access (not configured)" };
  const fetcher = fetchers[source.type];
  if (!fetcher) return { status: "failed", note: `unknown source type "${source.type}"` };
  try {
    const out = await fetcher(source);
    return { status: "ok", note: out.note || `${out.items.length} item(s)`, items: out.items || [] };
  } catch (err) {
    return { status: "failed", note: err.message };
  }
}

function defaultPriorityFor(source) {
  return source.priority || "P2";
}

// Run the whole pipeline. Returns a summary object used by the brief writer.
export async function runBriefScan(root, { fetchers = FETCHERS } = {}) {
  const store = loadSources(root);
  const index = loadIndex(root);
  const since = index.last_brief_at;
  const perSource = [];
  const filed = [];
  const skippedUrls = [];

  for (const source of store.sources || []) {
    const check = await checkSource(source, { fetchers });
    const newItems = [];
    if (check.status === "ok") {
      for (const item of check.items || []) {
        if (since && item.published && since.slice(0, 10) > item.published) {
          skippedUrls.push(item.url);
          continue; // published before our last look — not new to us
        }
        try {
          const rec = createRecord(root, {
            title: item.title,
            kind: item.kind || source.kind || "post",
            priority: defaultPriorityFor(source),
            people: source.people || [],
            sources: [item.url],
            published: item.published || null,
            evidence: source.evidence || "second-hand",
            atl_impact: "",
            body: item.body || `Captured automatically from ${source.id}.\n\nSource: ${item.url}`,
          });
          newItems.push(rec.fields.id);
          filed.push({ id: rec.fields.id, title: item.title, source: source.id });
        } catch (err) {
          if (!(err instanceof ResearchError) || !err.existingId) {
            perSource.push({ id: source.id, status: "failed", note: `record: ${err.message}`, items: 0 });
          }
          // already-captured items are the normal dedup path — ignore
        }
      }
    }
    source.last_checked = new Date().toISOString();
    source.last_result = `${check.status}: ${check.note}`;
    perSource.push({ id: source.id, type: source.type, status: check.status, note: check.note, items: newItems.length });
  }

  saveSources(root, store);
  return { perSource, filed, skipped: skippedUrls.length, ran_at: new Date().toISOString() };
}

function fmtRecordLine(rec) {
  return `- **${rec.id}** — ${rec.title}\n  ${rec.priority} · ${rec.kind} · evidence: ${rec.evidence} · status: ${rec.status}` +
    (rec.sources[0] ? ` · [source](${rec.sources[0]})` : "");
}

export function renderBrief(root, scan, { offline = false } = {}) {
  const index = loadIndex(root);
  const lines = [];
  lines.push(`# ATL Agent Intelligence Brief — ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`Run: ${scan.ran_at}${offline ? " · **offline re-render**" : ""} · index: ${index.stats.total} record(s), ` +
    `${Object.entries(index.stats.byStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  lines.push("");
  lines.push("## Source sweep");
  lines.push("");
  lines.push("| source | type | result | new records |");
  lines.push("|---|---|---|---|");
  for (const s of scan.perSource) {
    lines.push(`| ${s.id} | ${s.type || "—"} | ${s.status}: ${s.note} | ${s.items || 0} |`);
  }
  lines.push("");
  if (scan.filed.length) {
    lines.push(`## Newly captured (${scan.filed.length})`);
    lines.push("");
    const index2 = loadIndex(root);
    for (const f of scan.filed) {
      const rec = index2.records[f.id];
      if (rec) lines.push(fmtRecordLine(rec));
    }
    lines.push("");
    lines.push("New captures are drafts (evidence: second-hand). Read, assess, set a priority with `atl research set <id> --set priority=P0 --set atl_impact=...`, then promote.");
    lines.push("");
  } else {
    lines.push("## Newly captured");
    lines.push("");
    lines.push("Nothing new passed dedup since the last brief.");
    lines.push("");
  }
  const pending = listRecords(root, { status: "pending" });
  if (pending.length) {
    lines.push(`## Open review queue (${pending.length} pending)`);
    lines.push("");
    for (const r of pending) lines.push(fmtRecordLine(r));
    lines.push("");
  }
  const promoted = listRecords(root, { status: "promoted" });
  if (promoted.length) {
    lines.push("## Promoted to the backlog");
    lines.push("");
    for (const r of promoted) {
      lines.push(`- **${r.id}** → ${r.tickets.join(", ")} — ${r.title}`);
    }
    lines.push("");
  }
  const gaps = (loadSources(root).sources || []).filter((s) => s.requires_auth || s.enabled === false);
  if (gaps.length) {
    lines.push("## Known gaps");
    lines.push("");
    for (const g of gaps) {
      lines.push(`- ${g.id}: ${g.requires_auth ? "needs authenticated access (not configured)" : "disabled"}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("Priority rules — P0 architectural (delegation, queues, recovery, memory) · P1 engineering (skills, SDD/TDD, reviews, observability) · P2 inspiration.");
  lines.push("");
  return lines.join("\n");
}

export function writeBrief(root, scan, opts = {}) {
  const p = researchPaths(root);
  fs.mkdirSync(p.briefs, { recursive: true });
  const file = path.join(p.briefs, `${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(file, renderBrief(root, scan, opts));
  const index = loadIndex(root);
  index.last_brief_at = scan.ran_at;
  saveIndex(root, index);
  return file;
}

export async function main(argv = process.argv.slice(2)) {
  const root = rootFrom(argv);
  const offline = argv.includes("--offline");
  const scan = offline
    ? { perSource: [{ id: "(offline)", type: "—", status: "ok", note: "index re-render only", items: 0 }], filed: [], skipped: 0, ran_at: new Date().toISOString() }
    : await runBriefScan(root);
  const file = writeBrief(root, scan, { offline });
  console.log(`Brief written: ${file}`);
  for (const s of scan.perSource) console.log(`  ${s.status.padEnd(7)} ${s.id} — ${s.note}`);
  if (scan.filed.length) {
    console.log(`  filed ${scan.filed.length} new record(s): ${scan.filed.map((f) => f.id).join(", ")}`);
  }
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
