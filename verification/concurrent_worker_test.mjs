import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInvocation, abortActiveWorker } from "../runtime/lib/worker.mjs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-workers-")); const command = process.execPath; const args = ["-e", "setTimeout(() => process.exit(0), 200)"]; const first = runInvocation({ command, args, cwd: dir }, { env: {}, logPath: path.join(dir, "one.log"), timeoutMs: 2000 }); const second = runInvocation({ command, args, cwd: dir }, { env: {}, logPath: path.join(dir, "two.log"), timeoutMs: 2000 }); assert.equal(abortActiveWorker(), true); const results = await Promise.all([first, second]); assert.equal(results.length, 2); fs.rmSync(dir, { recursive: true, force: true }); console.log("PASS: worker registry tracks and aborts concurrent provider sessions");
