import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {emptyState,createTask,saveState,loadState} from '../runtime/lib/state.mjs';
import {executeLaunchQueue} from '../runtime/lib/launch.mjs';
import {queueAdd} from '../runtime/lib/queue.mjs';
import {executionReports,loadResourceLearning} from '../runtime/lib/execution-report.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-resource-launch-'));
try {
  const state=emptyState(),task=createTask(state,{title:'Fix a README typo'});
  Object.assign(task,{status:'assigned',assigned_worker:'rowan',objective:'Correct routine spelling',files:['README.md'],completion_checks:['Spelling corrected'],review_required:true});saveState(root,state);
  const fixture=fileURLToPath(new URL('./fixtures/resource-routing-worker.mjs',import.meta.url));
  const config={providers:{default:'fixture',catalog:{fixture:{command:process.execPath,args:[fixture,'{root}','{task}','{role}','{model}'],model:'routine'}}},resource_policy:{enabled:true,default_sessions:8,max_sessions:10,auto_extend:true,auto_models:true,max_model_tier:'standard',models:[{provider:'fixture',model:'routine',tier:'economy',cost_order:1,enabled:true},{provider:'fixture',model:'general',tier:'standard',cost_order:2,enabled:true}]}};
  fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/manager.json'),JSON.stringify(config));
  queueAdd(root,task.id);
  const outcome=await executeLaunchQueue(root,{confirm:true,maxMinutes:1,onProgress:()=>{}});
  const final=loadState(root).tasks[task.id];
  assert.equal(final.status,'done',JSON.stringify(outcome.results));
  assert.equal(final.execution_budget.used,5);assert.equal(final.execution_budget.max_sessions,5);assert.equal(final.execution_budget.source,'automatic');
  const routes=fs.readFileSync(path.join(root,'.trust/routes.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(routes,[{role:'rowan',model:'routine'},{role:'sage',model:'routine'},{role:'rowan',model:'general'},{role:'sage',model:'general'},{role:'beacon',model:'general'}]);
  assert.ok(loadState(root).log.some(e=>e.event==='resource_budget'));
  const report=executionReports(root,loadState(root)).tasks[task.id];
  assert.equal(report.tokens.total,750);assert.equal(report.reported_sessions,5);assert.equal(report.coverage,'complete');
  assert.equal(loadResourceLearning(root).samples.length,1);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: real queue sessions select economical model, upgrade after rejected review, extend 3 to 5 sessions and preserve independent final gates');
