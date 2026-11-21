import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {emptyState,saveState,loadState} from '../runtime/lib/state.mjs';
import {registerProject} from '../runtime/lib/supervisor.mjs';
import {saveProgram,approveProgram,bindProgramMilestone,getProgram,programTaskReady,beginProgramRun,admitProgramSession,settleProgramSession,programReport,stopProgramRun,updateProgram,resolveProgramInterruption,programPlanningContext} from '../runtime/lib/programs.mjs';
import {bootstrapRepository,repositoryContext} from '../runtime/lib/harness-planning.mjs';
import {ensureWorkspace} from '../runtime/lib/workspace.mjs';
import {savePlanDraft,loadPlanDraft,reviewPlanArtifact,approvePlanDraft} from '../runtime/lib/plan-studio.mjs';
import {createRunPreview,consumeRunPreview} from '../runtime/lib/run-authorization.mjs';
import {driveProgram} from '../runtime/lib/program-runner.mjs';
import {atomicJson} from '../runtime/lib/file-transaction.mjs';
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'atl-program-'));
const oldHome=process.env.ATL_HOME;process.env.ATL_HOME=path.join(sandbox,'personal');
try{
  const roots=['coordinator','api','web'].map(n=>{const root=path.join(sandbox,n);fs.mkdirSync(root);saveState(root,emptyState());return root;});
  const [coordinator,api,web]=roots;
  for(const root of [api,web]){
    assert.throws(()=>bootstrapRepository(root,{}),/confirmation/);
    bootstrapRepository(root,{confirm:true});
    assert.equal(repositoryContext(root).bootstrap_required,false);
    // Build a real executable application from an empty base in an isolated worktree.
    const base=repositoryContext(root).base_revision;
    fs.writeFileSync(path.join(root,'developer.txt'),'uncommitted developer work');
    const workspace=ensureWorkspace(root,{}, {id:'BOOTSTRAP',base_revision:base});
    fs.writeFileSync(path.join(workspace.dir,'app.mjs'),"export const greet = name => `Hello ${name}`;\n");
    fs.writeFileSync(path.join(workspace.dir,'check.mjs'),"import assert from 'node:assert/strict';import {greet} from './app.mjs';assert.equal(greet('ATL'),'Hello ATL');\n");
    execFileSync(process.execPath,['check.mjs'],{cwd:workspace.dir,stdio:'pipe'});
    assert.equal(fs.existsSync(path.join(root,'app.mjs')),false);
    assert.equal(fs.readFileSync(path.join(root,'developer.txt'),'utf8'),'uncommitted developer work');
    assert.equal(repositoryContext(root).base_revision,base);
    fs.mkdirSync(path.join(root,'verification'),{recursive:true});fs.writeFileSync(path.join(root,'verification','fixture.mjs'),'// fixture');
  }
  const projects=[registerProject(api),registerProject(web)];
  const contract={outcome:'Build API and web application',requirements:['API works','Web works with API'],limits:{maxSessions:3,maxMinutes:20},maxConcurrent:2,milestones:[{id:'api',projectId:projects[0].id,outcome:'API works',acceptance:['API checks pass'],dependsOn:[]},{id:'web',projectId:projects[1].id,outcome:'Web works with API',acceptance:['Integrated journey passes'],dependsOn:['api']} ]};
  assert.throws(()=>saveProgram(coordinator,{program:{...contract,authorization:{}},idempotencyKey:'forged'}),/server-owned/);
  assert.throws(()=>saveProgram(coordinator,{program:{...contract,milestones:contract.milestones.map(m=>({...m,dependsOn:m.id==='api'?['web']:['api']}))},idempotencyKey:'cycle'}),/cycle/);
  assert.throws(()=>saveProgram(coordinator,{program:{...contract,milestones:contract.milestones.map(m=>({...m,dependsOn:['missing']}))},idempotencyKey:'missing'}),/Unresolved/);
  let p=saveProgram(coordinator,{program:contract,idempotencyKey:'program'});
  assert.equal(saveProgram(coordinator,{program:contract,idempotencyKey:'program'}).id,p.id);
  p=approveProgram(coordinator,{programId:p.id,expectedRevision:p.revision,confirm:true,idempotencyKey:'approve'});
  const makeReviewedPlan=i=>{
    const root=projects[i].root;
    const artifact=JSON.parse(fs.readFileSync(new URL('./plan_contract_fixture.json',import.meta.url)));
    const milestone=contract.milestones[i];
    artifact.objective=milestone.outcome;
    artifact.requirements[0].text=milestone.outcome;
    artifact.completion_checks=[milestone.acceptance[0]];
    artifact.task_proposals[0].objective=milestone.outcome;
    artifact.task_proposals[0].completion_checks=[milestone.acceptance[0]];
    let draft=savePlanDraft(root,{intent:artifact.objective,artifact});
    draft=reviewPlanArtifact(root,loadPlanDraft(root,draft.id),{verdict:'passed',findings:[]});
    const approved=approvePlanDraft(root,draft);
    return {draftId:draft.id,taskIds:approved.taskIds};
  };
  const apiPlan=makeReviewedPlan(0);
  p=await bindProgramMilestone(coordinator,{programId:p.id,milestoneId:'api',draftId:apiPlan.draftId,expectedRevision:p.revision});
  const first=loadState(api).tasks[apiPlan.taskIds[0]];
  assert.equal(programTaskReady(first),false,'program-bound queue tasks cannot bypass program run authorization');
  assert.throws(()=>admitProgramSession(first,'before-start'),/authorization/);
  p=beginProgramRun(coordinator,{programId:p.id,expectedRevision:p.revision,confirm:true,idempotencyKey:'run'});
  assert.equal(programTaskReady(first),true);
  assert.equal(programPlanningContext(coordinator,p.id,'web').ready,false,'dependent milestone planning waits for integrated predecessor evidence');
  admitProgramSession(first,'api-session');settleProgramSession(first,'api-session',{code:0});
  // Simulate a verified integrated delivery produced by the existing delivery engine.
  const state=loadState(api);for(const id of apiPlan.taskIds)state.tasks[id].status='done';saveState(api,state);
  const integrated=apiPlan.taskIds.at(-1);
  atomicJson(path.join(api,'.trust','manager','delivery-packets.json'),{packets:[{integrated:true,task_id:integrated,commit:'fixture-reviewed-commit'}]});
  const planningContext=programPlanningContext(coordinator,p.id,'web');
  assert.equal(planningContext.ready,true);assert.equal(planningContext.predecessor_evidence[0].commit,'fixture-reviewed-commit');
  updateProgram(coordinator,p.id,current=>{current.run.status='waiting';current.status='waiting';});
  const webPlan=makeReviewedPlan(1);
  p=getProgram(coordinator,p.id);
  p=await bindProgramMilestone(coordinator,{programId:p.id,milestoneId:'web',draftId:webPlan.draftId,expectedRevision:p.revision});
  p=beginProgramRun(coordinator,{programId:p.id,expectedRevision:p.revision,confirm:true,idempotencyKey:'run-web'});
  const second=loadState(web).tasks[webPlan.taskIds[0]];
  assert.equal(programTaskReady(second),true);
  admitProgramSession(second,'web-session');settleProgramSession(second,'web-session',{code:0});
  assert.throws(()=>admitProgramSession(second,'web-session'),/already admitted/);
  assert.equal(Object.keys(getProgram(coordinator,p.id).run.sessions).length,2);
  const fakeRuns=new Map();
  const fakeBackend={
    kind:'test-local',prepare:async()=>true,observe:async root=>({run:fakeRuns.get(root)||{status:'idle'}}),
    dispatch:async(root,options)=>{
      const taskId=options.taskIds[0],projectTask=loadState(root).tasks[taskId],runId='fake-program-run';
      admitProgramSession(projectTask,runId);
      const projectState=loadState(root);projectState.tasks[taskId].status='done';saveState(root,projectState);
      settleProgramSession(projectTask,runId,{code:0});
      atomicJson(path.join(root,'.trust','manager','delivery-packets.json'),{packets:[{integrated:true,task_id:taskId,commit:'fake-integrated-commit'}]});
      fakeRuns.set(root,{status:'complete',runId});return {run:{runId}};
    },cancel:async()=>({ok:true}),reconcile:async root=>({run:fakeRuns.get(root)||null}),artifacts:()=>({}),
  };
  p=await driveProgram(coordinator,p.id,{backend:fakeBackend,pollMs:0});
  assert.equal(p.run.status,'complete',JSON.stringify(programReport(coordinator,p.id).milestones));assert.equal(p.run.dispatches[Object.keys(p.run.dispatches)[0]].status,'finished');
  assert.equal(Object.keys(p.run.sessions).length,3);
  p=beginProgramRun(coordinator,{programId:p.id,expectedRevision:p.revision,confirm:true,idempotencyKey:'run-budget-check'});
  assert.throws(()=>admitProgramSession(second,'over-budget'),/budget exhausted/);
  const report=programReport(coordinator,p.id);assert.equal(report.milestones[0].status,'verified');
  stopProgramRun(coordinator,p.id);assert.equal(programTaskReady(second),false);
  const queueId=getProgram(coordinator,p.id).milestones[1].queueId;
  updateProgram(coordinator,p.id,current=>{current.run.status='interrupted';current.run.dispatches={uncertain:{status:'running',project:projects[1].id,milestone:'web',task:second.id}};});
  assert.throws(()=>resolveProgramInterruption(coordinator,p.id,{confirm:true,decisions:[]}),/every uncertain/);
  p=resolveProgramInterruption(coordinator,p.id,{confirm:true,decisions:[{dispatchId:'uncertain',outcome:'safe-to-retry',evidence:'Inspected the task workspace and confirmed no implementation files or receipts were produced.'}]});
  assert.equal(p.run.status,'ready-to-resume');assert.equal(p.run.dispatches.uncertain.status,'retry-approved');
  assert.equal(p.run.sessions['web-session'].status,'returned','reconciliation preserves already settled session accounting');
  const options={queueId,maxMinutes:10,maxSessions:2};
  const preview=createRunPreview(web,options,{});
  const edited=loadState(web);edited.tasks[second.id].title='Changed after preview';saveState(web,edited);
  assert.throws(()=>consumeRunPreview(web,{previewToken:preview.previewToken,confirm:true,idempotencyKey:'stale'}),/changed after preview/);
  const fresh=createRunPreview(web,options,{});
  assert.equal(consumeRunPreview(web,{previewToken:fresh.previewToken,confirm:true,idempotencyKey:'start'}).maxSessions,2);
  assert.equal(consumeRunPreview(web,{previewToken:fresh.previewToken,confirm:true,idempotencyKey:'start'}).replay,true);
  assert.throws(()=>consumeRunPreview(web,{previewToken:fresh.previewToken,confirm:true,idempotencyKey:'different'}),/already submitted/);
  console.log('PASS: empty-repository executable bootstrap, isolated pinned worktrees, program DAG validation, reviewed queue bindings, cross-project gates, aggregate budgets and exact run previews');
}finally{if(oldHome===undefined)delete process.env.ATL_HOME;else process.env.ATL_HOME=oldHome;fs.rmSync(sandbox,{recursive:true,force:true});}
