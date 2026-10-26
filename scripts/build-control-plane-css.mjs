// Build the Control Plane UI stylesheet: compile runtime/scss/control-plane.scss
// and inline it into runtime/control-plane.html, keeping the app a single
// self-contained file at runtime. Run from the repo root:
//   npm run ui:css        rebuild
//   npm run ui:css:check  fail if the inlined stylesheet is stale
import { compile } from "sass";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const check = process.argv.includes("--check");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "runtime", "scss", "control-plane.scss");
const htmlFile = path.join(root, "runtime", "control-plane.html");

// The html declares <meta charset="utf-8">, so the @charset rule sass emits
// for the ☼/☾ glyph content is dropped (it would be ignored inline anyway).
let css = compile(entry, { sourceMap: false }).css;
css = css.replace(/^@charset "UTF-8";\n/, "");

const html = fs.readFileSync(htmlFile, "utf8");
const styleBlocks = html.match(/<style>[\s\S]*?<\/style>/g) ?? [];
if (styleBlocks.length !== 1) {
  console.log(`FAIL: expected exactly 1 <style> block in control-plane.html, found ${styleBlocks.length}`);
  process.exit(1);
}
const nextHtml = html.replace(/<style>[\s\S]*?<\/style>/, `<style>\n${css.trimEnd()}\n</style>`);

if (check) {
  if (html !== nextHtml) {
    console.log("FAIL: control-plane.html stylesheet is stale — run: npm run ui:css");
    process.exit(1);
  }
  console.log("ALL OK: control-plane.html stylesheet matches runtime/scss source");
} else {
  fs.writeFileSync(htmlFile, nextHtml);
  console.log(`inlined ${css.length} bytes of compiled CSS into control-plane.html`);
}
