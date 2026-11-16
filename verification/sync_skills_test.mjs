import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const repo=fs.mkdtempSync(path.join(os.tmpdir(),"atl-skill-sync-"));
const hash=text=>crypto.createHash("sha256").update(text).digest("hex");
const run=(...args)=>spawnSync(process.execPath,[path.join(repo,"scripts/sync-skills.mjs"),"--target",path.join(repo,"installed"),...args],{encoding:"utf8"});
try {
  fs.mkdirSync(path.join(repo,"scripts"),{recursive:true});
  fs.copyFileSync(fileURLToPath(new URL("../scripts/sync-skills.mjs",import.meta.url)),path.join(repo,"scripts/sync-skills.mjs"));
  fs.mkdirSync(path.join(repo,"skills","atl"),{recursive:true});
  fs.mkdirSync(path.join(repo,"installed","atl"),{recursive:true});
  fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({version:"1.0.0"}));
  const old="old released text\n",current="new canonical text\n";
  fs.writeFileSync(path.join(repo,"skills/atl/SKILL.md"),current);
  fs.writeFileSync(path.join(repo,"installed/atl/SKILL.md"),old);
  fs.writeFileSync(path.join(repo,"skills/atl-release-lock.json"),JSON.stringify({skills:{"atl/SKILL.md":hash(old)}}));
  const check=run();
  assert.equal(check.status,1,"check reports release drift");
  assert.match(check.stdout,/repository-drifted-since-release/);
  assert.match(check.stdout,/line=1/);
  assert.equal(fs.readFileSync(path.join(repo,"installed/atl/SKILL.md"),"utf8"),old,"check never mutates installed files");

  const sync=run("--sync");
  assert.equal(sync.status,0,sync.stderr);
  assert.equal(fs.readFileSync(path.join(repo,"installed/atl/SKILL.md"),"utf8"),current);
  assert.match(sync.stdout,/BACKUP/);
  assert.ok(fs.readdirSync(path.join(repo,"installed.atl-backups/atl")).some(name=>name.startsWith("SKILL.md.atl-backup-")));

  fs.writeFileSync(path.join(repo,"installed/atl/SKILL.md"),"hand edited\n");
  const edited=run("--sync");
  assert.equal(edited.status,1,"unrecognized local edits are refused");
  assert.match(edited.stderr,/REFUSED local\/unrecognized edit/);
  assert.equal(fs.readFileSync(path.join(repo,"installed/atl/SKILL.md"),"utf8"),"hand edited\n");
  const explicit=run("--sync","--include-local-edits");
  assert.equal(explicit.status,0,explicit.stderr);
  assert.equal(fs.readFileSync(path.join(repo,"installed/atl/SKILL.md"),"utf8"),current);
  assert.ok(fs.readdirSync(path.join(repo,"installed.atl-backups/atl")).filter(name=>name.startsWith("SKILL.md.atl-backup-")).length>=2,"even an explicitly replaced local edit gets a recoverable backup");
  console.log("skills sync: release drift is reported, safe updates are backed up, and local edits are preserved");
} finally { fs.rmSync(repo,{recursive:true,force:true}); }
