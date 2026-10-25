// Docs-site integrity checks. Run from the repo root: node scripts/check_docs.mjs
//
// Covers the checks the docs sync anchor claims: balanced tags, link/anchor
// targets that resolve, and one shared Documentation nav across pages.
// Exit code 1 on any failure.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const PAGES = ["index.html", "skills.html", "guides.html", "control-room.html", "team.html", "jev.html", "reference.html", "diagrams.html", "codex-history-bridge.html"];
const PAIRED = ["section", "div", "figure", "figcaption", "aside", "nav", "main", "header", "footer", "table", "button", "a", "pre", "code", "b", "span", "h1", "h2", "h3", "dialog", "form", "article"];
let failures = 0;
const fail = (message) => { failures += 1; console.log("FAIL:", message); };

for (const page of PAGES) {
  const file = path.join(docsDir, page);
  if (!fs.existsSync(file)) { fail(`${page}: missing`); continue; }
  const html = fs.readFileSync(file, "utf8");

  // 1. Paired-tag balance (void elements excluded).
  const stack = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*)?>/g;
  for (const match of html.matchAll(re)) {
    const tag = match[1].toLowerCase();
    if (!PAIRED.includes(tag)) continue;
    if (match[0].endsWith("/>")) continue;
    if (match[0][1] === "/") {
      const top = stack.pop();
      if (top !== tag) { fail(`${page}: </${tag}> closes <${top || "nothing"}> (line ${html.slice(0, match.index).split("\n").length})`); }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length) fail(`${page}: unclosed tags ${[...new Set(stack)].join(", ")}`);

  // 2. Local href/src targets resolve (query strings stripped; #anchor checked in-page).
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = match[1];
    if (raw.startsWith("http") || raw.startsWith("mailto:")) continue;
    const [rawTarget, hash] = raw.split("#");
    const target = rawTarget.split("?")[0];
    if (target && !fs.existsSync(path.join(docsDir, target))) fail(`${page}: broken target ${raw}`);
    if (hash) {
      const host = target || page;
      let hostHtml = html;
      if (target) hostHtml = fs.readFileSync(path.join(docsDir, target), "utf8");
      if (!hostHtml.includes(`id="${hash}"`) && !hostHtml.includes(`name="${hash}"`)) fail(`${page}: missing #${hash} in ${host}`);
    }
  }

  // 3. Every page shares one Documentation nav (ordered page ids).
  const navOrder = [...html.matchAll(/<nav class="nav-list">([\s\S]*?)<\/nav>/g)]
    .map((m) => [...m[1].matchAll(/href="([a-z-]+\.html)/g)].map((n) => n[1]))
    .find((links) => links.includes("team.html"));
  if (!navOrder) { fail(`${page}: documentation nav not found`); }
  else {
    const expected = ["skills.html", "guides.html", "control-room.html", "team.html", "jev.html", "reference.html", "diagrams.html"];
    const docNav = navOrder.filter((l) => expected.includes(l));
    if (JSON.stringify(docNav) !== JSON.stringify(expected)) fail(`${page}: doc nav is ${docNav.join(",")}`);
  }
}

// 4. Generated TUI images referenced by the pages exist and carry dimensions.
for (const name of ["tui-dashboard", "tui-compose", "tui-review", "tui-queue", "tui-launch", "tui-run", "tui-providers"]) {
  const file = path.join(docsDir, "diagrams", `${name}.svg`);
  if (!fs.existsSync(file)) { fail(`diagrams/${name}.svg missing`); continue; }
  const svg = fs.readFileSync(file, "utf8");
  if (!/^<svg[^>]*width="\d+" height="\d+"/.test(svg)) fail(`diagrams/${name}.svg: no intrinsic width/height`);
}

// Browser Control Plane visual is source-owned SVG and must remain directly
// previewable by GitHub Pages, just like the generated terminal figures.
const webControlPlane = path.join(docsDir, "diagrams", "atl-web-control-plane.svg");
if (!fs.existsSync(webControlPlane)) fail("diagrams/atl-web-control-plane.svg missing");
else {
  const svg = fs.readFileSync(webControlPlane, "utf8");
  if (!/^<svg[^>]*width="\d+" height="\d+"/.test(svg)) fail("diagrams/atl-web-control-plane.svg: no intrinsic width/height");
  if (!svg.includes("<title") || !svg.includes("<desc")) fail("diagrams/atl-web-control-plane.svg: missing accessible title/description");
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("ALL OK: tags balanced, links resolve, navs consistent, TUI images intact");
