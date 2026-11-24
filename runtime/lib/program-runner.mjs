import { projectDaemonBackend } from './execution-backend.mjs';
import { getProgram, updateProgram, programReport, projectFor, programTaskReady, claimProgramRunner, heartbeatProgramRunner, reconcileProgramRun, listRecoverablePrograms, recordProgramDispatch } from './programs.mjs';
import { randomUUID } from 'node:crypto';
import { loadState } from './state.mjs';
const active = new Map();
export const programRunnerActive = root => [...active.keys()].some(key=>key.startsWith(`${root}:`));
export async function driveProgram(root,id,{dispatch=null,pollMs=1000,backend=projectDaemonBackend()}={}){
  const key=`${root}:${id}`;
  if(active.has(key))return active.get(key);
  const owner=randomUUID();
  if(!claimProgramRunner(root,id,owner))return getProgram(root,id);
  const drive=async()=>{
    const running=new Map(),settled=new Set();let idleRounds=0;
    try {
      while(true){
        const p=getProgram(root,id);
        if(p.run?.status!=='running')break;
        heartbeatProgramRunner(root,id,owner);
        if(Object.values(p.run.sessions||{}).some(s=>s.status==='admitted')){
          // Unknown effects after a daemon restart must be reconciled by the owner.
          if(!running.size)break;
        }
        if(p.run.cancel_requested||Date.now()>=p.run.deadline_at){
          // Stop only this program's admitted project runs, never another project's unrelated run.
          for(const [project,entry] of running)await backend.cancel(project,entry.runId).catch(()=>{});
          if(!running.size)break;
        }
        const cap=Math.max(1,Math.min(5,p.maxConcurrent||2));
        for(const m of p.milestones){
          if(running.size>=cap||p.run.cancel_requested||Date.now()>=p.run.deadline_at||Object.keys(p.run.sessions).length>=p.authorization.limits.maxSessions)break;
          if(!m.tasks?.length)continue;
          const project=projectFor(m.projectId),state=loadState(project.root);
          if(running.has(project.root))continue;
          const task=m.tasks.map(ref=>state.tasks[ref.task]).find(t=>t&&!settled.has(`${project.id}:${t.id}`)&&['new','assigned','in_progress','in_review','verifying'].includes(t.status)&&programTaskReady(t)&&(t.plan_depends_on||[]).every(id=>state.tasks[id]?.status==='done'));
          if(!task)continue;
          await backend.prepare(project.root,task);
          const current=await backend.observe(project.root);
          if(current.run?.status==='running')continue;
          const options={taskIds:[task.id],confirm:true,maxMinutes:Math.max(0.01,(p.run.deadline_at-Date.now())/60000),maxSessions:Math.min(50,p.authorization.limits.maxSessions)};
          const dispatchId=randomUUID();
          recordProgramDispatch(root,id,dispatchId,{project:project.id,milestone:m.id,task:task.id,status:'starting'});
          try{const started=dispatch?await dispatch(project.root,'/api/run',options):await backend.dispatch(project.root,options);const runId=started.run?.runId;if(!runId)throw new Error('Project runtime did not return a run identity');recordProgramDispatch(root,id,dispatchId,{project:project.id,milestone:m.id,task:task.id,status:'running',runId});running.set(project.root,{project:project.id,task:task.id,dispatchId,runId});}
          catch(error){recordProgramDispatch(root,id,dispatchId,{project:project.id,milestone:m.id,task:task.id,status:'blocked',error:error.message});settled.add(`${project.id}:${task.id}`);updateProgram(root,id,current=>{current.history.push({at:new Date().toISOString(),event:'dispatch-blocked',task:task.id,reason:error.message});});}
        }
        for(const [project,entry] of running){
          const status=await backend.observe(project);
          if(status.run?.status==='running'&&status.run.runId!==entry.runId)throw new Error(`Project ${entry.project} run identity changed; reconcile task ${entry.task} before retrying`);
          if(status.run?.status!=='running'){running.delete(project);settled.add(`${entry.project}:${entry.task}`);recordProgramDispatch(root,id,entry.dispatchId,{project:entry.project,task:entry.task,status:'finished',run_status:status.run?.status||'unknown'});}
        }
        if(!running.size){
          const report=programReport(root,id),remaining=report.milestones.some(m=>m.status!=='verified');
          if(!remaining)break;
          if(Date.now()>=p.run.deadline_at||Object.keys(p.run.sessions).length>=p.authorization.limits.maxSessions)break;
          if(++idleRounds>=3)break;
        }else idleRounds=0;
        await new Promise(resolve=>setTimeout(resolve,pollMs));
      }
      return updateProgram(root,id,p=>{
        const report=programReport(root,id);
        p.run.status=Object.values(p.run.sessions).some(s=>s.status==='admitted')?'interrupted':p.run.cancel_requested?'stopped':report.milestones.every(m=>m.status==='verified')?'complete':Object.keys(p.run.sessions).length>=p.authorization.limits.maxSessions?'exhausted':Date.now()>=p.run.deadline_at?'deadline':'waiting';
        p.status=p.run.status;p.run.finished_at=Date.now();p.run.lease=null;
      });
    }catch(error){updateProgram(root,id,p=>{p.run.status='interrupted';p.status='needs-reconciliation';p.run.error=error.message;p.run.lease=null;});throw error;}
  };
  const promise=drive().finally(()=>active.delete(key));active.set(key,promise);return promise;
}
export async function resumePersistedPrograms(root){
  const resumed=[];
  for(const item of listRecoverablePrograms(root)){
    if(item.hasUnknownSessions||item.hasUnknownDispatches){reconcileProgramRun(root,item.id);continue;}
    const result=await driveProgram(root,item.id);
    if(result?.run?.status==='running')resumed.push(item.id);
  }
  return resumed;
}
