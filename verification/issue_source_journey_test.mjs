import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState, saveState, loadState } from '../runtime/lib/state.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
import { intakeFromJira } from '../runtime/lib/intake.mjs';
import { loadQueueBook } from '../runtime/lib/queue.mjs';
import { buildLaunchPlan } from '../runtime/lib/launch.mjs';
import { taskResourcePreview } from '../runtime/lib/resource-policy.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-issue-journey-'));
fs.mkdirSync(path.join(root,'config'),{recursive:true});
fs.writeFileSync(path.join(root,'config','manager.json'),JSON.stringify({version:1,providers:{default:'codex'}}));
saveState(root,emptyState());
const originalToken=process.env.JIRA_TOKEN;process.env.JIRA_TOKEN='synthetic-test-token';
const calls=[];
const jiraFetch=async (url,options)=>{calls.push({url,authorization:options.headers.Authorization});return {ok:true,json:async()=>({issues:[
 {key:'IT-1054109',fields:{summary:'Repair a broken task view',description:'The task view fails when change data is missing. Show a useful empty state and verify the modal.',updated:'2026-10-29T10:00:00Z',priority:{name:'High'},labels:['ui']}},
 {key:'IS-4846',fields:{summary:'Improve overnight issue flow',description:'Connect issue intake, classify vague descriptions, plan multiple tasks, and verify shipping.',updated:'2026-10-29T11:00:00Z',labels:['planning']}},
 {key:'OTHER-1',fields:{summary:'Unselected project',updated:'2026-10-29T11:00:00Z'}}]})};};
const adapters={jira:(cfg)=>intakeFromJira(cfg,{fetchImpl:jiraFetch}),github:async()=>[{title:'#17 Fix a null review panel',objective_hint:'When review data is absent, show a recovery message.',completion_checks:[],priority:'high',risk:'normal',labels:['bug'],source:{type:'github',url:'https://github.com/example/demo/issues/17',repo:'example/demo',remote_id:17,revision:'r1'},intake_key:'https://github.com/example/demo/issues/17'}]};
let server;
try{
 const running=await startControlPlaneServer(root,{intakeAdapters:adapters});server=running.server;
 const post=async (endpoint,body)=>{const response=await fetch(running.url+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,...await response.json()};};
 assert.equal((await post('api/intake/sources',{source:'jira',enabled:true,base_url:'https://servicedesk.solico-group.com',projects:'IT, IS',token_env:'JIRA_TOKEN'})).ok,true);
 assert.equal((await post('api/intake/sources',{source:'github',enabled:true,repos:'example/demo'})).ok,true);
 const jira=await post('api/intake/preview',{source:'jira'});assert.equal(jira.candidates.length,2);assert.equal(calls.length,1);
 assert.match(calls[0].url,/servicedesk\.solico-group\.com\/rest\/api\/2\/search/);
 assert.equal(calls[0].authorization,'Bearer synthetic-test-token');
 const invalid=await post('api/intake/import',{token:'bad',indices:[0],queueId:'jira-intake'});assert.equal(invalid.status,400);
 const imported=await post('api/intake/import',{token:jira.token,indices:[0,1],queueId:'jira-intake'});assert.equal(imported.added,2);
 assert.equal(loadQueueBook(root).queues['jira-intake'].items.length,2);
 const tasks=imported.taskIds.map(id=>loadState(root).tasks[id]);
 assert.ok(tasks.every(task=>task.plan_review_required),'imported issues need plan review');
 assert.ok(tasks.every(task=>task.status==='new'),'import does not claim implementation');
 assert.ok(tasks[1].objective_hint.includes('plan multiple tasks'));
 const plan=buildLaunchPlan(root,{taskIds:imported.taskIds,maxSessions:8});assert.ok(plan.items.some(item=>item.blockers?.length),'unreviewed issue cannot launch as completed work');
 const github=await post('api/intake/preview',{source:'github'});assert.equal(github.candidates.length,1);
 const ghImport=await post('api/intake/import',{token:github.token,indices:[0],queueId:'github-intake'});assert.equal(ghImport.added,1);assert.equal(loadQueueBook(root).queues['github-intake'].items.length,1);
 const retry=await post('api/intake/preview',{source:'jira'});const duplicate=await post('api/intake/import',{token:retry.token,indices:[0,1],queueId:'jira-intake'});assert.equal(duplicate.skipped,2);
 const resource=taskResourcePreview({providers:{default:'codex'}},tasks[0]);assert.ok(resource.routing.selected.provider);
 console.log('PASS: mock Jira/GitHub connect → preview → select → deduplicated task/queue import; unreviewed run blocked; model route visible');
}finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});if(originalToken===undefined)delete process.env.JIRA_TOKEN;else process.env.JIRA_TOKEN=originalToken;}
