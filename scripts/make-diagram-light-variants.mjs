// Generate light variants of the documentation diagrams so the control-plane
// artwork matches the Control Plane's light theme. Source of truth stays the
// dark SVG; this script applies an explicit per-file color map and fails on
// any unmapped color, so a palette change can never silently drift.
//
//   npm run docs:diagrams          regenerate *.light.svg
//   npm run docs:diagrams:check    fail if a variant is stale
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const check = process.argv.includes("--check");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "docs", "diagrams");

// Dark color -> light color, keyed per source file. Light values mirror the
// Control Plane light tokens (runtime/scss/themes/_light.scss).
const PALETTES = {
  "atl-web-control-plane.svg": {
    // canvas + app surfaces
    "#0d0e14": "#f2f5f9",
    "#14151f": "#ffffff",
    "#323449": "#cfd9e4",
    "#10111a": "#e9eef5",
    // ink
    "#f0eff8": "#17212e",
    "#8c8da2": "#5c6b7d",
    "#c8c7d4": "#46586c",
    "#9c9db0": "#5c6b7d",
    // neutral workflow nodes + arrows
    "#1c1e2b": "#ffffff",
    "#565872": "#b0bfce",
    "#777a91": "#8fa3b8",
    // mint (active nav, bounded run, local-only bar)
    "#1a3a31": "#e2f3ed",
    "#61e0b2": "#0c7d62",
    "#7ee8c0": "#0c7d62",
    "#a9d6c5": "#4e7c6f",
    "#111c1b": "#e3f6ef",
    "#376a5b": "#9fd4c4",
    "#8ee8c6": "#0c7d62",
    // blue (preview)
    "#172c38": "#e8f0fb",
    "#59aeca": "#2f6bc4",
    "#b6e3fa": "#2f6bc4",
    "#9fc4d6": "#5c6b7d",
    // amber (confirm)
    "#3b2d16": "#fdf3dd",
    "#e0ae55": "#dcbd7e",
    "#f7cd7b": "#9a6709",
    "#e2c58f": "#a9802e",
    // violet (evidence / recovery)
    "#202036": "#efecfb",
    "#a990e9": "#c3b9f2",
    "#d3c4ff": "#7a4fd3",
    "#b9adda": "#7a6bb0",
  },
};

let failures = 0;
for (const [source, map] of Object.entries(PALETTES)) {
  const src = path.join(dir, source);
  const out = path.join(dir, source.replace(/\.svg$/, ".light.svg"));
  const text = fs.readFileSync(src, "utf8");

  const unmapped = [...new Set([...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()))]
    .filter((hex) => !(hex in map));
  if (unmapped.length) {
    failures += 1;
    console.log(`FAIL: ${source} has colors missing from the light map: ${unmapped.join(" ")}`);
    continue;
  }

  let light = text;
  for (const [darkHex, lightHex] of Object.entries(map)) {
    light = light.replaceAll(darkHex, lightHex);
  }

  if (check) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    if (current !== light) {
      failures += 1;
      console.log(`FAIL: ${path.basename(out)} is stale — run: npm run docs:diagrams`);
    } else {
      console.log(`OK: ${path.basename(out)} matches the ${source} palette map`);
    }
  } else {
    fs.writeFileSync(out, light);
    console.log(`wrote ${path.basename(out)} (${light.length} bytes, ${Object.keys(map).length} mapped colors)`);
  }
}
process.exit(failures ? 1 : 0);
