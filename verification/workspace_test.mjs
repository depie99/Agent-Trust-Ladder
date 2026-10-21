import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureWorkspace } from "../runtime/lib/workspace.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-workspace-")).replace(/\\$/, "");
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  git(["init", "-q"]);
  git(["config", "user.email", "atl-test@example.invalid"]);
  git(["config", "user.name", "ATL test"]);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  git(["add", "README.md"]);
  git(["commit", "-qm", "baseline"]);

  fs.writeFileSync(path.join(root, "README.md"), "current dirty project\n");
  fs.mkdirSync(path.join(root, "runtime", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "runtime", "lib", "new.mjs"), "export const current = true;\n");

  const task = { id: "T-001", title: "Use the current project", objective: "preserve the active project snapshot", source: { type: "file" } };
  const workspace = ensureWorkspace(root, {}, task);
  assert.equal(workspace.mode, "worktree-snapshot");
  assert.equal(fs.readFileSync(path.join(workspace.dir, "README.md"), "utf8").replace(/\r\n/g, "\n"), "current dirty project\n");
  assert.equal(fs.readFileSync(path.join(workspace.dir, "runtime", "lib", "new.mjs"), "utf8"), "export const current = true;\n");
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace.dir, ".atl-workspace.json"), "utf8")).task_id, "T-001");

  // A pre-marker scratch directory must not be reused forever. It is moved
  // aside and rebuilt from the current project snapshot.
  const staleTask = { id: "T-002", title: "Repair stale workspace", objective: "rebuild it", source: { type: "file" } };
  const staleDir = path.join(root, ".trust", "manager", "workspaces", staleTask.id);
  fs.mkdirSync(staleDir, { recursive: true });
  fs.writeFileSync(path.join(staleDir, "README.md"), "unrelated old task\n");
  staleTask.workspace = staleDir;
  const repaired = ensureWorkspace(root, {}, staleTask);
  assert.equal(repaired.mode, "worktree-snapshot");
  assert.equal(fs.readFileSync(path.join(repaired.dir, "README.md"), "utf8").replace(/\r\n/g, "\n"), "current dirty project\n");
  const archiveRoot = path.join(root, ".trust", "manager", "workspace-archive");
  assert.ok(fs.readdirSync(archiveRoot).some((name) => name.startsWith("T-002-")), "stale workspace was not archived");

  console.log("PASS: project tasks receive isolated current snapshots and stale workspaces are repaired");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
