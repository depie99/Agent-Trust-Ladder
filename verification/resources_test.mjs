import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseIntakeFile } from "../runtime/lib/intake.mjs";
import { importCandidates } from "../runtime/lib/composer.mjs";
import { buildInvocation } from "../runtime/lib/worker.mjs";
import { emptyState, paths, saveState } from "../runtime/lib/state.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-resources-"));
fs.mkdirSync(path.dirname(paths(root).state), { recursive: true });
const screenshot = path.join(root, "screenshot.png");
fs.writeFileSync(screenshot, "fake image bytes");

const candidates = parseIntakeFile(`## Fix the visual regression
The screenshot and the upstream discussion explain the expected result.

Resources:
- ![Before screenshot](${screenshot})
- [Upstream discussion](https://github.com/example/repo/issues/42)

Checks:
- the visual regression is gone
`, "visual-regression.md");
assert.equal(candidates[0].resources.length, 2, "markdown images and links become resources");

const state = emptyState();
const { created } = importCandidates(root, state, candidates);
saveState(root, state);
const task = created[0].task;
assert.equal(task.resources.length, 2, "resources are part of the canonical task packet");
assert.equal(task.resources[0].kind, "image");
assert.ok(task.resources[0].ref.startsWith(".trust/manager/attachments/"), "local files are copied into durable task attachments");
assert.ok(fs.existsSync(path.join(root, task.resources[0].ref)), "copied attachment exists");
assert.match(buildInvocation("codex", { root, workspace: root, role: "pip", task }).prompt, /Resources \(project-root-relative paths or URLs\)/);
assert.match(buildInvocation("codex", { root, workspace: root, role: "pip", task }).prompt, /Upstream discussion|github\.com/);

console.log("PASS: task resources parse, persist, copy local attachments, and reach the worker prompt");
