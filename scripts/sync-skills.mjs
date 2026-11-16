#!/usr/bin/env node
// Compare or safely synchronize installed ATL skills with this checkout.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const sha=data=>crypto.createHash("sha256").update(data).digest("hex");
const skills=path.join(root,"skills");
const names=fs.readdirSync(skills,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith("atl")&&fs.existsSync(path.join(skills,entry.name,"SKILL.md"))).map(entry=>entry.name).sort();
const defaultRoots=[path.join(os.homedir(),".agents","skills"),path.join(os.homedir(),".codex","skills"),path.join(os.homedir(),".claude","skills")];
const arg=(name)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
const targets=(arg("--target")?[path.resolve(arg("--target"))]:defaultRoots).filter(dir=>fs.existsSync(dir));
const releaseRoots=targets.length?targets:defaultRoots.filter(dir=>fs.existsSync(dir));
const syncing=process.argv.includes("--sync");
const includeLocalEdits=process.argv.includes("--include-local-edits");
const releaseFile=path.join(root,"skills","atl-release-lock.json");
const releaseFileExists=fs.existsSync(releaseFile);
const lockRequested=process.argv.includes("--write-release-lock");
let release={};try{release=JSON.parse(fs.readFileSync(releaseFile,"utf8")).skills||{};}catch{}
const releaseVersion=(()=>{try{return JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version;}catch{return null;}})();
function firstDifference(left,right){const a=left.toString("utf8").split(/\r?\n/),b=right.toString("utf8").split(/\r?\n/);for(let i=0;i<Math.max(a.length,b.length);i++)if(a[i]!==b[i])return i+1;return null;}
function treeDigest(dir){if(!fs.existsSync(dir))return "missing";const files=[];function walk(current){for(const item of fs.readdirSync(current,{withFileTypes:true})){const file=path.join(current,item.name);if(item.isDirectory())walk(file);else files.push(file);}}walk(dir);files.sort((a,b)=>path.relative(dir,a).localeCompare(path.relative(dir,b)));const digest=crypto.createHash("sha256");for(const file of files){digest.update(path.relative(dir,file).split(path.sep).join("/"));digest.update("\0");digest.update(fs.readFileSync(file));digest.update("\0");}return `${digest.digest("hex")} (${files.length} files)`;}
let differences=0,refused=0;
for(const base of targets){
  for(const name of names){
    const source=path.join(skills,name),installed=path.join(base,name);
    if(!fs.existsSync(installed)){
      console.log(`${base}\t${name}\tMISSING skill\tcanonical=${sha(fs.readFileSync(path.join(source,"SKILL.md")))}`);differences++;
      if(syncing){fs.mkdirSync(installed,{recursive:true});function copyMissing(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const from=path.join(dir,item.name),to=path.join(installed,path.relative(source,from));if(item.isDirectory())copyMissing(from);else{fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);console.log(`SYNCED ${to}`);}}}copyMissing(source);}
      console.log(`${base}\t${name}\t${syncing?"SYNCED":"DIFF"}\tcanonical-tree=${treeDigest(source)}\tinstalled-tree=${treeDigest(installed)}`);
      continue;
    }
    const expectedFiles=[];function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else expectedFiles.push(path.relative(source,file));}}walk(source);
    const actualFiles=[];function walkActual(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walkActual(file);else actualFiles.push(path.relative(installed,file));}}walkActual(installed);
    for(const rel of [...new Set([...expectedFiles,...actualFiles])].sort()){
      const from=path.join(source,rel),to=path.join(installed,rel);
      if(!fs.existsSync(from)){console.log(`${base}\t${name}/${rel}\tEXTRA installed-only`);differences++;continue;}
      if(!fs.existsSync(to)){
        console.log(`${base}\t${name}/${rel}\tMISSING`);differences++;
        if(syncing){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);console.log(`SYNCED ${to}`);}
        continue;
      }
      const canonical=fs.readFileSync(from);
      const existing=fs.readFileSync(to);if(existing.equals(canonical))continue;
      const actualHash=sha(existing),canonicalHash=sha(canonical),line=firstDifference(existing,canonical);
      const releasedHash=release[`${name}/${rel}`];
      const hasReleaseHash=releaseFileExists&&typeof releasedHash==="string";
      const installedMatchesRelease=hasReleaseHash&&actualHash===releasedHash;
      const provenance=!hasReleaseHash?"release=unknown; classify=unrecognized":(releasedHash!==canonicalHash?`repository-drifted-since-release(${releaseVersion||"unknown"}); installed=${installedMatchesRelease?"behind-release":"locally-edited-or-unknown"}`:`installed=${installedMatchesRelease?`last-release(${releaseVersion||"unknown"})`:"locally-edited-or-unknown"}`);
      console.log(`${base}\t${name}/${rel}\tDIFF line=${line} installed=${actualHash} canonical=${canonicalHash} ${provenance}`);differences++;
      if(!syncing)continue;
      if(!installedMatchesRelease&&!includeLocalEdits){console.error(`REFUSED local/unrecognized edit: ${to}; pass --include-local-edits to replace it after a backup`);refused++;continue;}
      const backupRoot=path.join(path.dirname(base),`${path.basename(base)}.atl-backups`);
      const backup=path.join(backupRoot,name,`${rel}.atl-backup-${new Date().toISOString().replace(/[:.]/g,"-")}`);
      fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(to,backup);fs.writeFileSync(to,canonical);console.log(`BACKUP ${backup}`);console.log(`SYNCED ${to}`);
    }
    const canonicalTree=treeDigest(source),installedTree=treeDigest(installed);
    console.log(`${base}\t${name}\t${canonicalTree===installedTree?"MATCH":"DIFF"}\tcanonical-tree=${canonicalTree}\tinstalled-tree=${installedTree}`);
  }
}
if(lockRequested){
  const locked={version:releaseVersion,skills:{}};
  for(const name of names){const source=path.join(skills,name);function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else locked.skills[`${name}/${path.relative(source,file).split(path.sep).join("/")}`]=sha(fs.readFileSync(file));}}walk(source);}
  for(const base of releaseRoots)for(const name of names){const installed=path.join(base,name);if(!fs.existsSync(installed))continue;const source=path.join(skills,name);function walkInstalled(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walkInstalled(file);else{const rel=path.relative(installed,file).split(path.sep).join("/"),canonical=path.join(source,rel);if(fs.existsSync(canonical)&&fs.readFileSync(canonical).equals(fs.readFileSync(file)))locked.skills[`${name}/${rel}`]=sha(fs.readFileSync(file));}}}walkInstalled(installed);}
  fs.writeFileSync(releaseFile,JSON.stringify(locked,null,2)+"\n");
  console.log(`Release skill hashes recorded for package ${releaseVersion||"unknown"}.`);
}
if(!targets.length&&!lockRequested){console.error("No installed skill directory found; pass --target <skills-directory>.");process.exitCode=2;}
else if(syncing&&refused)process.exitCode=1;
else if(!syncing&&differences)process.exitCode=1;
else console.log(syncing?"Installed skills synchronized from canonical sources.":"Installed skills match canonical files.");
