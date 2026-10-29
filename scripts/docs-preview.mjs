// Read-only synthetic UI for documentation captures. No real issue adapters.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {emptyState,createTask,saveState} from '../runtime/lib/state.mjs';
import {queueCreate,queueAdd} from '../runtime/lib/queue.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-docs-preview-'));
const home=path.join(root,'synthetic-home');fs.mkdirSync(home,{recursive:true});
process.env.USERPROFILE=home;process.env.HOME=home;delete process.env.ATL_PROJECT;
for(const key of Object.keys(process.env))if(/(?:TOKEN|API_KEY|PAT|SECRET)$/.test(key))delete process.env[key];
fs.mkdirSync(path.join(root,'config'),{recursive:true});
fs.writeFileSync(path.join(root,'config/manager.json'),JSON.stringify({version:1,intake:{github:{enabled:true,repos:['example/demo']},jira:{enabled:true,base_url:'https://jira.example.invalid',projects:['APP'],token_env:'DOCS_JIRA_TOKEN'},azure:{enabled:true,org_url:'https://devops.example.invalid/Collection',project:'Demo',iteration_path:'Demo\\Sprint 74',token_env:'DOCS_AZDO_PAT'}}},null,2));
const state=emptyState();
for(const [title,status]of [['Validate empty form submissions','triaged'],['Clarify the middleware retry behavior','new'],['Review task dependency evidence','blocked']]){
 const task=createTask(state,{title});
 task.objective=title+' in the synthetic documentation fixture';
 task.completion_checks=[{id:'C1',text:'Run the focused regression and retain its output',status:'pending'}];
 task.status=status;if(status==='blocked')task.blocker={reason:'Waiting for a synthetic prerequisite handoff',type:'dependency'};
}
saveState(root,state);
const queue=queueCreate(root,'docs-demo',{name:'Documentation demo'});queueAdd(root,'T-001',{queueId:queue.id});
const {startControlPlaneServer}=await import('../runtime/lib/control-plane-server.mjs');
const running=await startControlPlaneServer(root,{readOnlyPreview:true,intakeAdapters:{github:async()=>[],jira:async()=>[],azure:async()=>[]}});
console.log(JSON.stringify({url:running.url,fixture:'read-only synthetic documentation project',root}));
function stop(){running.server.close(()=>{fs.rmSync(root,{recursive:true,force:true});process.exit();});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
