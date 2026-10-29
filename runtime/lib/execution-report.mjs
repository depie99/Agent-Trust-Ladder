import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {archiveSource, addClaim} from './brain.mjs';
import {queueList} from './queue.mjs';

const ledgerPath=root=>path.join(root,'.trust','manager','execution-ledger.jsonl');
const memoryPath=root=>path.join(root,'.trust','manager','resource-learning.json');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
export const unknownTokens=()=>({input:null,output:null,cached_input:null,total:null,source:'not-reported'});

export function createTokenCollector() {
  const streams=new Map();
  let tokens=unknownTokens();
  function line(text,state) {
    const clean=text.replace(/\x1b\[[0-9;]*m/g,'').trim();
    if(state.expectTotal) {
      state.expectTotal=false;
      if(/^[\d,]+$/.test(clean)) {
        const total=integer(Number(clean.replaceAll(',','')));
        if(total!==null&&!['provider-turn-usage','provider-result-usage'].includes(tokens.source))tokens={...unknownTokens(),total,source:'provider-cli-summary'};
      }
    }
    if(/^tokens used$/i.test(clean))state.expectTotal=true;
    if(!clean.startsWith('{'))return;
    let event;try{event=JSON.parse(clean);}catch{return;}
    if(event.type==='turn.completed'&&event.usage) {
      const input=integer(event.usage.input_tokens),output=integer(event.usage.output_tokens);
      if(input!==null&&output!==null) {
        const old=tokens.source==='provider-turn-usage'?tokens:{input:0,output:0,cached_input:0,total:0};
        tokens={input:old.input+input,output:old.output+output,cached_input:old.cached_input+(integer(event.usage.cached_input_tokens)||0),total:old.total+input+output,source:'provider-turn-usage'};
      }
    } else if(event.type==='result'&&event.usage) {
      const input=integer(event.usage.input_tokens),output=integer(event.usage.output_tokens);
      if(input!==null&&output!==null) {
        const cached=integer(event.usage.cache_read_input_tokens)||0,created=integer(event.usage.cache_creation_input_tokens)||0;
        tokens={input:input+cached+created,output,cached_input:cached,total:input+cached+created+output,source:'provider-result-usage'};
      }
    }
  }
  return {
    push(chunk,stream='stdout') {
      const state=streams.get(stream)||{pending:'',expectTotal:false};
      const pieces=(state.pending+String(chunk)).split(/\r?\n/);state.pending=pieces.pop().slice(-65536);
      for(const piece of pieces)line(piece,state);streams.set(stream,state);
    },
    finish() {for(const state of streams.values()){if(state.pending)line(state.pending,state);state.pending='';}return {...tokens};},
  };
}

export function executionRecords(root) {
  try{return fs.readFileSync(ledgerPath(root),'utf8').split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}
  catch(error){if(error.code==='ENOENT')return [];throw error;}
}
export function recordExecution(root,record) {
  const safe={id:record.id||hash(`${record.logPath}:${record.startedAt}`),taskId:record.taskId||null,draftId:record.draftId||null,role:record.role||'unknown',provider:record.provider||record.worker||'unknown',model:record.model||null,startedAt:record.startedAt||null,finishedAt:record.finishedAt||null,statusBefore:record.statusBefore||null,statusAfter:record.statusAfter||null,exitCode:record.exitCode??null,timedOut:Boolean(record.timedOut),tokens:record.tokens||unknownTokens(),budget:record.budget?{...record.budget}:null,complexity:record.complexity||null,tier:record.tier||null,packetRevision:record.packetRevision||null,logPath:record.logPath||null};
  if(record.providerFailure||record.failure)safe.failure=record.providerFailure||record.failure;
  const prior=executionRecords(root).filter(r=>r.id===safe.id).at(-1);
  if(prior&&JSON.stringify(prior)===JSON.stringify(safe))return prior;
  fs.mkdirSync(path.dirname(ledgerPath(root)),{recursive:true});
  fs.appendFileSync(ledgerPath(root),JSON.stringify(safe)+'\n');return safe;
}

const legacyCache=new Map();
function legacySessions(root) {
  const dir=path.join(root,'.trust','manager','overnight'),rows=[];
  let dirs;try{dirs=fs.readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory());}catch{return rows;}
  for(const task of dirs) {
    for(const name of fs.readdirSync(path.join(dir,task.name)).filter(n=>/^session-.*\.json$/.test(n))) {
      const file=path.join(dir,task.name,name);
      try {
        const stat=fs.statSync(file),cached=legacyCache.get(file);
        if(cached?.mtime===stat.mtimeMs){rows.push(cached.row);continue;}
        const row=JSON.parse(fs.readFileSync(file,'utf8'));if(!row.role)continue;
        const logPath=file.replace(/\.json$/,'.log');
        let tokens=row.tokens;
        if(!tokens) {
          tokens=unknownTokens();
          try {
            const fd=fs.openSync(logPath,'r');
            try{const size=fs.fstatSync(fd).size,buffer=Buffer.alloc(Math.min(size,262144));fs.readSync(fd,buffer,0,buffer.length,Math.max(0,size-buffer.length));const match=[...buffer.toString('utf8').matchAll(/^tokens used\r?\n([\d,]+)\s*$/gm)].at(-1);const total=match?integer(Number(match[1].replaceAll(',',''))):null;if(total!==null)tokens={...unknownTokens(),total,source:'provider-cli-summary'};}finally{fs.closeSync(fd);}
          }catch{}
        }
        const normalized={...row,taskId:row.taskId||task.name,provider:row.provider||row.worker,logPath,tokens,id:row.id||hash(`${logPath}:${row.startedAt}`),legacy:true};
        legacyCache.set(file,{mtime:stat.mtimeMs,row:normalized});rows.push(normalized);
      }catch{}
    }
  }
  return rows;
}

export function summarizeExecutions(rows,{expectedSessions=rows.length}={}) {
  const known=rows.filter(r=>r.tokens?.total!==null&&r.tokens?.total!==undefined);
  const byStage=new Map();
  for(const row of rows) {
    const key=JSON.stringify([row.role,row.provider,row.model]);
    const group=byStage.get(key)||{role:row.role,provider:row.provider,model:row.model,sessions:0,reported_sessions:0,total:0};
    group.sessions++;if(row.tokens?.total!=null){group.reported_sessions++;group.total+=row.tokens.total;}byStage.set(key,group);
  }
  const sum=field=>known.length&&known.every(r=>r.tokens[field]!=null)?known.reduce((total,r)=>total+r.tokens[field],0):null;
  return {sessions:Math.max(expectedSessions,rows.length),recorded_sessions:rows.length,reported_sessions:known.length,unknown_sessions:Math.max(expectedSessions,rows.length)-known.length,coverage:!known.length?'unknown':known.length===Math.max(expectedSessions,rows.length)?'complete':'partial',tokens:{total:known.length?known.reduce((total,r)=>total+r.tokens.total,0):null,input:sum('input'),output:sum('output'),cached_input:sum('cached_input')},stages:[...byStage.values()].map(group=>({...group,total:group.reported_sessions?group.total:null})),timeline:rows.slice().sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt)))};
}

export function executionReports(root,state,queues=[]) {
  const byId=new Map(legacySessions(root).map(row=>[row.id,row]));
  for(const row of executionRecords(root))byId.set(row.id,row);
  const rows=[...byId.values()];
  const tasks=Object.fromEntries(Object.entries(state.tasks||{}).map(([id,task])=>{
    const sessions=rows.filter(row=>row.taskId===id);
    const report=summarizeExecutions(sessions,{expectedSessions:task.execution_budget?.used||sessions.length});
    const changes=(state.log||[]).filter(event=>event.task===id&&['resource_budget','session_budget_increased'].includes(event.event));
    const decisions=report.timeline.map((row,index,ordered)=>({...row,modelChanged:index>0&&(row.provider!==ordered[index-1].provider||row.model!==ordered[index-1].model)}));
    return [id,{...report,timeline:decisions,budget_changes:changes,route_changes:(state.log||[]).filter(event=>event.task===id&&['provider_quota_exhausted','provider_quota_failover'].includes(event.event)),current_budget:task.execution_budget||null,status:task.status}];
  }));
  const queueReports=Object.fromEntries(queues.map(queue=>{
    const ids=new Set((queue.items||[]).map(item=>item.id));
    const selected=rows.filter(row=>ids.has(row.taskId)||(!row.taskId&&row.draftId&&row.draftId===queue.plan_draft_id));
    const expected=[...ids].reduce((total,id)=>total+(tasks[id]?.sessions||0),0)+selected.filter(row=>!row.taskId).length;
    return [queue.id,{...summarizeExecutions(selected,{expectedSessions:expected}),route_changes:[...ids].flatMap(id=>tasks[id]?.route_changes||[]),budget_changes:[...ids].flatMap(id=>(tasks[id]?.budget_changes||[]).map(change=>({...change,detail:`${id}: ${change.detail}`}))),task_count:ids.size,task_ids:[...ids],planning_sessions:selected.filter(row=>!row.taskId).length}];
  }));
  return {tasks,queues:queueReports};
}

export function loadResourceLearning(root) {
  if(!root)return {version:1,samples:[]};
  try{const memory=JSON.parse(fs.readFileSync(memoryPath(root),'utf8'));if(memory.version!==1||!Array.isArray(memory.samples))throw Error('Invalid resource learning schema');return {...memory,samples:memory.samples.filter(sample=>sample&&typeof sample.taskId==='string'&&['simple','standard','complex','critical'].includes(sample.complexity)&&Number.isInteger(sample.sessions)&&sample.sessions>=3&&Number.isInteger(sample.rejections)&&sample.rejections>=0)};}
  catch(error){return {version:1,samples:[],...(error.code==='ENOENT'?{}:{error:'Resource history could not be read; baseline estimates apply.'})};}
}
export function publishPlanningExecution(root,draftId) {
  const latest=new Map(executionRecords(root).filter(row=>row.draftId===draftId&&!row.taskId).map(row=>[row.id,row]));
  const report=summarizeExecutions([...latest.values()]);
  const source=archiveSource(root,{sourceId:`execution-plan:${draftId}`,content:JSON.stringify(report)}).source;
  addClaim(root,{text:`Plan ${draftId}: ${report.sessions} planning/review sessions; ${report.tokens.total??'unknown'} reported tokens (${report.coverage}). Source revision ${source.revision}.`,source_id:source.id,source_revision:source.revision,status:report.coverage==='complete'?'VERIFIED':'PARTIAL',subject:`execution-plan:${draftId}:${source.revision}`,owner:'runtime-observations'});
}
export function learnedResources(root,task,assessment) {
  const memory=loadResourceLearning(root);
  const relevant=memory.samples.filter(sample=>sample.taskId!==task.id&&sample.complexity===assessment.complexity&&sample.risk===(task.risk||'normal')).slice(-30);
  const sessionCounts=relevant.filter(sample=>sample.sessions>=3).map(sample=>sample.sessions).sort((a,b)=>a-b);
  const sessionFloor=sessionCounts.length>=3?sessionCounts[Math.ceil(sessionCounts.length*.75)-1]:null;
  const failures=relevant.filter(sample=>sample.rejections>0);
  const tierFloor=failures.length>=2?(assessment.tier==='economy'?'standard':assessment.tier==='standard'?'advanced':assessment.tier):null;
  return {samples:relevant.length,sessionFloor,tierFloor,source:'verified-project-executions'};
}

export function learnFromExecution(root,state,taskId) {
  const task=state.tasks[taskId];if(!task)return null;
  const queues=queueList(root,{includeArchived:true});
  const reports=executionReports(root,state,queues),report=reports.tasks[taskId];
  const snapshot=JSON.stringify({taskId,packet_revision:task.packet_revision||1,status:task.status,report});
  const archived=archiveSource(root,{sourceId:`execution:${taskId}`,uri:path.relative(root,ledgerPath(root)).replaceAll('\\','/'),content:snapshot});
  const text=`Execution ${taskId} (${task.status}): ${report.sessions} sessions, ${report.tokens.total??'unknown'} reported tokens (${report.coverage}; ${report.unknown_sessions} unknown sessions). Models/stages: ${report.stages.map(stage=>`${stage.role}=${stage.provider}/${stage.model||'provider default'}`).join(', ')}. Budget changes: ${report.budget_changes.length}. Source revision ${archived.source.revision}.`;
  addClaim(root,{text,source_id:archived.source.id,source_revision:archived.source.revision,status:report.coverage==='complete'?'VERIFIED':'PARTIAL',subject:`execution:${taskId}:${archived.source.revision}`,owner:'runtime-observations'});
  for(const queue of queues.filter(queue=>(queue.items||[]).some(item=>item.id===taskId))) {
    const queueReport=reports.queues[queue.id],content=JSON.stringify({queueId:queue.id,report:queueReport});
    const source=archiveSource(root,{sourceId:`execution-queue:${queue.id}`,content}).source;
    addClaim(root,{text:`Queue ${queue.id}: ${queueReport.sessions} provider sessions; ${queueReport.tokens.total??'unknown'} reported tokens (${queueReport.coverage}); ${queueReport.planning_sessions} shared planning sessions counted once. Source revision ${source.revision}.`,source_id:source.id,source_revision:source.revision,status:queueReport.coverage==='complete'?'VERIFIED':'PARTIAL',subject:`execution-queue:${queue.id}:${source.revision}`,owner:'runtime-observations'});
  }
  if(task.status!=='done'||!(task.evidence||[]).some(e=>e.kind==='review'&&['approve','pass'].includes(e.result)&&!e.invalidated&&(e.packet_revision||1)===(task.packet_revision||1)))return report;
  const sessions=report.timeline.filter(row=>row.complexity&&(row.packetRevision||1)===(task.packet_revision||1));
  if(!sessions.some(row=>row.role==='beacon'&&row.statusAfter==='done')||sessions.some(row=>row.timedOut||row.exitCode!==0))return report;
  const memory=loadResourceLearning(root),last=sessions.at(-1);
  delete memory.error;
  const sample={taskId,packetRevision:task.packet_revision||1,complexity:last.complexity,risk:task.risk||'normal',sessions:sessions.length,rejections:(task.evidence||[]).filter(e=>e.kind==='review'&&e.result==='changes-requested'&&!e.invalidated&&(e.packet_revision||1)===(task.packet_revision||1)).length,tokens:report.tokens.total,coverage:report.coverage,source_revision:archived.source.revision,at:new Date().toISOString()};
  memory.samples=[...memory.samples.filter(s=>s.taskId!==taskId),sample].slice(-500);
  fs.mkdirSync(path.dirname(memoryPath(root)),{recursive:true});const temp=memoryPath(root)+'.tmp';fs.writeFileSync(temp,JSON.stringify(memory,null,2)+'\n');fs.renameSync(temp,memoryPath(root));
  return report;
}
