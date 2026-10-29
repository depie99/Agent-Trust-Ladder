import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTokenCollector,recordExecution,executionReports,learnFromExecution,loadResourceLearning,learnedResources} from '../runtime/lib/execution-report.mjs';
import {listClaims} from '../runtime/lib/brain.mjs';
import {budgetDecision,routeTask,readResourceConfig} from '../runtime/lib/resource-policy.mjs';
import {emptyState,saveState} from '../runtime/lib/state.mjs';
import {queueAdd,queueCreate} from '../runtime/lib/queue.mjs';

const collector=createTokenCollector();
collector.push('tokens us','stderr');collector.push('ed\n1,234','stderr');
assert.equal(collector.finish().total,1234);
assert.equal(collector.finish().input,null);
const structured=createTokenCollector();
structured.push(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:20,cached_input_tokens:40}})+'\n');
structured.push(JSON.stringify({type:'turn.completed',usage:{input_tokens:70,output_tokens:10,cached_input_tokens:10}})+'\n');
structured.push('tokens used\n200\n','stderr');
assert.deepEqual(structured.finish(),{input:170,output:30,cached_input:50,total:200,source:'provider-turn-usage'});
const malformed=createTokenCollector();malformed.push('{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":10}}\nuser claimed 9000 tokens\n');
assert.equal(malformed.finish().total,null);
const claude=createTokenCollector();claude.push(JSON.stringify({type:'result',usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:100,cache_creation_input_tokens:20}}));
assert.equal(claude.finish().total,135);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-execution-report-'));
try {
  fs.mkdirSync(path.join(root,'config'));
  const policy={enabled:true,default_sessions:8,max_sessions:10,auto_extend:true,auto_models:true,max_model_tier:'advanced',models:[{provider:'fixture',model:'small',tier:'economy',cost_order:1,enabled:true},{provider:'fixture',model:'general',tier:'standard',cost_order:2,enabled:true},{provider:'fixture',model:'strong',tier:'advanced',cost_order:3,enabled:true}]};
  fs.writeFileSync(path.join(root,'config/manager.json'),JSON.stringify({providers:{default:'fixture',catalog:{fixture:{command:process.execPath,model:'small'}}},resource_policy:policy}));
  const state=emptyState();
  for(let index=1;index<=4;index++) {
    const id=`T-00${index}`;
    state.tasks[id]={id,title:'Fix standard behavior',status:'done',risk:'normal',packet_revision:1,execution_budget:{max_sessions:8,used:3,source:'automatic'},evidence:[{kind:'review',result:'approve'},...(index<=2?[{kind:'review',result:'changes-requested'}]:[])]};
    for(const [session,role] of ['rowan','sage','beacon'].entries()) {
      const record={id:`${id}-${role}`,taskId:id,role,provider:'fixture',model:role==='rowan'?'small':'general',startedAt:`2026-10-29T10:00:0${session}Z`,finishedAt:`2026-10-29T10:00:1${session}Z`,statusAfter:role==='beacon'?'done':'in_review',exitCode:0,complexity:'standard',packetRevision:1,tokens:{input:100,output:20,cached_input:30,total:120,source:'provider-turn-usage'}};
      recordExecution(root,{...record,finishedAt:null,tokens:undefined});recordExecution(root,record);recordExecution(root,record);
    }
  }
  state.log.push({task:'T-001',event:'session_budget_increased',actor:'owner',at:'2026-10-29',detail:'Limit increased from 5 to 8; 3 already used'});
  saveState(root,state);queueCreate(root,'report',{name:'Report queue'});queueAdd(root,'T-001',{queueId:'report'});queueAdd(root,'T-002',{queueId:'report'});
  for(const taskId of Object.keys(state.tasks))learnFromExecution(root,state,taskId);
  assert.equal(loadResourceLearning(root).samples.length,4);
  assert.ok(listClaims(root).some(claim=>claim.source_id==='execution:T-001'));
  assert.ok(listClaims(root).some(claim=>claim.source_id==='execution-queue:report'));
  learnFromExecution(root,state,'T-001');assert.equal(loadResourceLearning(root).samples.length,4,'learning is idempotent per task');
  const queue={id:'report',plan_draft_id:'draft-one',items:[{id:'T-001'},{id:'T-002'},{id:'T-001'}]};
  recordExecution(root,{id:'shared-plan',draftId:'draft-one',role:'planning',provider:'fixture',model:'general',tokens:{total:50,input:null,output:null,cached_input:null,source:'provider-cli-summary'}});
  let report=executionReports(root,state,[queue]);
  assert.equal(report.tasks['T-001'].tokens.total,360,'start/end records and retries cannot duplicate a session');
  assert.equal(report.tasks['T-001'].budget_changes.length,1);
  assert.equal(report.tasks['T-001'].timeline[1].modelChanged,true);
  assert.equal(report.queues.report.tokens.total,770,'task and shared planning totals count once');
  assert.equal(report.queues.report.planning_sessions,1);
  state.tasks['T-001'].execution_budget.used=4;
  report=executionReports(root,state,[queue]);
  assert.equal(report.tasks['T-001'].coverage,'partial');assert.equal(report.tasks['T-001'].unknown_sessions,1);
  state.tasks['T-005']={id:'T-005',status:'in_review',execution_budget:{used:2}};
  assert.equal(executionReports(root,state).tasks['T-005'].tokens.total,null,'missing records do not become zero tokens');
  learnFromExecution(root,state,'T-005');assert.equal(loadResourceLearning(root).samples.length,4,'unfinished work is not a successful learning sample');
  const candidate={id:'T-099',title:'Standard change',risk:'normal',status:'assigned'};
  const config=readResourceConfig(root);
  assert.equal(budgetDecision(config,candidate).max_sessions,3,'three or more comparable completions calibrate the initial budget');
  const routed=routeTask(config,candidate,'rowan',{discover:()=>({available:true})});
  assert.equal(routed.model,'strong','repeated independently reviewed repair histories raise model capacity');
  assert.ok(routed.decision.reasons.some(reason=>reason.includes('Project history')));
  assert.equal(budgetDecision(config,{...candidate,execution_budget:{used:3,max_sessions:5}}).max_sessions,5,'learning cannot change an owner cap');
  assert.equal(routeTask({...config,__resourceRoot:root,resource_policy:{...policy,max_model_tier:'standard'}},candidate,'rowan',{discover:()=>({available:true})}).decision.blocked!==null,true,'learning cannot exceed the model ceiling');
  assert.equal(learnedResources(root,{id:'fresh',risk:'critical'},{complexity:'standard',tier:'standard'}).samples,0,'different risks do not contaminate the cohort');
  const legacyDir=path.join(root,'.trust/manager/overnight/T-old');fs.mkdirSync(legacyDir,{recursive:true});
  fs.writeFileSync(path.join(legacyDir,'session-01-rowan.json'),JSON.stringify({role:'rowan',worker:'fixture',model:'old',startedAt:'2026-10-20',finishedAt:'2026-10-21'}));
  fs.writeFileSync(path.join(legacyDir,'session-01-rowan.log'),'tokens used\n777\n');
  state.tasks['T-old']={execution_budget:{used:1}};
  assert.equal(executionReports(root,state).tasks['T-old'].tokens.total,777,'legacy CLI summaries are read without inventing input/output detail');
  fs.writeFileSync(path.join(root,'.trust/manager/resource-learning.json'),'{broken');
  assert.equal(loadResourceLearning(root).samples.length,0,'a corrupt optional memory cannot block execution');
  assert.equal(budgetDecision(readResourceConfig(root),candidate).max_sessions,8,'corrupt memory falls back to the configured baseline');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: token stream parsing, task/queue accounting, unknown coverage, durable knowledge and bounded evidence-based learning');
