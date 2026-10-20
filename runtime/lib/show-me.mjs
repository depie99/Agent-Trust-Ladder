import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { paths, loadState } from "./state.mjs";

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function lines(value) {
  return value ? value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(values)].sort();
}

function branch(root) {
  return git(root, ["branch", "--show-current"]) || "detached";
}

function changedFiles(root) {
  const base = lines(git(root, ["diff", "--name-only", "origin/main...HEAD"]));
  const working = lines(git(root, ["diff", "--name-only"]));
  const staged = lines(git(root, ["diff", "--cached", "--name-only"]));
  return unique([...base, ...working, ...staged]);
}

function tree(files) {
  if (files.length === 0) return ".\n└── (no changed files detected)";
  const root = {};
  for (const file of files) {
    let node = root;
    const parts = file.replaceAll("\\", "/").split("/");
    for (const part of parts) node = node[part] ||= {};
  }
  const out = ["."];
  const walk = (node, prefix) => {
    const names = Object.keys(node).sort();
    names.forEach((name, index) => {
      const last = index === names.length - 1;
      const branch = last ? "└── " : "├── ";
      out.push(`${prefix}${branch}${name}`);
      if (Object.keys(node[name]).length) walk(node[name], `${prefix}${last ? "    " : "│   "}`);
    });
  };
  walk(root, "");
  return out.join("\n");
}

function taskContext(root, taskId) {
  if (!taskId) return "No task id supplied.";
  try {
    const task = loadState(root).tasks[taskId];
    if (!task) return `Task ${taskId} was not found in the local state.`;
    return `${task.id} [${task.status}] ${task.title}\nObjective: ${task.objective || "(not set)"}`;
  } catch (err) {
    return `Task context unavailable: ${err.message}`;
  }
}

export function buildShowMe(root, { taskId = null } = {}) {
  const files = changedFiles(root);
  const status = git(root, ["status", "--short", "--branch"]);
  const stat = git(root, ["diff", "--stat", "origin/main...HEAD"]) || git(root, ["diff", "--stat"]);
  const currentBranch = branch(root);
  return [
    "# Show Me",
    "",
    `Branch: \`${currentBranch}\``,
    `Task: ${taskContext(root, taskId)}`,
    "",
    "## Change shape",
    "",
    "```text",
    tree(files),
    "```",
    "",
    "## Control flow",
    "",
    "```text",
    "ATL request",
    "  route through the selected specialist",
    "  record state and evidence in the local runner",
    "  render a structural handoff for review",
    "  verify the same acceptance checks before close-out",
    "```",
    "",
    "## Evidence snapshot",
    "",
    "```text",
    status || "git status unavailable",
    "",
    stat || "diff stat unavailable",
    "```",
    "",
    "Generated from inspected repository output. This outline is a communication aid, not proof of behavior.",
    "",
  ].join("\n");
}

export function saveShowMe(root, content, { taskId = null } = {}) {
  const stem = taskId ? `show-me-${taskId.toLowerCase()}` : `show-me-${Date.now()}`;
  const file = path.join(paths(root).briefs, `${stem}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

export function changedFileList(root) {
  return changedFiles(root);
}
