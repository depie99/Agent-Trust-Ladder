import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {emptyState,saveState} from '../runtime/lib/state.mjs';
import {startControlPlaneServer} from '../runtime/lib/control-plane-server.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-resource-planning-'));
let server,calls=0;
const plan={plan_contract_version:2,title:'Fix README typo',objective:'Correct one typo',requirements:[{id:'r1',text:'Correct spelling',source:'original request'}],constraints:[],observed_evidence:[{description:'README exists',path:'README.md'}],assumptions:[],open_questions:[],risks:[],completion_checks:['Correct spelling'],acceptance_examples:[{given:'A typo',when:'It is corrected',then:'Spelling is correct'}],implementation_steps:[{step:'Correct typo',files:['README.md'],verify:'Review spelling'}],verifier_commands:['Review spelling'],task_proposals:[{id:'p1',title:'Fix README typo',objective:'Correct one typo',instructions:'Correct the typo in README',requirement_ids:['r1'],deliverables:['Correct README'],completion_checks:['Correct spelling'],selected_skills:[],skill_reasons:{},proposed_worker:'rowan',depends_on:[],files:['README.md'],verify:'Review spelling',resource_estimate:{complexity:'simple',reason:'One spelling correction in one file'}}]};
const policy={enabled:true,default_sessions:8,max_sessions:16,auto_extend:true,auto_models:true,max_model_tier:'standard',models:[{provider:'gapgpt',model:'small',tier:'economy',cost_order:1,enabled:true},{provider:'gapgpt',model:'general',tier:'standard',cost_order:2,enabled:true}]};
plan.task_proposals[0].instructions='Correct only the spelling error in README.md, preserve surrounding content, and verify the resulting spelling against the requested text.';
plan.task_proposals[0].selected_skills=['atl-verify'];
plan.task_proposals[0].skill_reasons={'atl-verify':'Verify the exact corrected spelling without unrelated edits.'};
try {
  fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'README.md'),'A typo');
  fs.writeFileSync(path.join(root,'config/manager.json'),JSON.stringify({providers:{default:'gapgpt',catalog:{gapgpt:{command:process.execPath,model:'general'}}},resource_policy:policy}));
  saveState(root,emptyState());
  const started=await startControlPlaneServer(root,{planningInvoke:async({request})=>{calls++;return {code:0,text:JSON.stringify(request.review?{verdict:'passed',findings:[]}:request.current_proposal?plan.task_proposals[0]:plan)};}});server=started.server;
  const post=async(endpoint,body)=>{const response=await fetch(started.url+endpoint,{method:'POST',body:JSON.stringify(body)});return {status:response.status,...await response.json()};};
  let result=await post('api/plan/generate',{intent:'Fix a README typo',provider:'auto',confirm:true});
  assert.equal(result.status,200,result.error);assert.equal(calls,1);assert.equal(result.draft.model,'small');assert.equal(result.draft.resource_decision.automatic,true);assert.equal(result.draft.artifact.task_proposals[0].resource_estimate.complexity,'simple');
  const id=result.draft.id;
  result=await post('api/plan/regenerate',{draftId:id,proposalId:'p1',provider:'auto',confirm:true});assert.equal(result.status,200,result.error);assert.equal(result.draft.model,'small');
  result=await post('api/plan/review',{draftId:id,provider:'auto'});assert.equal(result.status,200,result.error);assert.equal(result.review.model,'small');assert.equal(calls,3);
  result=await post('api/plan/generate',{intent:'Redesign a production migration',provider:'auto',confirm:true});assert.equal(result.status,400);assert.match(result.error,/ceiling/);assert.equal(calls,3,'inadequate model ceiling rejects before invoking any model');
  result=await post('api/plan/generate',{intent:'Fix a typo',provider:'gapgpt',model:'not-approved',confirm:true});assert.equal(result.status,400);assert.match(result.error,/override/);assert.equal(calls,3);
}finally{if(server)await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: automatic model routing for planning, regeneration and accuracy review; ceiling refusals before invoke');
