import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { loadState, saveState, transition, addEvidence } from '../../runtime/lib/state.mjs';
import { snapshot } from '../../runtime/lib/handoffs.mjs';
const [root,id,role]=process.argv.slice(2);
const state=loadState(root),task=state.tasks[id];
if(role==='pip'){
 assert.ok(task.objective && task.completion_checks.length);
 transition(state,id,'triaged',{actor:'pip',note:'Synthetic issue plan has bounded acceptance'});
}else if(role==='mira'){
 task.assigned_worker='rowan';transition(state,id,'assigned',{actor:'mira',note:'Assigned synthetic implementation'});
}else if(role==='rowan'){
 transition(state,id,'in_progress',{actor:'rowan',note:'Repairing synthetic issue'});
 fs.writeFileSync(path.join(task.workspace,'client.html'),'<button id="fixed" onclick="this.textContent=\'Fixed\'">Repair issue</button>');
 execFileSync(process.execPath,['verification/check.mjs'],{cwd:task.workspace,stdio:'pipe'});
 const revision=snapshot(root,task.workspace).revision;
 for(const check of task.completion_checks)addEvidence(state,id,{kind:'check',check,result:'pass',coverage:'complete',code_revision:revision,command:'node verification/check.mjs',exit_code:0},'rowan');
 transition(state,id,'in_review',{actor:'rowan',note:'Synthetic repair implemented and checked'});
}else if(role==='sage'){
 assert.match(fs.readFileSync(path.join(task.workspace,'client.html'),'utf8'),/id="fixed"/);
 addEvidence(state,id,{kind:'review',result:'approve',coverage:'complete',code_revision:snapshot(root,task.workspace).revision,detail:'Independent fixture review of changed client'},'sage');
 transition(state,id,'verifying',{actor:'sage',note:'Source and acceptance reviewed'});
}else if(role==='beacon'){
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.goto(new URL(`file:///${task.workspace.replace(/\\/g,'/')}/client.html`).href);await page.locator('#fixed').click();assert.equal(await page.locator('#fixed').innerText(),'Fixed');}
 finally{await browser.close();}
 const revision=snapshot(root,task.workspace).revision;
 for(const check of task.integrated_checks||[])addEvidence(state,id,{kind:'check',check,result:'pass',coverage:'complete',code_revision:revision,command:'Playwright synthetic user journey',exit_code:0},'beacon');
 addEvidence(state,id,{kind:'browser-journey',result:'pass',coverage:'complete',code_revision:revision,detail:'Synthetic issue repaired in browser'},'beacon');
 transition(state,id,'done',{actor:'beacon',note:'Synthetic issue verified'});
}
saveState(root,state);
