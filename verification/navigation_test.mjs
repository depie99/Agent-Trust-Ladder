import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleContext, buildMap, loadMap, mapStatus, neighbors, queryMap } from "../runtime/lib/navigation.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-navigation-"));
try {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "provider.mjs"), "export function retryProvider() { return true; }\n");
  fs.writeFileSync(path.join(root, "src", "other.mjs"), "export function retryProvider() { return false; }\n");
  fs.writeFileSync(path.join(root, "src", "consumer.mjs"), "import { retryProvider } from './provider.mjs';\nexport const run = retryProvider;\n");
  const snapshot = buildMap(root);
  assert.equal(mapStatus(root).status, "READY");
  assert.equal(snapshot.files.length, 3, "eligible files are indexed");
  const candidates = queryMap(root, "retryProvider");
  assert.equal(candidates.results.length, 2, "duplicate symbols stay ambiguous");
  const provider = candidates.results.find((item) => item.path === "src/provider.mjs");
  const rel = neighbors(root, provider.id);
  assert.ok(rel.results.length >= 1, "import relationships are discoverable");
  const packet = assembleContext(root, { taskId: "T-001", query: "provider retry handling", maxTokens: 35 });
  assert.equal(packet.locations.length, 1, "context obeys its bounded budget");
  assert.equal(packet.truncated, true, "bounded context labels truncation");
  fs.writeFileSync(path.join(root, "src", "provider.mjs"), "export function retryProviderV2() { return true; }\n");
  const rebuilt = buildMap(root);
  assert.notEqual(rebuilt.snapshotId, snapshot.snapshotId, "dirty content changes create a new snapshot");
  assert.equal(loadMap(root).snapshotId, rebuilt.snapshotId, "published snapshot is atomically current");
  console.log("PASS: navigation map â€” bounded, revision-aware, explicitly partial source hints");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
