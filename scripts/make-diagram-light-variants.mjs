// Generate light variants of the documentation diagrams so the artwork
// matches the docs light theme. Source of truth stays the dark SVG; this
// script applies an explicit shared color map (docs/scss light tokens) and
// fails on any unmapped color, so a palette change can never silently drift.
//
//   npm run docs:diagrams          regenerate *.light.svg
//   npm run docs:diagrams:check    fail if a variant is stale
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const check = process.argv.includes("--check");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "docs", "diagrams");

// Shared dark -> light map for the standard diagram set. Light values mirror
// docs/scss/themes/_light.scss: surfaces lighten, brand hues darken for text
// contrast, tinted chip fills become pastels and their inner text darkens.
const SHARED_MAP = {
  // surfaces
  "#0b0b10": "#f4f3f7",
  "#0c0d13": "#f1f0f7",
  "#0e0f14": "#f1f0f7",
  "#11121a": "#ffffff",
  "#12131a": "#ffffff",
  "#171821": "#f0eff5",
  "#1a1b25": "#ffffff",
  "#242432": "#e3e1ee",
  "#292a36": "#eceaf2",
  "#303140": "#cfcdd9",
  "#1f2540": "#ffffff",
  // violet family (chips, panels, edges)
  "#151322": "#f0edfd",
  "#1b1b30": "#efecfd",
  "#1b1930": "#f0edfd",
  "#202036": "#efecfb",
  "#181530": "#efecfb",
  "#272346": "#e9e4fc",
  "#272443": "#e9e4fc",
  "#271e35": "#e8e2fb",
  "#1a1830": "#e8e2fb",
  "#4c467a": "#c3b9f2",
  "#413963": "#c3b9f2",
  "#392b4e": "#c3b9f2",
  "#6357a8": "#a99ee8",
  "#7771b8": "#c3b9f2",
  "#9b8cff": "#6753e8",
  // mint family
  "#172d2c": "#d9f2ea",
  "#172c2c": "#d9f2ea",
  "#14211f": "#d9f2ea",
  "#102724": "#d9f2ea",
  "#477f73": "#9fd4c4",
  "#5fe0c2": "#0a7d66",
  "#51c7a8": "#3c9b83",
  // amber family
  "#302817": "#f8eed7",
  "#241c10": "#fcf3dc",
  "#f4c67e": "#9a6709",
  "#d5a858": "#c9973a",
  "#8a6632": "#d9b97a",
  // blue family
  "#172033": "#e8f0fb",
  "#7f9bff": "#3565d6",
  "#bfdbfe": "#2f6bc4",
  "#c7d2fe": "#4c56c8",
  "#64748b": "#8493a8",
  // coral family
  "#fa8f83": "#bb4534",
  "#fecaca": "#bb4534",
  // neutral ink + lines
  "#eef0f7": "#1a1826",
  "#f5f5f7": "#191726",
  "#a5a8ba": "#5d5b72",
  "#9698a8": "#5d5b72",
  "#6f7181": "#8a889e",
  "#74788a": "#7d8194",
  "#818598": "#7d8194",
  "#5b6475": "#6b7585",
  "#5d5e6d": "#6b6d7c",
  "#b7b8c5": "#55576b",
  "#c3c6d3": "#3f4152",
  "#383a4b": "#dedde6",
  "#444657": "#b9b7c6",
  "#3a3b48": "#c9c7d9",
  "#777988": "#8a889e",
  "#99f6e4": "#0a7d66",
  "#fde68a": "#9a6709",
};

// Dedicated map for the control-plane diagram (mirrors runtime/scss light).
const CONTROL_PLANE_MAP = {
  "#0d0e14": "#f2f5f9",
  "#14151f": "#ffffff",
  "#323449": "#cfd9e4",
  "#10111a": "#e9eef5",
  "#f0eff8": "#17212e",
  "#8c8da2": "#5c6b7d",
  "#c8c7d4": "#46586c",
  "#9c9db0": "#5c6b7d",
  "#1c1e2b": "#ffffff",
  "#565872": "#b0bfce",
  "#777a91": "#8fa3b8",
  "#1a3a31": "#e2f3ed",
  "#61e0b2": "#0c7d62",
  "#7ee8c0": "#0c7d62",
  "#a9d6c5": "#4e7c6f",
  "#111c1b": "#e3f6ef",
  "#376a5b": "#9fd4c4",
  "#8ee8c6": "#0c7d62",
  "#172c38": "#e8f0fb",
  "#59aeca": "#2f6bc4",
  "#b6e3fa": "#2f6bc4",
  "#9fc4d6": "#5c6b7d",
  "#3b2d16": "#fdf3dd",
  "#e0ae55": "#dcbd7e",
  "#f7cd7b": "#9a6709",
  "#e2c58f": "#a9802e",
  "#202036": "#efecfb",
  "#a990e9": "#c3b9f2",
  "#d3c4ff": "#7a4fd3",
  "#b9adda": "#7a6bb0",
};

const JOBS = [
  ...fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".svg") && !f.includes(".light.") && !f.startsWith("tui-") && f !== "atl-web-control-plane.svg")
    .map((f) => ({ source: f, map: SHARED_MAP })),
  { source: "atl-web-control-plane.svg", map: CONTROL_PLANE_MAP },
];

let failures = 0;
for (const { source, map } of JOBS) {
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
      console.log(`OK: ${path.basename(out)}`);
    }
  } else {
    fs.writeFileSync(out, light);
    console.log(`wrote ${path.basename(out)} (${Object.keys(map).length}-color map)`);
  }
}
process.exit(failures ? 1 : 0);
