import { ensureWorkspace } from './workspace.mjs';
import { executeLaunchQueue, readOvernightRun, reconcileOvernightRun, requestRunAbort } from './launch.mjs';
import { loadState } from './state.mjs';
import { ensureDaemon } from './daemon.mjs';

// Remote implementations must preserve these semantics, never impersonate local paths.
export const executionBackendContract = Object.freeze(['prepare','dispatch','observe','cancel','reconcile','artifacts']);
export function localExecutionBackend(){
  return {
    kind:'local',
    prepare: (root,config,task)=>ensureWorkspace(root,config,task),
    dispatch: (root,options)=>executeLaunchQueue(root,options),
    observe: root=>({state:loadState(root),run:readOvernightRun(root)}),
    cancel: ()=>requestRunAbort(),
    reconcile: root=>reconcileOvernightRun(root),
    artifacts: (root,taskId)=>{const task=loadState(root).tasks[taskId];return {workspace:task?.workspace,delivery:task?.delivery,packet:task?.delivery_packet,evidence:task?.evidence||[]};},
  };
}
export function assertExecutionBackend(backend){for(const method of executionBackendContract)if(typeof backend?.[method]!=='function')throw new Error(`Execution backend missing ${method}`);return backend;}

// Program orchestration crosses project daemons through this local boundary.
// A future remote backend can replace transport while retaining the same
// authorization, accounting, observation, and recovery contracts.
export function projectDaemonBackend(){
  const call=async(root,route,payload)=>{
    const daemon=await ensureDaemon(root);
    const response=await fetch(new URL(route,daemon.url),payload===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok||result.ok===false)throw new Error(result.error||`Project runtime ${route} failed: ${response.status}`);
    return route==='/api/run'&&payload===undefined?{run:result}:result;
  };
  return assertExecutionBackend({
    kind:'local-project-daemon',
    prepare:async root=>ensureDaemon(root),
    dispatch:(root,options)=>call(root,'/api/run',options),
    observe:root=>call(root,'/api/run'),
    cancel:(root,runId)=>call(root,'/api/run/stop',{runId}),
    reconcile:root=>call(root,'/api/run'),
    artifacts:(root,taskId)=>{const task=loadState(root).tasks[taskId];return {workspace:task?.workspace,delivery:task?.delivery,packet:task?.delivery_packet,evidence:task?.evidence||[]};},
  });
}
