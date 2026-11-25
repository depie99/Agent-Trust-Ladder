import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson, readJson, withFileLock } from './file-transaction.mjs';
import { loadState, saveState } from './state.mjs';
import { supervisorSnapshot } from './supervisor.mjs';
import { loadPlanDraft } from './plan-studio.mjs';
import { loadQueue } from './queue.mjs';
const file = root => path.join(root, '.trust', 'manager', 'programs.json');
const empty = () => ({ version:1, revision:0, programs:{} });
const digest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const norm = value => String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
const requireText = (v, name) => { if(typeof v!=='string'||!v.trim())throw new Error(`${name} is required`);return v.trim(); };
export function projectFor(id) {
  const p=supervisorSnapshot().projects.find(p=>p.id===id);
  if(!p)throw new Error(`Unknown registered project ${id}`);
  return p;
}
export function validateProgram(input) {
  if(!input || typeof input !== 'object' || Array.isArray(input))throw new Error('Program must be an object');
  const allowed=['outcome','requirements','milestones','limits','maxConcurrent'];
  if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('Program contains server-owned or unknown fields');
  if(input.maxConcurrent!==undefined&&(!Number.isInteger(input.maxConcurrent)||input.maxConcurrent<1||input.maxConcurrent>5))throw new Error('maxConcurrent must be 1-5');
  requireText(input.outcome,'Program outcome');
  if(!Array.isArray(input.requirements)||!input.requirements.length||input.requirements.some(r=>typeof r!=='string'||!r.trim()))throw new Error('Program requirements are required');
  if(!Array.isArray(input.milestones)||!input.milestones.length)throw new Error('Program needs milestones');
  const ids=new Set();
  for(const m of input.milestones){
    if(Object.keys(m).some(key=>!['id','projectId','outcome','acceptance','dependsOn'].includes(key)))throw new Error('Milestone bindings must be assigned through reviewed plan binding');
    requireText(m.id,'Milestone id');if(ids.has(m.id))throw new Error('Duplicate milestone id');ids.add(m.id);
    projectFor(m.projectId);
    requireText(m.outcome,'Milestone outcome');
    if(!Array.isArray(m.acceptance)||!m.acceptance.length||m.acceptance.some(c=>typeof c!=='string'||!c.trim()))throw new Error('Milestone acceptance checks are required');
    if(!Array.isArray(m.dependsOn)||m.dependsOn.some(d=>typeof d!=='string'))throw new Error('Milestone dependsOn must be a list');
  }
  const visiting=new Set(),done=new Set();
  const visit=id=>{if(visiting.has(id))throw new Error('Program dependency cycle');if(done.has(id))return;const m=input.milestones.find(m=>m.id===id);if(!m)throw new Error(`Unresolved milestone ${id}`);visiting.add(id);for(const d of m.dependsOn)visit(d);visiting.delete(id);done.add(id);};
  for(const m of input.milestones)visit(m.id);
  const scopedContract=input.milestones.flatMap(m=>[m.outcome,...m.acceptance]).map(norm).join('\n');
  for(const requirement of input.requirements)if(!scopedContract.includes(norm(requirement)))throw new Error(`Program requirement is not covered by a milestone: ${requirement}`);
  if(!Number.isInteger(input.limits?.maxSessions)||input.limits.maxSessions<1||!Number.isFinite(input.limits?.maxMinutes)||input.limits.maxMinutes<=0)throw new Error('Program needs positive total session and time limits');
  return true;
}
export function saveProgram(root,payload){
  validateProgram(payload.program);requireText(payload.idempotencyKey,'idempotencyKey');
  return withFileLock(file(root),()=>{
    const book=readJson(file(root),empty());const hash=digest(payload);
    const existing=Object.values(book.programs).find(p=>p.operations?.[payload.idempotencyKey]);
    if(existing){if(existing.operations[payload.idempotencyKey]!==hash)throw new Error('Program idempotency key reused with different content');return existing;}
    const prior=payload.programId?book.programs[payload.programId]:null;
    if(payload.programId&&!prior)throw new Error('Unknown program');
    if(prior&&prior.revision!==payload.expectedRevision)throw new Error('Program revision changed');
    if(prior?.authorization||prior?.run)throw new Error('Approved program contracts are immutable; create a successor program for changed scope');
    const id=prior?.id||`program-${crypto.randomUUID()}`;
    const program={...structuredClone(payload.program),id,coordinator:fs.realpathSync(root),revision:(prior?.revision||0)+1,status:'draft',operations:{...(prior?.operations||{}),[payload.idempotencyKey]:hash},history:[...(prior?.history||[]),{at:new Date().toISOString(),event:'planned',reason:payload.reason||'Developer chat planning'}]};
    book.programs[id]=program;book.revision++;atomicJson(file(root),book);return program;
  });
}
export function getProgram(root,id){const p=readJson(file(root),empty()).programs[id];if(!p)throw new Error('Unknown program');return p;}
export function listPrograms(root){return Object.values(readJson(file(root),empty()).programs);}
export function updateProgram(root,id,fn){return withFileLock(file(root),()=>{const book=readJson(file(root),empty()),p=book.programs[id];if(!p)throw new Error('Unknown program');const result=fn(p);p.revision++;book.revision++;atomicJson(file(root),book);return result===undefined?p:result;});}
export function approveProgram(root,payload){return updateProgram(root,payload.programId,p=>{
  if(payload.confirm!==true||!payload.idempotencyKey)throw new Error('Program approval needs explicit confirmation and idempotencyKey');
  if(p.authorization?.idempotencyKey===payload.idempotencyKey)return;
  if(p.revision!==payload.expectedRevision)throw new Error('Program revision changed');
  validateProgram({outcome:p.outcome,requirements:p.requirements,milestones:p.milestones.map(({id,projectId,outcome,acceptance,dependsOn})=>({id,projectId,outcome,acceptance,dependsOn})),limits:p.limits,maxConcurrent:p.maxConcurrent});
  p.authorization={revision:p.revision,requirements:digest(p.requirements),limits:{...p.limits},at:new Date().toISOString(),idempotencyKey:payload.idempotencyKey};p.status='approved';
});}
export async function bindProgramMilestone(root,payload,{link=linkProgramTasks}={}){
  // Binding requires already-reviewed canonical tasks. It cannot manufacture plan approval.
  const p=getProgram(root,payload.programId),m=p.milestones.find(m=>m.id===payload.milestoneId);
  if(!p.authorization||!m)throw new Error('Select an approved program milestone');
  const report=programReport(root,p.id),unresolved=m.dependsOn.map(id=>report.milestones.find(entry=>entry.id===id)).filter(entry=>entry?.status!=='verified');
  if(unresolved.length)throw new Error('Elaborate and bind this milestone only after every predecessor is verified integrated');
  if(m.draftId===payload.draftId&&!p.pending_bindings?.[m.id])return p;
  const pending=p.pending_bindings?.[m.id];
  if(pending&&(pending.draftId!==payload.draftId||pending.expectedRevision!==payload.expectedRevision))throw new Error('Another milestone binding needs reconciliation');
  if(!pending&&p.revision!==payload.expectedRevision)throw new Error('Program revision changed');
  if(p.run?.status==='running')throw new Error('Stop the program before binding another milestone');
  const project=projectFor(m.projectId),draft=loadPlanDraft(project.root,payload.draftId),state=loadState(project.root);
  const tasks=Object.values(state.tasks).filter(t=>t.plan_draft_id===draft.id);
  if(!tasks.length||!draft.review||draft.review.verdict!=='passed')throw new Error('Milestone needs a reviewed and approved plan queue');
  const artifact=draft.artifact||{},scope=[artifact.objective,...(artifact.requirements||[]).map(r=>typeof r==='string'?r:r.text),...(artifact.completion_checks||[]),...(artifact.task_proposals||[]).flatMap(t=>[t.objective,...(t.completion_checks||[])])].map(norm).join('\n');
  if(!scope.includes(norm(m.outcome)))throw new Error(`Reviewed plan does not include milestone outcome: ${m.outcome}`);
  const checks=new Set([...(artifact.completion_checks||[]),...(artifact.task_proposals||[]).flatMap(t=>t.completion_checks||[])].map(norm));
  for(const acceptance of m.acceptance)if(!checks.has(norm(acceptance)))throw new Error(`Reviewed plan is missing milestone acceptance check: ${acceptance}`);
  if(m.draftId&&m.draftId!==draft.id){
    if(payload.replacesDraftId!==m.draftId||!String(payload.reason||'').trim())throw new Error('Technical replanning requires replacesDraftId and a reason; milestone contracts and limits remain fixed');
    if((m.tasks||[]).some(ref=>['in_progress','in_review','verifying'].includes(state.tasks[ref.task]?.status)))throw new Error('Stop active milestone work before replacing its plan');
    const newRequirements=draft.artifact.requirements.map(r=>r.text);
    const priorRequirements=loadPlanDraft(project.root,m.draftId).artifact.requirements.map(r=>r.text);
    if(digest(newRequirements)!==digest(priorRequirements))throw new Error('Changed requirements need a newly approved successor program');
  }
  if(!pending)updateProgram(root,p.id,current=>{
    if(current.revision!==payload.expectedRevision||current.run?.status==='running')throw new Error('Program changed before milestone binding');
    current.pending_bindings||={};current.pending_bindings[m.id]={draftId:draft.id,expectedRevision:payload.expectedRevision,started_at:new Date().toISOString()};
  });
  await link(project.root,{coordinator:fs.realpathSync(root),programId:p.id,milestoneId:m.id,draftId:draft.id});
  return updateProgram(root,p.id,current=>{
    const milestone=current.milestones.find(x=>x.id===m.id);
    if(current.pending_bindings?.[m.id]?.draftId!==draft.id)throw new Error('Milestone binding reservation changed; inspect project status');
    if(current.run?.status==='running')throw new Error('Stop the program before finalizing this binding');
    if(milestone.draftId===draft.id){delete current.pending_bindings[m.id];return;}
    if(milestone.draftId&&milestone.draftId!==draft.id){
      milestone.prior_plans=[...(milestone.prior_plans||[]),{draftId:milestone.draftId,tasks:milestone.tasks,reason:payload.reason,at:new Date().toISOString()}];
    }
    milestone.draftId=draft.id;milestone.queueId=tasks[0].plan_queue_id;milestone.tasks=tasks.map(t=>({project:m.projectId,task:t.id}));milestone.status='queued';
    delete current.pending_bindings[m.id];
    current.history.push({at:new Date().toISOString(),event:'milestone-bound',milestone:m.id,draftId:draft.id,reason:payload.reason||'Reviewed plan handoff'});
  });
}
export function linkProgramTasks(root,payload){
  const p=getProgram(payload.coordinator,payload.programId),m=p.milestones.find(m=>m.id===payload.milestoneId);
  if(!p.authorization||!m||fs.realpathSync(projectFor(m.projectId).root)!==fs.realpathSync(root))throw new Error('Program project assignment mismatch');
  const state=loadState(root),draft=loadPlanDraft(root,payload.draftId),tasks=Object.values(state.tasks).filter(t=>t.plan_draft_id===draft.id);
  if(!tasks.length||draft.review?.verdict!=='passed')throw new Error('Milestone needs approved reviewed tasks');
  for(const task of tasks){
    if(!['assigned','triaged','new','done'].includes(task.status))throw new Error('Stop active tasks before program assignment');
    if(task.program_ref&&(task.program_ref.id!==p.id||task.program_ref.milestone!==m.id))throw new Error('Task belongs to another milestone');
    task.program_ref={root:p.coordinator,id:p.id,milestone:m.id,project:m.projectId};
  }
  saveState(root,state);return {linked:tasks.map(t=>t.id)};
}
function milestoneComplete(m){
  if(!m.tasks?.length)return false;
  const state=loadState(projectFor(m.projectId).root);
  return m.tasks.every(ref=>state.tasks[ref.task]?.status==='done')&&m.tasks.some(ref=>{
    const task=state.tasks[ref.task];
    return task.integrated_delivery && task.status==='done' && readJson(path.join(projectFor(m.projectId).root,'.trust','manager','delivery-packets.json'),{packets:[]}).packets.some(packet=>packet.integrated&&packet.task_id===task.id&&packet.commit);
  });
}
export function programTaskReady(task){
  if(!task.program_ref)return true;
  try{
    const ref=task.program_ref,p=getProgram(ref.root,ref.id),m=p.milestones.find(m=>m.id===ref.milestone);
    if(!p.authorization||!m||m.draftId!==task.plan_draft_id||p.status==='paused'||p.run?.status!=='running'||p.run?.cancel_requested)return false;
    return m.dependsOn.every(id=>{const predecessor=p.milestones.find(m=>m.id===id);return predecessor&&milestoneComplete(predecessor);});
  }catch{return false;}
}
export function programReport(root,id){
  const p=getProgram(root,id);
  const milestones=p.milestones.map(m=>{
    const project=projectFor(m.projectId),state=loadState(project.root);
    const tasks=(m.tasks||[]).map(ref=>{const t=state.tasks[ref.task];return {...ref,status:t?.status||'missing',budget:t?.execution_budget||null,blocker:t?.block||null,delivery:t?.delivery||null};});
    const dependenciesReady=m.dependsOn.every(id=>{const predecessor=p.milestones.find(entry=>entry.id===id);return predecessor&&milestoneComplete(predecessor);});
    const allDone=tasks.length>0&&tasks.every(t=>t.status==='done');
    const status=milestoneComplete(m)?'verified':!tasks.length?'needs-plan':!dependenciesReady?'waiting-prerequisite':tasks.some(t=>['blocked','escalated'].includes(t.status))?'blocked':tasks.some(t=>['in_progress','in_review','verifying'].includes(t.status))?'running':allDone?'awaiting-integration':tasks.some(t=>['assigned','triaged','new'].includes(t.status))?'ready':m.status||'needs-plan';
    return {...m,status,tasks};
  });
  return {...p,milestones,next_actions:milestones.filter(m=>m.status==='needs-plan').map(m=>({milestone:m.id,action:'elaborate_plan_in_harness',project:m.projectId})).concat(milestones.filter(m=>m.status==='waiting-prerequisite').map(m=>({milestone:m.id,action:'wait_for_dependencies',dependsOn:m.dependsOn})))};
}
export function programPlanningContext(root,id,milestoneId){
  const report=programReport(root,id),milestone=report.milestones.find(m=>m.id===milestoneId);
  if(!milestone)throw new Error('Unknown program milestone');
  const dependencies=milestone.dependsOn.map(dep=>report.milestones.find(m=>m.id===dep)).filter(Boolean);
  const ready=dependencies.every(m=>m.status==='verified');
  const inputs=ready?dependencies.flatMap(m=>m.tasks.map(ref=>{
    const projectRoot=projectFor(ref.project).root,task=loadState(projectRoot).tasks[ref.task];
    const packet=readJson(path.join(projectRoot,'.trust','manager','delivery-packets.json'),{packets:[]}).packets.find(item=>item.integrated&&item.task_id===ref.task);
    return {project:ref.project,task:ref.task,title:task?.title,commit:task?.delivery?.commit||packet?.commit||null,branch:task?.delivery?.branch||packet?.branch||null,changed_files:task?.handoff?.changed_files||[],checks:(task?.evidence||[]).filter(e=>e.result==='pass'&&!e.invalidated).map(e=>e.check).filter(Boolean)};
  })):[];
  return {programId:id,milestoneId,outcome:milestone.outcome,acceptance:milestone.acceptance,ready,blocked_by:dependencies.filter(m=>m.status!=='verified').map(m=>({milestone:m.id,status:m.status})),predecessor_evidence:inputs};
}
// Charged before provider spawn. A crash retains the charge rather than refunding unknown work.
export function admitProgramSession(task, executionId){
  if(!task.program_ref)return null;
  const ref=task.program_ref;
  return updateProgram(ref.root,ref.id,p=>{
    if(!p.authorization||p.run?.status!=='running'||p.run.cancel_requested)throw new Error('Program has no active execution authorization');
    if(Date.now()>=p.run.deadline_at)throw new Error('Program deadline reached');
    if(p.run.sessions[executionId])throw new Error('Program session already admitted; reconcile before replay');
    if(Object.keys(p.run.sessions).length>=p.authorization.limits.maxSessions)throw new Error('Program total session budget exhausted');
    p.run.sessions[executionId]={project:ref.project,task:task.id,at:Date.now(),status:'admitted'};
    return {deadline:p.run.deadline_at};
  });
}
export function settleProgramSession(task,executionId,outcome){
  if(!task.program_ref)return;
  const ref=task.program_ref;
  updateProgram(ref.root,ref.id,p=>{const session=p.run?.sessions[executionId];if(session){session.status='returned';session.outcome=outcome;session.finished_at=Date.now();}});
}
export function beginProgramRun(root,payload){
  return updateProgram(root,payload.programId,p=>{
    if(payload.confirm!==true||!payload.idempotencyKey)throw new Error('Explicit program run confirmation and idempotencyKey required');
    if(p.run?.idempotencyKey===payload.idempotencyKey)return;
    if(p.revision!==payload.expectedRevision)throw new Error('Program revision changed; inspect before authorizing');
    if(!p.authorization)throw new Error('Program contracts need approval first');
    if(Object.keys(p.pending_bindings||{}).length)throw new Error('Finish or reconcile pending milestone bindings before starting');
    if(p.run?.status==='running')throw new Error('Program already running; inspect status');
    if(p.run?.status==='interrupted')throw new Error('Program interrupted; reconcile unknown sessions before resuming');
    const previous=p.run;
    p.run={status:'running',idempotencyKey:payload.idempotencyKey,started_at:previous?.started_at||Date.now(),deadline_at:previous?.deadline_at||Date.now()+p.authorization.limits.maxMinutes*60000,sessions:previous?.sessions||{},dispatches:previous?.dispatches||{},cancel_requested:false,lease:null};
    p.status='running';
  });
}
export function stopProgramRun(root,id){return updateProgram(root,id,p=>{if(p.run)p.run.cancel_requested=true;p.status='paused';});}
export function reconcileProgramRun(root,id){return updateProgram(root,id,p=>{
  if(!p.run)return;
  if(Object.values(p.run.sessions).some(s=>s.status==='admitted')||Object.values(p.run.dispatches||{}).some(d=>['starting','running'].includes(d.status))){p.run.status='interrupted';p.status='needs-reconciliation';}
  else if(p.run.status==='running'){p.run.status='interrupted';p.status='needs-reconciliation';}
});}
export function recordProgramDispatch(root,id,dispatchId,entry){
  return updateProgram(root,id,p=>{
    if(p.run?.status!=='running')throw new Error('Program is not running');
    const old=p.run.dispatches?.[dispatchId];
    if(old&&old.task!==entry.task)throw new Error('Dispatch id is already bound to another task');
    p.run.dispatches||={};p.run.dispatches[dispatchId]={...old,...entry,updated_at:Date.now()};
  });
}
export function resolveProgramInterruption(root,id,{decisions,confirm=false}){
  return updateProgram(root,id,p=>{
    if(confirm!==true||p.run?.status!=='interrupted'||!Array.isArray(decisions)||!decisions.length)throw new Error('Confirm reviewed decisions for every uncertain program dispatch');
    const unknown=Object.entries(p.run.dispatches||{}).filter(([,d])=>['starting','running'].includes(d.status));
    const byId=new Map(decisions.map(d=>[d.dispatchId,d]));
    if(unknown.some(([dispatchId])=>!byId.has(dispatchId))||decisions.length!==unknown.length)throw new Error('Resolve every uncertain dispatch exactly once');
    for(const [dispatchId,dispatch] of unknown){
      const decision=byId.get(dispatchId);
      if(!['completed','safe-to-retry','blocked'].includes(decision.outcome)||typeof decision.evidence!=='string'||!decision.evidence.trim())throw new Error(`Dispatch ${dispatchId} needs a supported outcome and evidence`);
      if(decision.outcome==='completed'){
        const milestone=p.milestones.find(m=>m.id===dispatch.milestone);
        const verified=milestone&&programReport(root,id).milestones.find(entry=>entry.id===milestone.id)?.status==='verified';
        if(!verified)throw new Error(`Milestone ${dispatch.milestone} is not verified integrated; do not mark dispatch completed`);
      }
      dispatch.status=decision.outcome==='safe-to-retry'?'retry-approved':decision.outcome;
      dispatch.reconciliation={evidence:decision.evidence,at:new Date().toISOString()};
      for(const session of Object.values(p.run.sessions||{}))if(session.task===dispatch.task&&session.status==='admitted')session.status='reconciled-unknown';
    }
    p.run.status='ready-to-resume';p.run.cancel_requested=false;p.run.lease=null;p.status='ready-to-resume';
    p.history.push({at:new Date().toISOString(),event:'interruption-reconciled',decisions:decisions.map(d=>({dispatchId:d.dispatchId,outcome:d.outcome,evidence:d.evidence}))});
  });
}

// A persisted lease prevents two daemon processes from driving the same program.
// Expired leases are reclaimable only when their owner process is gone.
export function claimProgramRunner(root,id,owner,leaseMs=15000){
  return withFileLock(file(root),()=>{
    const book=readJson(file(root),empty()),p=book.programs[id];if(!p)throw new Error('Unknown program');
    if(p.run?.status!=='running')return false;
    const lease=p.run.lease;
    if(lease&&lease.owner!==owner&&lease.expires_at>Date.now())return false;
    if(lease&&lease.owner!==owner){
      try{process.kill(lease.pid,0);return false;}catch(error){if(error.code!=='ESRCH')return false;}
    }
    p.run.lease={owner,pid:process.pid,expires_at:Date.now()+leaseMs};p.revision++;book.revision++;atomicJson(file(root),book);return true;
  });
}
export function heartbeatProgramRunner(root,id,owner,leaseMs=15000){
  return updateProgram(root,id,p=>{
    if(p.run?.status!=='running'||p.run.lease?.owner!==owner)throw new Error('Program runner lease was lost');
    p.run.lease.expires_at=Date.now()+leaseMs;
  });
}
export function listRecoverablePrograms(root){
  return listPrograms(root).filter(p=>p.run?.status==='running').map(p=>({id:p.id,hasUnknownSessions:Object.values(p.run.sessions||{}).some(s=>s.status==='admitted'),hasUnknownDispatches:Object.values(p.run.dispatches||{}).some(d=>['starting','running'].includes(d.status))}));
}
