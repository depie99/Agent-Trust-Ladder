#!/usr/bin/env node
// Issue #30: the client called 18 endpoints the server never handled and the
// 404s only surfaced in the browser. This check statically requires every
// /api/... path referenced by a served Control Plane client file to have
// matching handling evidence in the server source.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(root, "runtime");
const serverFile = path.join(root, "runtime", "lib", "control-plane-server.mjs");

const clientFiles = fs.readdirSync(clientDir).filter((name) => /^control-plane-.*\.js$/.test(name));
const serverSource = fs.readFileSync(serverFile, "utf8");

const clientPaths = new Set();
for (const name of clientFiles) {
  const source = fs.readFileSync(path.join(clientDir, name), "utf8");
  for (const match of source.matchAll(/["'`](\/api\/[A-Za-z0-9\-/_.]*)/g)) {
    // A trailing template expression means the rest of the segment is dynamic.
    clientPaths.add(match[1].replace(/\$\{[^}]*\}[^"'`]*$/, "").replace(/\/$/, "") || match[1].replace(/\$\{[^}]*\}.*/, ""));
  }
}

const unhandled = [];
for (const requested of clientPaths) {
  if (serverSource.includes(`"${requested}"`) || serverSource.includes(`'${requested}'`) || serverSource.includes("`" + requested)) continue;
  // Dynamic remainder (e.g. /api/plan/${id}/review): the server is credited if
  // it handles the stable prefix via startsWith or any deeper literal.
  const segments = requested.split("/").filter(Boolean);
  let covered = false;
  for (let cut = segments.length - 1; cut >= 2; cut--) {
    const prefix = "/" + segments.slice(0, cut).join("/") + "/";
    if (serverSource.includes(`startsWith("${prefix}`) || serverSource.includes(`startsWith('${prefix}`) || serverSource.includes(`"${prefix}`) || serverSource.includes(`'${prefix}`)) { covered = true; break; }
  }
  if (!covered) unhandled.push(requested);
}

if (unhandled.length) {
  console.error("Client-referenced endpoints with no handling evidence in control-plane-server.mjs:");
  for (const endpoint of [...unhandled].sort()) console.error(`  ${endpoint}`);
  process.exitCode = 1;
} else {
  console.log(`All ${clientPaths.size} client-referenced /api endpoints have server handling evidence.`);
}
