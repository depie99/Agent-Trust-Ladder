#!/usr/bin/env node
// ATL team installer — puts the `atl` CLI in ~/.atl for the current user.
//
//   node scripts/install.mjs            install + wire user PATH (Windows auto, POSIX prints export line)
//   node scripts/install.mjs --no-path  install only, do not touch PATH
//   ATL_HOME=D:\tools\atl ...           install somewhere else
//
// After installing: open a NEW terminal in any project and run `atl init`.
// Uninstall: delete ~/.atl and remove it from your PATH.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.ATL_HOME ? path.resolve(process.env.ATL_HOME) : path.join(os.homedir(), ".atl");
const noPath = process.argv.includes("--no-path");
const isWin = process.platform === "win32";

function fail(msg) {
  console.error(`install failed: ${msg}`);
  process.exit(1);
}

if (Number(process.versions.node.split(".")[0]) < 18) {
  fail(`Node.js 18+ is required (found ${process.versions.node}). Install from https://nodejs.org`);
}

// 1. copy the runtime
fs.rmSync(path.join(home, "runtime"), { recursive: true, force: true });
fs.cpSync(path.join(repo, "runtime"), path.join(home, "runtime"), { recursive: true });
fs.rmSync(path.join(home, "skills"), { recursive: true, force: true });
fs.cpSync(path.join(repo, "skills"), path.join(home, "skills"), { recursive: true });
fs.mkdirSync(path.join(home, "config"), { recursive: true });
fs.copyFileSync(path.join(repo, "config", "skill-routing.json"), path.join(home, "config", "skill-routing.json"));

// 2. write the `atl` shim (absolute path baked in)
fs.mkdirSync(home, { recursive: true });
const script = path.join(home, "runtime", "atl-manager.mjs");
if (isWin) {
  fs.writeFileSync(
    path.join(home, "atl.cmd"),
    `@echo off\r\nnode "${script}" %*\r\n`
  );
  fs.writeFileSync(
    path.join(home, "atl.ps1"),
    `node "${script.replace(/'/g, "''")}" @args\r\n`
  );
} else {
  const shim = path.join(home, "atl");
  fs.writeFileSync(shim, `#!/bin/sh\nexec node "${script}" "$@"\n`);
  fs.chmodSync(shim, 0o755);
}

// 3. wire the role prompts into agent harnesses that support slash prompts
//    (auto-detected; nothing is written for harnesses that are not installed)
const promptSrc = path.join(home, "runtime", "prompts");
const roles = ["mira", "pip", "rowan", "sage", "beacon"];
const harnesses = [
  { name: "Codex CLI", root: path.join(os.homedir(), ".codex"), dir: "prompts" },
  { name: "Claude Code", root: path.join(os.homedir(), ".claude"), dir: "commands" },
];
const packs = [];
for (const h of harnesses) {
  if (!fs.existsSync(h.root)) continue;
  const dir = path.join(h.root, h.dir);
  fs.mkdirSync(dir, { recursive: true });
  for (const r of roles) fs.copyFileSync(path.join(promptSrc, r + ".md"), path.join(dir, `atl-${r}.md`));
  packs.push(`${h.name}: /atl-mira /atl-pip /atl-rowan /atl-sage /atl-beacon  (${dir})`);
}

// 4. PATH
let pathNote;
if (noPath) {
  pathNote = `PATH untouched (--no-path). Add ${home} to your PATH to use: atl`;
} else if (isWin) {
  try {
    // The directory travels as an env var: single-quoted PowerShell strings do
    // not interpolate $home, and nested quoting must not leak into the value.
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command",
        `$d=$env:ATL_PATH_DIR; ` +
        `$p=[Environment]::GetEnvironmentVariable('Path','User'); ` +
        `if($d.Length -gt 0 -and $p -notlike '*'+$d+'*'){` +
        `[Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + $d), 'User'); 'ADDED'}` +
        `else{'PRESENT'}`],
      { stdio: "pipe", env: { ...process.env, ATL_PATH_DIR: home } }
    );
    pathNote = `Added ${home} to your user PATH. Open a NEW terminal, then: atl`;
  } catch {
    pathNote = `Could not update PATH automatically. Add ${home} to your user PATH manually.`;
  }
} else {
  pathNote = `Add to your shell rc, then restart the shell:  export PATH="$HOME/.atl:$PATH"`;
}

console.log(`Installed the ATL digital team.
  CLI:     ${path.join(home, isWin ? "atl.cmd" : "atl")}
  runtime: ${path.join(home, "runtime")}
  skills:  ${path.join(home, "skills")}
  prompts: ${path.join(home, "runtime", "prompts")}  (paste-ready role prompts for any agent CLI)
${packs.length ? "\nSlash commands wired:\n  " + packs.join("\n  ") + "\n" : ""}
${pathNote}

Quickstart (in ANY project):
  cd your-project
  atl init                 # scaffolds config + .trust/manager in THIS project
  # drop tasks into .trust/manager/inbox/*.md
  atl intake               # new tasks appear
  atl feed --roster        # watch the team work

Use the bots with any AI agent: open a session (ZCode, Claude Code, Codex CLI,
Grok CLI, Cursor, ...) in the project and paste the matching prompt from
runtime/prompts (mira, pip, rowan, sage, beacon). Or drive them yourself —
every command takes --actor and the runner enforces the role contracts.

Docs: ${path.join(home, "runtime", "README.md")}`);
