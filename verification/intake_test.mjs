import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseIntakeFile, normalizeGitHubRepo } from "../runtime/lib/intake.mjs";

const tasks = parseIntakeFile(`
## Indented checks
@priority: high
Objective text.
Checks:
  - first observable check
  - second observable check
`, "test.md");

assert.equal(tasks.length, 1);
assert.deepEqual(tasks[0].completion_checks, [
  "first observable check",
  "second observable check",
]);
console.log("PASS: indented intake completion checks are parsed");

// GitHub repo entries normalize to owner/name wherever they enter the config.
assert.equal(normalizeGitHubRepo("https://github.com/owner/repo.git"), "owner/repo");
assert.equal(normalizeGitHubRepo("https://github.com/owner/repo/issues"), "owner/repo");
assert.equal(normalizeGitHubRepo(" owner/repo/ "), "owner/repo");
assert.equal(normalizeGitHubRepo("owner/repo"), "owner/repo");
console.log("PASS: github repo entries normalize to owner/name");

// `atl intake enable|disable|status` — the CLI runs against a temp project.
// The probe path is covered by a repo that cannot exist, so the refusal is
// deterministic whether or not gh is authenticated on this machine.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runtime", "atl-manager.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-intake-config-"));
const run = (args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
run(["init"]);

const fail = (args) => {
  try { run(args); return null; } catch (err) { return String(err.stderr); }
};

assert.match(fail(["intake", "enable", "nope"]) || "", /needs a source: file \| github \| azure/);
console.log("PASS: intake enable rejects an unknown source");

// The default config ships with a private repo and no auth: the probe must
// refuse to flip the source on, printing the fix instead (exit 0, enabled false).
const refused = run(["intake", "enable", "github"]);
assert.match(refused, /NOT enabled/);
assert.match(refused, /gh auth login/);
const cfgAfterRefusal = JSON.parse(fs.readFileSync(path.join(root, "config", "manager.json"), "utf8"));
assert.equal(cfgAfterRefusal.intake.github.enabled, false, "a failed probe must not flip enabled");
console.log("PASS: a failing github probe refuses to enable the source");

// disable keeps the repo list; status reports it.
run(["intake", "disable", "github"]);
const cfgAfterDisable = JSON.parse(fs.readFileSync(path.join(root, "config", "manager.json"), "utf8"));
assert.equal(cfgAfterDisable.intake.github.enabled, false);
assert.ok(cfgAfterDisable.intake.github.repos.length >= 1, "disable keeps repos");
assert.match(run(["intake", "status", "--source", "github"]), /github\s+disabled/);
console.log("PASS: intake disable keeps the repo list and status reflects it");

// --remove manages the repo list; draining it is a graceful state, not an error.
const drained = run(["intake", "enable", "github", "--remove", "shahryarjb/temp_mishka_cms"]);
assert.match(drained, /repo list is now empty/);
const cfgDrained = JSON.parse(fs.readFileSync(path.join(root, "config", "manager.json"), "utf8"));
assert.deepEqual(cfgDrained.intake.github.repos, []);
console.log("PASS: --remove drains the repo list gracefully");
