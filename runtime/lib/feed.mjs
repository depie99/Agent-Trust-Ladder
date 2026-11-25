// The team feed: a chat-style narration of everything the bots do.
// state.json is the machine's memory; feed.jsonl is the team's voice.
// Every runner command posts here in the acting bot's name, so following
// the team feels like reading the group chat.

import fs from "node:fs";
import path from "node:path";
import { paths } from "./state.mjs";

export const AVATARS = { mira: "🧭", pip: "📥", rowan: "🔨", sage: "🔍", beacon: "🌙", manager: "👤", runner: "⚙️" };
export const NAMES = { mira: "Mira", pip: "Pip", rowan: "Rowan", sage: "Sage", beacon: "Beacon", manager: "Manager", runner: "Runner" };

function feedFile(root) {
  return path.join(path.dirname(paths(root).state), "feed.jsonl");
}

const FEED_FILE_LIMIT = 2 * 1024 * 1024;
const FEED_ROTATIONS = 2;
function rotateFeed(file, incomingBytes = 0) {
  try { if (fs.statSync(file).size + incomingBytes <= FEED_FILE_LIMIT) return; }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  try { fs.rmSync(`${file}.${FEED_ROTATIONS}`, { force: true }); } catch { /* best effort */ }
  for (let index = FEED_ROTATIONS - 1; index >= 1; index--) {
    const older = `${file}.${index}`, newer = `${file}.${index + 1}`;
    if (fs.existsSync(older)) fs.renameSync(older, newer);
  }
  fs.renameSync(file, `${file}.1`);
}

// Append one message. Feed failures must never fail the command.
export function post(root, { from, text, task = null, kind = "message", status = null, detail = null }) {
  try {
    const line = {
      at: new Date().toISOString(), from: String(from || "runner").slice(0, 80), kind: String(kind || "message").slice(0, 40),
      text: String(text || "").slice(0, 12000), task: task == null ? null : String(task).slice(0, 120),
      status: status == null ? null : String(status).slice(0, 80), detail: detail == null ? null : String(detail).slice(0, 20000),
    };
    const file = feedFile(root), record = `${JSON.stringify(line)}\n`;
    rotateFeed(file, Buffer.byteLength(record));
    fs.appendFileSync(file, record);
  } catch (err) {
    /* narration is best-effort */
    if (process.env.ATL_DEBUG) console.error("[feed debug]", err && err.message);
  }
}

export function readFeed(root, { task = null, n = 100 } = {}) {
  const file = feedFile(root);
  const lines = [`${file}.${FEED_ROTATIONS}`, `${file}.1`, file].filter(name => fs.existsSync(name)).flatMap(name => fs.readFileSync(name, "utf8").split(/\r?\n/).filter(Boolean));
  const out = lines.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  const filtered = task ? out.filter((m) => m.task === task || m.kind === "card" && m.task === task) : out;
  return filtered.slice(-n);
}

function clockAt(iso) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toISOString().slice(0, 10);
}

const PAD = 8; // name column width

function line(from, text, indent = "") {
  const who = `${NAMES[from] || from} ${AVATARS[from] || "·"}`;
  return `${indent}${who.padEnd(PAD + 3)}${text}`;
}

// Render the transcript the way a chat client would.
export function renderFeed(root, { task = null, n = 100 } = {}) {
  const messages = readFeed(root, { task, n });
  if (messages.length === 0) {
    return task ? `No feed messages for ${task} yet.` : "The feed is quiet. Nothing has happened yet.";
  }
  const roster =
    "the team — Mira 🧭 coordinator · Pip 📥 intake + triage · Rowan 🔨 builder · Sage 🔍 reviewer · Beacon 🌙 night watch";
  const out = [task ? `feed for ${task}` : roster, ""];
  let lastDay = "";
  for (const m of messages) {
    const day = dayLabel(m.at);
    if (day !== lastDay) {
      out.push(`  ${day} ${clockAt(m.at)}`);
      out.push("  ──────────────────────────────");
      lastDay = day;
    }
    if (m.kind === "card") {
      out.push(line(m.from, m.text));
      out.push(`  ${" ".repeat(PAD + 3)}● ${m.task}: ${m.status}${m.detail ? `\n  ${" ".repeat(PAD + 3)}▸ ${m.detail}` : ""}`);
    } else {
      out.push(line(m.from, m.text));
    }
    if (m.detail && m.kind !== "card") out.push(`  ${" ".repeat(PAD + 3)}${m.detail}`);
  }
  return out.join("\n");
}

export function renderRoster(routing) {
  const t = routing && routing.team ? routing.team : {};
  const L = [];
  const name = t.manager ? `${t.manager.name} ${AVATARS.mira}` : `Mira ${AVATARS.mira}`;
  L.push(`${name}  ${t.manager ? t.manager.role : "coordinator / chief of staff"}`);
  for (const r of t.roster || []) {
    const av = AVATARS[r.name.toLowerCase()] || "·";
    L.push(`${r.name} ${av}  ${r.role} — ${r.purpose}`);
  }
  return L.join("\n");
}
