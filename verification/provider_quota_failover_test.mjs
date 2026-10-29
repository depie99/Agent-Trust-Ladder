import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {emptyState,createTask,saveState,loadState} from '../runtime/lib/state.mjs';
import {executeLaunchQueue} from '../runtime/lib/launch.mjs';
import {queueAdd} from '../runtime/lib/queue.mjs';
import {quotaStatus,recordQuotaFailure} from '../runtime/lib/provider-quota.mjs';
import {readResourceConfig,routeTask} from '../runtime/lib/resource-policy.mjs';
import {executionReports} from '../runtime/lib/execution-report.mjs';
import {recordUsage} from '../runtime/lib/usage.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-quota-failover-'));
try {
  const state=emptyState(),ids=[];
  for(const title of ['Fix a README typo','Fix another routine typo']) {
    const task=createTask(state,{title});Object.assign(task,{status:'assigned',assigned_worker:'rowan',objective:'Correct routine spelling',files:['README.md'],completion_checks:['Spelling corrected'],review_required:true});ids.push(task.id);
  }
  saveState(root,state);
  const fixture=fileURLToPath(new URL('./fixtures/resource-routing-worker.mjs',import.meta.url));
  const args=[fixture,'{root}','{task}','{role}','{model}'];
  const config={providers:{default:'primary',catalog:{primary:{command:process.execPath,args,model:'exhausted'},backup:{command:process.execPath,args,model:'general'}}},resource_policy:{enabled:true,default_sessions:8,max_sessions:10,auto_extend:true,auto_models:true,quota_failover:true,max_model_tier:'standard',models:[{provider:'primary',model:'exhausted',tier:'economy',cost_order:1,enabled:true},{provider:'backup',model:'general',tier:'standard',cost_order:2,enabled:true}]}};
  fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/manager.json'),JSON.stringify(config));
  for(const id of ids)queueAdd(root,id);
  const outcome=await executeLaunchQueue(root,{confirm:true,maxMinutes:1,onProgress:()=>{}});
  const final=loadState(root);
  for(const id of ids)assert.equal(final.tasks[id].status,'done',JSON.stringify(outcome.results));
  const routes=fs.readFileSync(path.join(root,'.trust/routes.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(routes.filter(row=>row.model==='exhausted').length,1,'provider exhaustion is remembered across tasks');
  assert.equal(routes.filter(row=>row.model==='general').length,10,'fallback completes builder, independent review and verification for both tasks');
  assert.equal(final.tasks[ids[0]].execution_budget.used,6,'a failed provider attempt is retained in the budget');
  assert.ok(final.log.some(row=>row.event==='provider_quota_failover'));
  assert.equal(quotaStatus(root,'primary','different-model').status,'exhausted','unscoped quota errors cool down the provider');
  assert.equal(quotaStatus(root,'backup','general').status,'unknown','a successful launch does not invent remote quota');
  assert.equal(executionReports(root,final).tasks[ids[0]].unknown_sessions,1,'quota failure without tokens remains visible');
  assert.ok(executionReports(root,final).tasks[ids[0]].route_changes.some(event=>event.event==='provider_quota_failover'));
  recordQuotaFailure(root,{provider:'model-scoped',model:'small',scope:'model'});
  assert.equal(quotaStatus(root,'model-scoped','small').status,'exhausted');
  assert.equal(quotaStatus(root,'model-scoped','other').status,'unknown');
  recordQuotaFailure(root,{provider:'expired',retryAfterSeconds:30});
  assert.equal(quotaStatus(root,'expired',null,{now:Date.now()+31000}).status,'unknown','cooldowns expire without permanent lockout');
  recordUsage(root,{provider:'backup',model:'general',source:'provider-adapter',status:'observed',confidence:'verified',remaining:0});
  assert.equal(quotaStatus(root,'backup','general').status,'exhausted');
  const blocked=routeTask(readResourceConfig(root),final.tasks[ids[0]],'rowan',{discover:()=>({available:true})});
  assert.ok(blocked.decision.blocked,'exhausted alternatives are not launched');
  const legacy={...config,resource_policy:{enabled:false,quota_failover:true,models:[]},__resourceRoot:root};
  recordUsage(root,{provider:'backup',model:'general',source:'provider-adapter',status:'observed',confidence:'verified',remaining:500});
  const fallback=routeTask(legacy,{title:'Simple typo'},'rowan',{discover:()=>({available:true})});
  assert.equal(fallback.worker,'backup','existing configured providers can fail over without requiring adaptive budgets');
  assert.equal(fallback.decision.failover.quota.status,'available');
  const disabled=routeTask({...legacy,resource_policy:{enabled:false,quota_failover:false,models:[]}},final.tasks[ids[0]],'rowan',{discover:()=>({available:true})});
  assert.equal(disabled.worker,'primary','the failover setting can preserve the configured provider');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: exhausted provider fails over without stopping the queue, cooldowns span tasks, scopes/quotas/ceilings and budgets are preserved');
