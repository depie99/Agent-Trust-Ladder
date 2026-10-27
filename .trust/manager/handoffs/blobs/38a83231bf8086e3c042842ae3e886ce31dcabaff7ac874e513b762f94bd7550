// Isolated workspaces: every coding task gets its own worktree or clone.
// The worker never touches the active workspace of any repository.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { paths } from "./state.mjs";

export class WorkspaceError extends Error {}

const WORKSPACE_MARKER = ".atl-workspace.json";

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

function isGitRepo(root) {
  try {
    return Boolean(git(["rev-parse", "--show-toplevel"], root).trim());
  } catch {
    return false;
  }
}

function markerPath(dir) {
  return path.join(dir, WORKSPACE_MARKER);
}

function readMarker(dir) {
  try {
    return JSON.parse(fs.readFileSync(markerPath(dir), "utf8"));
  } catch {
    return null;
  }
}

function writeMarker(dir, { root, task, mode, from = null }) {
  fs.writeFileSync(markerPath(dir), JSON.stringify({
    version: 1,
    task_id: task.id,
    project_root: path.resolve(root),
    mode,
    from,
    source_commit: (() => {
      try { return git(["rev-parse", "HEAD"], root).trim(); } catch { return null; }
    })(),
    created_at: new Date().toISOString(),
  }, null, 2) + "\n");
}

function isInside(candidate, parent) {
  const child = path.resolve(candidate);
  const base = path.resolve(parent);
  return child === base || child.startsWith(base + path.sep);
}

function archiveStaleWorkspace(root, wsRoot, dir, taskId) {
  if (!fs.existsSync(dir)) return null;
  if (!isInside(dir, path.dirname(wsRoot))) {
    throw new WorkspaceError(
      `${taskId}: existing workspace is outside ATL's managed workspace root (${dir}). ` +
      `ATL will not overwrite it; choose a managed workspace with "atl workspace ${taskId}".`
    );
  }
  const archiveRoot = path.join(path.dirname(wsRoot), "workspace-archive");
  fs.mkdirSync(archiveRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[T:.Z]/g, "-");
  let archive = path.join(archiveRoot, `${taskId}-${stamp}`);
  let suffix = 1;
  while (fs.existsSync(archive)) archive = path.join(archiveRoot, `${taskId}-${stamp}-${suffix++}`);
  fs.renameSync(dir, archive);
  return archive;
}

function copyDirtySnapshot(root, dir) {
  // Tracked edits (staged or unstaged) are applied on top of the same HEAD.
  const patch = git(["diff", "--binary", "HEAD"], root);
  if (patch) {
    const patchPath = path.join(path.dirname(dir), `.atl-${path.basename(dir)}-${Date.now()}.patch`);
    try {
      fs.writeFileSync(patchPath, patch, "utf8");
      git(["apply", "--whitespace=nowarn", patchPath], dir);
    } finally {
      fs.rmSync(patchPath, { force: true });
    }
  }

  // Untracked source files are part of the user's current project too. Keep
  // manager state out of worker workspaces so an agent cannot edit the live
  // control plane by accident.
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root)
    .split("\0")
    .filter(Boolean)
    .filter((relative) => !relative.replace(/\\/g, "/").startsWith(".trust/manager/"));
  for (const relative of untracked) {
    const source = path.join(root, relative);
    const target = path.join(dir, relative);
    if (!fs.existsSync(source)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
  }
}

function createSnapshotWorktree(root, dir, task) {
  git(["worktree", "add", "--detach", dir, "HEAD"], root);
  try {
    copyDirtySnapshot(root, dir);
    writeMarker(dir, { root, task, mode: "worktree-snapshot", from: root });
    return { dir, reused: false, mode: "worktree-snapshot", from: root };
  } catch (error) {
    // Keep the failure visible, but do not leave a half-built workspace that
    // the next retry would silently reuse.
    try { git(["worktree", "remove", "--force", dir], root); } catch { /* preserve original error */ }
    throw error;
  }
}

export function ensureWorkspace(root, cfg, task) {
  const wsRoot = paths(root).workspaces;
  fs.mkdirSync(wsRoot, { recursive: true });
  const dir = path.join(wsRoot, task.id);

  // Explicit external workspaces remain user-owned. ATL can use them, but it
  // must not archive or overwrite them during recovery.
  if (task.workspace && fs.existsSync(task.workspace) && !isInside(task.workspace, wsRoot)) {
    return { dir: task.workspace, reused: true, mode: "external" };
  }

  const existing = [task.workspace, dir]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))
    .filter((candidate, index, all) => all.indexOf(candidate) === index);
  for (const candidate of existing) {
    const marker = readMarker(candidate);
    if (marker?.task_id === task.id && path.resolve(marker.project_root || root) === path.resolve(root)) {
      return { dir: candidate, reused: true, mode: marker.mode || "managed" };
    }
  }

  // Older ATL versions created scratch directories without ownership markers
  // and then reused them forever. Archive those directories before repairing;
  // nothing is deleted and the next run gets a truthful workspace.
  for (const candidate of existing) {
    if (fs.existsSync(candidate)) archiveStaleWorkspace(root, wsRoot, candidate, task.id);
  }

  // A task written into this project's inbox is implicitly about this project.
  // Use a detached worktree over a snapshot of the current checkout so dirty
  // user work is available to the worker without exposing the active checkout.
  const configuredRepo = localRepoPath(cfg, task);
  const localRepo = configuredRepo || (!repoKey(task) && isGitRepo(root) ? path.resolve(root) : null);
  try {
    if (localRepo) {
      if (path.resolve(localRepo) === path.resolve(root)) {
        return createSnapshotWorktree(root, dir, task);
      }
      // Preferred: a worktree of a configured local clone — cheap and fully isolated.
      git(["worktree", "add", "-b", `atl/${task.id}`, dir], localRepo);
      writeMarker(dir, { root, task, mode: "worktree", from: localRepo });
      return { dir, reused: false, mode: "worktree", from: localRepo };
    }
    const url = task.source?.url;
    if (url && /^https:\/\//.test(url) && repoKey(task)) {
      const cloneUrl = `https://github.com/${repoKey(task)}.git`;
      git(["clone", "--depth", "1", cloneUrl, dir]);
      git(["checkout", "-b", `atl/${task.id}`], dir);
      writeMarker(dir, { root, task, mode: "clone", from: cloneUrl });
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
  writeMarker(dir, { root, task, mode: "scratch", from: null });
  return { dir, reused: false, mode: "scratch", from: null };
}
