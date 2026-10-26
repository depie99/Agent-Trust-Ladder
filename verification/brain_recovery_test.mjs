import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveSource, brainPaths, sourceStatus } from "../runtime/lib/brain.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-brain-recovery-"));
const first = archiveSource(root, { sourceId: "raw-1", uri: "file:///source", content: "five source bytes" });
assert.equal(first.duplicate, false);
assert.equal(fs.readFileSync(path.join(root, first.source.raw_path), "utf8"), "five source bytes");
assert.equal(archiveSource(root, { sourceId: "raw-1", uri: "file:///source", content: "five source bytes" }).duplicate, true);
assert.equal(sourceStatus(root).by_result.ok, 1);

const failed = archiveSource(root, { sourceId: "raw-2", uri: "https://example.test", result: "failed", error: "HTTP 503" });
assert.equal(failed.source.revision, null);
assert.equal(sourceStatus(root).by_result.failed, 1);
assert.equal(sourceStatus(root).sources.find((s) => s.id === "raw-2").error, "HTTP 503");

assert.throws(
  () => archiveSource(root, { sourceId: "raw-3", content: "new", expectedRevision: 0 }),
  (error) => error.code === "SOURCE_REVISION_CONFLICT",
);
const events = fs.readFileSync(brainPaths(root).events, "utf8").trim().split(/\r?\n/).map(JSON.parse);
assert.equal(events.length, 2, "duplicate replay does not append an event");
assert.deepEqual(events.map((event) => event.result), ["ok", "failed"]);
fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: raw source fidelity, replay idempotency, explicit failure, and revision conflict");
