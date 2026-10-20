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

function capabilityMap(files) {
  const has = (needle) => files.some((file) => file.includes(needle));
  const rows = [];
  if (has("atl-content-quality")) rows.push(["Content quality", "skills/atl-content-quality", "SEO audits, factual copy, and explicit unknowns"]);
  if (has("atl-manager.mjs") || has("atl-team")) rows.push(["Team routing", "runtime/atl-manager.mjs + skills/atl-team", "Pip → Rowan → Sage → Beacon ownership and evidence gates"]);
  if (has("show-me.mjs")) rows.push(["Show Me", "runtime/lib/show-me.mjs", "Structural handoff with file tree, flow, and repository snapshot"]);
  if (has("visual-pr.mjs")) rows.push(["Visual PR", "runtime/lib/visual-pr.mjs", "Reviewer-ready PR body with visual architecture views"]);
  if (has("memory.mjs")) rows.push(["Graph memory", "runtime/lib/memory.mjs", "Optional Mem0 recall and verified-outcome writes"]);
  return rows;
}

function architectureDiagram(files) {
  const graph = files.some((file) => file.includes("memory.mjs"))
    ? [
      "flowchart LR",
      "  U[ATL request] --> R[atl-manager]",
      "  R --> T[triage]",
      "  T --> Q[Mem0 recall]",
      "  R --> S[Show Me artifact]",
      "  R --> P[Visual PR body]",
      "  B[Beacon verifies done] --> W[Mem0 add verified outcome]",
      "  W -. optional .-> G[(Graph store)]",
      "  R --> A[(state.json + feed.jsonl)]",
      "  Q -. advisory only .-> T",
    ]
    : [
      "flowchart LR",
      "  U[ATL request] --> R[route] --> W[bounded work] --> V[verify]",
      "  V --> A[(state + feed)]",
    ];
  return graph.join("\n");
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
    "## Capability map",
    "",
    ...capabilityMap(files).map(([name, owner, behavior]) => `- **${name}** — \`${owner}\`: ${behavior}`),
    "",
    "## Architecture",
    "",
    "```mermaid",
    architectureDiagram(files),
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
