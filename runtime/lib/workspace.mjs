// Isolated workspaces: every coding task gets its own worktree or clone.
// The worker never touches the active workspace of any repository.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { paths } from "./state.mjs";

export class WorkspaceError extends Error {}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function repoKey(task) {
  if (task.source?.type === "github") return task.source.repo;
  if (task.source?.repo) return task.source.repo;
  return null;
}

// cfg.repos: { "<owner/name or host path>": { "path": "D:/src/that-repo" } }
function localRepoPath(cfg, task) {
  const key = repoKey(task);
  if (!key || !cfg.repos) return null;
  const entry = cfg.repos[key] || cfg.repos[key.replace(/\.git$/, "")];
  if (!entry?.path) return null;
  const p = path.resolve(entry.path);
  return fs.existsSync(p) ? p : null;
}

export function ensureWorkspace(root, cfg, task) {
  const wsRoot = paths(root).workspaces;
  fs.mkdirSync(wsRoot, { recursive: true });
  const dir = path.join(wsRoot, task.id);
  if (task.workspace && fs.existsSync(task.workspace)) {
    return { dir: task.workspace, reused: true };
  }
  if (fs.existsSync(dir)) {
    return { dir, reused: true };
  }

  const localRepo = localRepoPath(cfg, task);
  try {
    if (localRepo) {
      // Preferred: a worktree of a configured local clone — cheap and fully isolated.
      git(["worktree", "add", "-b", `atl/${task.id}`, dir], localRepo);
      return { dir, reused: false, mode: "worktree", from: localRepo };
    }
    const url = task.source?.url;
    if (url && /^https:\/\//.test(url) && repoKey(task)) {
      const cloneUrl = `https://github.com/${repoKey(task)}.git`;
      git(["clone", "--depth", "1", cloneUrl, dir]);
      git(["checkout", "-b", `atl/${task.id}`], dir);
      return { dir, reused: false, mode: "clone", from: cloneUrl };
    }
  } catch (err) {
    const detail = err.stderr || err.message;
    throw new WorkspaceError(
      `Could not create an isolated workspace for ${task.id} (${detail.toString().trim()}).\n` +
      `Configure a local clone in config/manager.json under "workspaces".repos to use worktrees.`
    );
  }

  // No repository attached: a bounded scratch space for doc/planning tasks.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "README.md"),
    `# Workspace ${task.id}\n\nTask: ${task.title}\nObjective: ${task.objective || "(set during triage)"}\n\n` +
    `No repository is attached to this task. Keep notes and artifacts here.\n`
  );
  return { dir, reused: false, mode: "scratch", from: null };
}
