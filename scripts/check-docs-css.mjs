// Fails when docs/site.css is stale relative to docs/scss/styles.scss.
// Companion to scripts/check_docs.mjs (HTML integrity). Run from the repo
// root: npm run docs:css:check — or rebuild with npm run docs:css.
import { compile } from "sass";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "docs", "scss", "styles.scss");
const target = path.join(root, "docs", "site.css");

const expected = compile(entry, { sourceMap: false }).css.trimEnd();
const actual = fs.readFileSync(target, "utf8").trimEnd();

if (actual !== expected) {
  console.log("FAIL: docs/site.css is stale — run: npm run docs:css");
  process.exit(1);
}
console.log("ALL OK: docs/site.css matches docs/scss source");
