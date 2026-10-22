// history.mjs — the unified chat-history viewer for the agent CLIs on this machine.
//
// The provider (Z.ai, OpenAI, ...) only ever sees API traffic: usage, tokens,
// billing. The conversation itself is assembled client-side and kept in local
// session logs — Codex under ~/.codex/sessions, ZCode under ~/.zcode/cli/rollout.
// This module reads those logs read-only and turns them into one transcript,
// so `atl history` answers "what did I ask which agent, and what came back".
// No provider offers this view, and no provider needs a key for it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

export const HISTORY_SOURCES = [
  { id: "codex", label: "Codex", dir: (home) => path.join(home, ".codex", "sessions") },
  { id: "zcode", label: "ZCode CLI", dir: (home) => path.join(home, ".zcode", "cli", "rollout") },
];

// Synthetic context wraps every CLI injects (<environment_context>,
// <system-reminder>, <app-context>, ...). Real user prompts never start with "<".
const SYNTHETIC_USER = /^\s*</;

export function historySources(home = os.homedir()) {
  return HISTORY_SOURCES.map((s) => {
    const dir = s.dir(home);
    return { id: s.id, label: s.label, dir, available: fs.existsSync(dir) };
  });
}

// ---------- small read helpers (everything bounded, nothing loaded whole)

function firstLineOf(file, maxBytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(maxBytes, 4096));
    const { bytesRead } = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.toString("utf8", 0, bytesRead);
    const nl = text.indexOf("\n");
    return nl === -1 ? text : text.slice(0, nl);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function headLinesOf(file, wanted, maxBytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(maxBytes, 64 * 1024 * 1024));
    const { bytesRead } = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead).split("\n").slice(0, wanted);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function walkFiles(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, depth + 1, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function textOfContent(content, { imageNote = "[image]" } = {}) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    const isText = (block?.type === "text" || block?.type === "input_text" || block?.type === "output_text") && typeof block.text === "string";
    if (isText) parts.push(block.text);
    else if (block?.type === "image" || block?.type === "input_image") parts.push(imageNote);
  }
  return parts.join("\n");
}

function ageOf(iso) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "?";
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function sizeLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function localStamp(iso) {
  const d = new Date(iso || "");
  if (isNaN(d.getTime())) return "????-??-?? ??:??";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function clockStamp(iso) {
  const d = new Date(iso || "");
  if (isNaN(d.getTime())) return "??:??";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- codex (~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl)

function loadCodexTitles(home) {
  const map = new Map();
  const file = path.join(home, ".codex", "session_index.jsonl");
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    const j = parseLine(line);
    if (j?.id && j.thread_name) map.set(String(j.id), String(j.thread_name));
  }
  return map;
}

function codexMeta(file) {
  const j = parseLine(firstLineOf(file));
  const payload = j?.type === "session_meta" ? j.payload || {} : {};
  const idMatch = path.basename(file).match(/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return {
    id: payload.session_id || payload.id || (idMatch ? idMatch[1] : path.basename(file, ".jsonl")),
    startedAt: payload.timestamp || null,
    cwd: payload.cwd || null,
    originator: payload.originator || null,
    model: payload.model_provider || null,
  };
}

// ---------- zcode (~/.zcode/cli/rollout/model-io-sess_<uuid>.jsonl)

function zcodeHeadMeta(file) {
  const meta = { id: path.basename(file, ".jsonl").replace(/^model-io-/, ""), startedAt: null, cwd: null, originator: "ZCode", model: null, title: "" };
  for (const line of headLinesOf(file, 60)) {
    const j = parseLine(line);
    if (!j) continue;
    if (!meta.startedAt && (j.startedAt || j.completedAt)) meta.startedAt = j.startedAt || j.completedAt;
    if (!meta.model && j.model?.modelId) meta.model = j.model.modelId;
    if (!meta.title) {
      const deltas = j?.request?.messages || j?.request?.body?.messages || [];
      for (const m of deltas) {
        if (m?.role !== "user") continue;
        const text = textOfContent(m.content).replace(/\s+/g, " ").trim();
        if (text && !SYNTHETIC_USER.test(text)) {
          meta.title = text.slice(0, 80);
          break;
        }
      }
    }
    if (meta.startedAt && meta.model && meta.title) break;
  }
  return meta;
}

// ---------- public: list

export function listHistory({ home = os.homedir(), sources, limit = 20 } = {}) {
  const wanted = sources?.length ? sources.map((s) => String(s).toLowerCase()) : HISTORY_SOURCES.map((s) => s.id);
  const codexTitles = loadCodexTitles(home);
  const rows = [];
  for (const source of historySources(home).filter((s) => wanted.includes(s.id))) {
    for (const file of walkFiles(source.dir)) {
      if (!file.endsWith(".jsonl")) continue;
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const meta = source.id === "codex" ? codexMeta(file) : zcodeHeadMeta(file);
      rows.push({
        source: source.id,
        label: source.label,
        id: meta.id,
        file,
        title: (source.id === "codex" ? codexTitles.get(meta.id) : meta.title) || "",
        startedAt: meta.startedAt || stat.mtime.toISOString(),
        sizeBytes: stat.size,
        cwd: meta.cwd,
        originator: meta.originator,
        model: meta.model,
      });
    }
  }
  rows.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.file < b.file ? -1 : 1));
  return rows.slice(0, Math.max(1, limit)).map((r, i) => ({ ...r, n: i + 1 }));
}

export function resolveHistoryRef(rows, ref) {
  if (!rows.length) throw new Error("no sessions found — run `atl history` to see what is on this machine");
  const raw = String(ref || "").trim();
  if (!raw || raw === "latest" || raw === "last") return rows[0];
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const row = rows.find((r) => r.n === n);
    if (row) return row;
    throw new Error(`no session number ${n} — the list only goes up to ${rows[rows.length - 1].n}; raise it with --n`);
  }
  const needle = raw.toLowerCase();
  const hit = rows.find((r) => r.id.toLowerCase() === needle)
    || rows.find((r) => r.id.toLowerCase().startsWith(needle))
    || rows.find((r) => path.basename(r.file).toLowerCase().includes(needle));
  if (!hit) throw new Error(`no session matches "${raw}" — run \`atl history\` and use a number or an id prefix`);
  return hit;
}

// ---------- public: transcript

export async function readTranscript({ source, file, limit = 200, maxMessageChars = 600 } = {}) {
  const messages = [];
  const meta = {};
  let lastUserText = null;
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const j = parseLine(line);
    if (!j) continue;
    if (source === "codex") {
      if (j.type === "session_meta") {
        meta.cwd = j.payload?.cwd || null;
        meta.originator = j.payload?.originator || null;
        meta.model = j.payload?.model_provider || null;
        meta.startedAt = j.payload?.timestamp || null;
      }
      if (j.type !== "response_item" || j.payload?.type !== "message") continue;
      const role = j.payload.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = textOfContent(j.payload.content).trim();
      if (!text || (role === "user" && SYNTHETIC_USER.test(text))) continue;
      messages.push({ at: j.timestamp, role, text });
    } else {
      // Side calls (auto-titling, summaries) are not part of the conversation.
      if (j.querySource && j.querySource !== "main_turn") continue;
      if (!meta.startedAt && (j.startedAt || j.completedAt)) meta.startedAt = j.startedAt || j.completedAt;
      if (!meta.model && j.model?.modelId) meta.model = j.model.modelId;
      const deltas = j?.request?.messages || j?.request?.body?.messages || [];
      for (const m of deltas) {
        if (m?.role !== "user") continue;
        const text = textOfContent(m.content, { imageNote: "[image attached]" }).trim();
        if (!text || SYNTHETIC_USER.test(text)) continue;
        // Retries and re-driven turns re-send the previous user message as a
        // delta (sometimes re-serialized with different whitespace); showing
        // it again would read like the user repeated themselves.
        const normalized = text.replace(/\s+/g, " ");
        if (normalized === lastUserText) continue;
        lastUserText = normalized;
        messages.push({ at: j.startedAt || j.completedAt, role: "user", text });
      }
      if (j.error) {
        messages.push({ at: j.completedAt, role: "system", kind: "error", text: `${j.error.name || "error"}: ${j.error.message || ""}`.trim() });
      }
      const reply = j.response?.text;
      if (typeof reply === "string" && reply.trim()) {
        const usage = j.response.usage;
        messages.push({
          at: j.completedAt,
          role: "assistant",
          text: reply.trim(),
          tokens: usage?.inputTokens !== undefined && usage?.outputTokens !== undefined ? `${usage.inputTokens}→${usage.outputTokens}` : null,
        });
      }
    }
    if (messages.length >= limit) break;
  }
  rl.close();
  stream.destroy();
  return {
    source,
    file,
    id: path.basename(file, ".jsonl").replace(/^rollout-\d{4}-\d{2}-\d{2}T[\d-]+-/, "").replace(/^model-io-/, ""),
    startedAt: meta.startedAt || null,
    cwd: meta.cwd || null,
    originator: meta.originator || null,
    model: meta.model || null,
    truncated: messages.length >= limit,
    messages: messages.slice(0, limit).map((m) => ({
      ...m,
      text: m.text.length > maxMessageChars ? `${m.text.slice(0, maxMessageChars)}… (+${m.text.length - maxMessageChars} chars)` : m.text,
    })),
  };
}

// ---------- public: render

export function renderHistoryList(rows, { sources } = {}) {
  const lines = [
    "Agent chat history — local transcripts from the CLI session logs.",
    "Providers only ever see usage; the conversations live on this disk.",
    "",
  ];
  for (const s of sources || historySources()) {
    lines.push(`  ${s.available ? "✓" : "×"} ${s.id.padEnd(6)} ${s.dir}${s.available ? "" : "  (not found)"}`);
  }
  lines.push("");
  if (!rows.length) {
    lines.push("No sessions found yet. Chat in Codex or ZCode CLI, then re-run: atl history");
    return lines.join("\n");
  }
  for (const r of rows) {
    lines.push(`  ${String(r.n).padStart(3)}  ${localStamp(r.startedAt)}  ${r.source.padEnd(6)} ${r.title || "(untitled)"}`);
    lines.push(`       ${r.label} · ${sizeLabel(r.sizeBytes)} · ${ageOf(r.startedAt)}${r.model ? ` · ${r.model}` : ""}${r.id ? ` · id ${r.id.slice(0, 8)}` : ""}`);
  }
  lines.push("");
  lines.push("Open one: atl history show <number>   (or an id prefix; \"latest\" works too)");
  return lines.join("\n");
}

export function renderTranscript(t, { width = 100 } = {}) {
  const inner = Math.max(40, width - 16);
  const wrap = (text) => {
    const out = [];
    for (const rawLine of text.split("\n")) {
      let current = "";
      for (const word of rawLine.split(" ")) {
        if (current && `${current} ${word}`.length > inner) {
          out.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      out.push(current);
    }
    return out;
  };
  const lines = [
    `SESSION ${t.source} ${t.id.slice(0, 12)} · started ${localStamp(t.startedAt)}${t.model ? ` · ${t.model}` : ""}${t.originator ? ` · ${t.originator}` : ""}`,
    t.cwd ? `cwd ${t.cwd}` : "",
    "─".repeat(Math.min(width, 100)),
    "",
  ].filter(Boolean);
  for (const m of t.messages) {
    const who = m.role === "user" ? "you" : m.role === "assistant" ? "agent" : "!!";
    if (m.kind === "error") {
      lines.push(`  ${clockStamp(m.at)}  ${who}  ${m.text}`);
      lines.push("");
      continue;
    }
    const body = wrap(m.text);
    lines.push(`  ${clockStamp(m.at)}  ${who}  ${body[0] || ""}${m.tokens ? `   (${m.tokens} tok)` : ""}`);
    for (const extra of body.slice(1)) lines.push(`            ${extra}`);
    lines.push("");
  }
  if (t.truncated) lines.push(`(stopped after ${t.messages.length} messages — raise --n to read further back)`);
  if (!t.messages.length) lines.push("(no user/assistant messages in this log — only tool traffic or synthetic context)");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
