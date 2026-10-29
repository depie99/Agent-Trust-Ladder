import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInvocation } from "../runtime/lib/worker.mjs";
if (process.platform !== "win32") { console.log("SKIP: Windows process-tree timeout"); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-timeout-"));
try {
  const script = path.join(dir,"parent.cjs"), pidFile = path.join(dir,"child.pid");
  fs.writeFileSync(script, `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(process.argv[2],String(child.pid));setInterval(()=>{},1000);`);
  const result = await runInvocation({command:process.execPath,args:[script,pidFile],cwd:dir},{logPath:path.join(dir,'log'),timeoutMs:2000});
  assert.equal(result.timedOut,true); const pid=Number(fs.readFileSync(pidFile,'utf8'));
  let alive=true; for(let i=0;i<30 && alive;i++){try{process.kill(pid,0); await new Promise(r=>setTimeout(r,100));}catch{alive=false;}}
  assert.equal(alive,false,'timeout must terminate the spawned provider child');
  console.log('PASS: Windows timeout terminates provider process tree');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
