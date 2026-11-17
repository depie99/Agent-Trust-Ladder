#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && file.endsWith(".mjs")) files.push(file);
  }
}
walk(path.join(root, "runtime"));
const missing = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const specifiers = [...source.matchAll(/(?:from\s*|import\s*\(|^\s*import\s*)["'](\.{1,2}\/[^"']+)["']/gm)].map((match) => match[1]);
  for (const specifier of specifiers) {
    const target = path.resolve(path.dirname(file), specifier);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) missing.push(`${path.relative(root, file)} -> ${specifier}`);
  }
}
if (missing.length) {
  console.error("Missing relative runtime imports:");
  for (const item of missing) console.error(`  ${item}`);
  process.exitCode = 1;
} else console.log(`Relative runtime imports resolved (${files.length} modules).`);
