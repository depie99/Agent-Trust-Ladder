// Local, revision-aware navigation index. It is deliberately a hint service:
// callers must read authoritative source before changing it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const VERSION = 1;
const SUPPORTED = new Map([[".js", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"], [".ts", "typescript"], [".tsx", "typescript"]]);
const EXCLUDED = new Set(["node_modules", ".git", ".trust", "dist", "build", "coverage"]);
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const mapFile = (root) => path.join(root, ".trust", "manager", "navigation", "current.json");
const lineOf = (text, offset) => text.slice(0, offset).split("\n").length;
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");

function walk(root, dir = root, rows = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".eslintrc") continue;
    if (entry.isDirectory()) { if (!EXCLUDED.has(entry.name)) walk(root, path.join(dir, entry.name), rows); continue; }
    if (entry.isFile() && SUPPORTED.has(path.extname(entry.name).toLowerCase())) rows.push(path.join(dir, entry.name));
  }
  return rows;
}

function git(root, args) { try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { return null; } }

function parseFile(root, file) {
  const text = fs.readFileSync(file, "utf8");
  const rel = relative(root, file), fileDigest = digest(text), symbols = [], relations = [];
  // Syntax-level only: this intentionally does not claim dynamic calls resolve.
  const declarations = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (let match; (match = declarations.exec(text)); ) {
    const name = match[1], startLine = lineOf(text, match.index), next = text.indexOf("\n", match.index + match[0].length);
    symbols.push({ id: `${rel}:${name}:${startLine}`, qualifiedName: name, kind: /class|interface/.test(match[0]) ? "type" : "symbol", path: rel, startLine, endLine: next < 0 ? startLine : lineOf(text, next), fileDigest });
  }
  const imports = /(?:import\s+(?:[\s\S]*?)\s+from\s+|require\s*\()['"]([^'"]+)['"]/g;
  for (let match; (match = imports.exec(text)); ) {
    const specifier = match[1];
    let target = specifier;
    if (specifier.startsWith(".")) {
      const base = path.resolve(path.dirname(file), specifier);
      const options = [base, ...[".js", ".mjs", ".cjs", ".ts", ".tsx"].map((ext) => `${base}${ext}`)];
      const resolved = options.find((candidate) => fs.existsSync(candidate));
      if (resolved) target = relative(root, resolved);
    }
    relations.push({ from: rel, to: target, kind: "imports", resolution: "parser", evidenceLocation: { path: rel, startLine: lineOf(text, match.index), endLine: lineOf(text, match.index + match[0].length) } });
  }
  return { file: { path: rel, digest: fileDigest, language: SUPPORTED.get(path.extname(file).toLowerCase()), parseStatus: "partial" }, symbols, relations };
}

export function buildMap(root) {
  const files = [], symbols = [], relations = [], unresolved = [];
  for (const file of walk(root)) {
    try { const row = parseFile(root, file); files.push(row.file); symbols.push(...row.symbols); relations.push(...row.relations); }
    catch (error) { unresolved.push({ path: relative(root, file), reason: error.message }); }
  }
  const manifest = files.map((f) => `${f.path}:${f.digest}`).sort().join("\n");
  const snapshot = { schemaVersion: VERSION, repositoryId: git(root, ["config", "--get", "remote.origin.url"]) || path.resolve(root), worktreeId: path.resolve(root), commit: git(root, ["rev-parse", "HEAD"]), sourceManifestDigest: digest(manifest), parserVersion: "atl-js-regex-1", configurationDigest: digest(JSON.stringify([...SUPPORTED])), snapshotId: digest(`${path.resolve(root)}:${manifest}:atl-js-regex-1`).slice(0, 24), createdAt: new Date().toISOString(), files, symbols, relations, unresolved };
  const target = mapFile(root); fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`; fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2) + "\n"); fs.renameSync(temp, target);
  return snapshot;
}

export function loadMap(root) { const file = mapFile(root); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null; }
export function mapStatus(root) { const map = loadMap(root); return map ? { status: map.unresolved.length ? "PARTIAL" : "READY", snapshot_id: map.snapshotId, coverage: { files: map.files.length, symbols: map.symbols.length, unresolved: map.unresolved.length }, unknowns: map.unresolved } : { status: "MISSING", snapshot_id: null, coverage: null, unknowns: ["No map built; use scoped search or atl map build."] }; }
export function queryMap(root, symbol, limit = 20) { const map = loadMap(root); if (!map) return { status: "MISSING", snapshot_id: null, results: [], unknowns: ["No map built"] }; const all = map.symbols.filter((item) => item.qualifiedName.toLowerCase().includes(String(symbol).toLowerCase())); return { status: map.unresolved.length ? "PARTIAL" : "READY", snapshot_id: map.snapshotId, results: all.slice(0, limit), truncated: all.length > limit, continuation: all.length > limit ? String(limit) : null, unknowns: map.unresolved }; }
export function neighbors(root, symbolId, limit = 20) { const map = loadMap(root); if (!map) return { status: "MISSING", results: [], unknowns: ["No map built"] }; const symbol = map.symbols.find((item) => item.id === symbolId); if (!symbol) return { status: "PARTIAL", results: [], unknowns: ["Unknown symbol id"] }; const rows = map.relations.filter((item) => item.from === symbol.path || item.to === symbol.path).slice(0, limit); return { status: map.unresolved.length ? "PARTIAL" : "READY", snapshot_id: map.snapshotId, results: rows, truncated: map.relations.filter((item) => item.from === symbol.path || item.to === symbol.path).length > limit, continuation: null, unknowns: map.unresolved }; }

export function assembleContext(root, { taskId = "ad-hoc", query = "", maxTokens = 800, constraints = [] } = {}) {
  const map = loadMap(root); if (!map) return { taskId, snapshotId: null, locations: [], unknowns: ["Navigation map is unavailable; use scoped text search and read source directly."], truncated: false, continuation: null, tokenCount: 0, tokenCountMethod: "estimate" };
  const terms = String(query).toLowerCase().split(/[^a-z0-9_$]+/).filter((v) => v.length > 2);
  const ranked = map.symbols.map((item) => ({ item, score: terms.reduce((n, term) => n + (item.qualifiedName.toLowerCase().includes(term) ? 3 : 0) + (item.path.toLowerCase().includes(term) ? 1 : 0), 0) })).filter((row) => row.score).sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));
  const cap = Math.max(1, Math.floor(maxTokens / 35)); const chosen = ranked.slice(0, cap);
  return { taskId, snapshotId: map.snapshotId, constraints, locations: chosen.map(({ item }) => ({ path: item.path, startLine: item.startLine, endLine: item.endLine, fileDigest: item.fileDigest, reason: "symbol/path match" })), verificationCommands: [], evidenceRefs: [mapFile(root)], unknowns: ["Syntax-level index: imports are partial; dynamic calls and unsupported files require scoped search."], truncated: ranked.length > chosen.length, continuation: ranked.length > chosen.length ? String(chosen.length) : null, tokenCount: chosen.length * 35, tokenCountMethod: "estimate" };
}

export function renderNavigationContext(packet) {
  if (!packet.snapshotId) return "";
  const locations = packet.locations.map((l) => `- ${l.path}:${l.startLine}-${l.endLine} (${l.reason})`).join("\n") || "- no confident locations";
  return `\n## Navigation hints (not source authority)\nSnapshot: ${packet.snapshotId}${packet.truncated ? " (truncated)" : ""}\n${locations}\nBefore editing, read the exact current source range; use scoped search for dynamic or missing relationships.\n`;
}
