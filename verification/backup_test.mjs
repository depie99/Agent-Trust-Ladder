import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackup, listBackups, restoreBackup } from "../runtime/lib/backup.mjs";
import { emptyState, paths, saveState } from "../runtime/lib/state.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-backup-")); fs.mkdirSync(path.join(root, "config"), { recursive: true }); fs.writeFileSync(paths(root).config, "{}\n"); saveState(root, emptyState());
const backup = createBackup(root, { label: "test" }); assert.equal(listBackups(root).length, 1); fs.writeFileSync(paths(root).state, "broken\n"); restoreBackup(root, backup.id); assert.equal(JSON.parse(fs.readFileSync(paths(root).state, "utf8")).version, 1); fs.rmSync(root, { recursive: true, force: true }); console.log("PASS: backup manifest, atomic restore, and listing");
