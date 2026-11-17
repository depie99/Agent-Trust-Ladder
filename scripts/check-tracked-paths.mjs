#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const stagedOnly = process.argv.includes("--staged");
const run = (args, input = undefined) => {
  const result = spawnSync("git", args, { encoding: input === undefined ? "buffer" : "utf8", input, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `git ${args[0]} failed`);
  return result.stdout;
};
const runOptional = (args) => spawnSync("git", args, { encoding: "buffer", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
const nul = (buffer) => Buffer.from(buffer).toString("utf8").split("\0").filter(Boolean);
const forbidden = [
  /(^|\/)\.trust\/manager(?:\/|$)/i,
  /(^|\/)\.trust\/live-[^/]+/i,
  /(^|\/)\.trust\/[^/]+-result\.json$/i,
  /(^|\/)\.trust\/specs\/[^/]+\/evidence(?:\/|$)/i,
  /(^|\/)\.trust\/browser-[^/]+(?:\/|$)/i,
  /(^|\/)\.atl(?:\/|$)/i,
  /(^|\/)\.atl-evidence(?:\/|$)/i,
  /(^|\/)\.humanlayer(?:\/|$)/i,
  /(^|\/)\.tmp-[^/]+(?:\/|$)/i,
  /(^|\/)(?:owner-session\.json|providers\.json|\.env(?:\..*)?)$/i,
];
const profilePath = /[a-z]:[\\/]+users[\\/]+(?!you(?:[\\/]|$)|public(?:[\\/]|$)|default(?:[\\/]|$))[^\\/\s"']+[\\/]+(?:appdata|desktop|documents|downloads|\.atl|\.codex|\.claude|\.npmrc)(?:[\\/]|\b)/i;
const sharingLink = /https?:\/\/(?:www\.)?mega\.(?:nz|io)\/(?:file|folder)\/[^\s"'<>]+/i;

const stagedNames = stagedOnly ? nul(run(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])) : null;
const indexEntries = nul(run(["ls-files", "--stage", "-z"]));
const selected = new Set(stagedOnly ? stagedNames : indexEntries.map((entry) => entry.slice(entry.indexOf("\t") + 1)));
const violations = [];
const blobForPath = new Map();
for (const entry of indexEntries) {
  const tab = entry.indexOf("\t");
  const header = entry.slice(0, tab).split(" ");
  const name = entry.slice(tab + 1);
  if (!selected.has(name)) continue;
  const normalized = name.replaceAll("\\", "/");
  if (forbidden.some((pattern) => pattern.test(normalized))) {
    violations.push(`${name}: runtime or credential path`);
    continue;
  }
  if (header.length >= 3 && header[2] === "0") blobForPath.set(name, header[1]);
}
const candidates = runOptional(["grep", "--cached", "-I", "-l", "-z", "-E", String.raw`[A-Za-z]:[\\/]+Users[\\/]+[^\\/[:space:]]+[\\/]+(AppData|Desktop|Documents|Downloads|\.atl|\.codex|\.claude|\.npmrc)|https?://(www\.)?mega\.(nz|io)/(file|folder)/`, "--"]);
if (candidates.error || (candidates.status !== 0 && candidates.status !== 1)) throw new Error(candidates.error?.message || "git grep failed");
for (const name of nul(candidates.stdout)) {
  if (!selected.has(name) || !blobForPath.has(name)) continue;
  const bytes = run(["cat-file", "blob", blobForPath.get(name)]);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  if (profilePath.test(text)) violations.push(`${name}: real Windows profile path`);
  if (sharingLink.test(text)) violations.push(`${name}: file-sharing link`);
}
if (violations.length) {
  console.error("Refusing tracked data that may expose local runtime state or private data:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Tracked-path/content guard passed (${selected.size} ${stagedOnly ? "staged" : "indexed"} paths).`);
}
