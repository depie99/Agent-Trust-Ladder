import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {saveState,emptyState} from '../runtime/lib/state.mjs';
import {startControlPlaneServer} from '../runtime/lib/control-plane-server.mjs';
import {pluginTools} from '../runtime/lib/plugin-host.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-harness-api-'));
saveState(root,emptyState());
execFileSync('git',['init','-b','main'],{cwd:root,stdio:'ignore'});
const server=await startControlPlaneServer(root);
try{
  const post=async(operation,payload)=>{
    const response=await fetch(new URL(`/api/harness/${operation}`,server.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    return {status:response.status,result:await response.json()};
  };
  const tools=new Set(pluginTools.map(tool=>tool.name));
  for(const name of ['atl_plan_context','atl_plan_save','atl_plan_answer','atl_plan_review','atl_plan_approve','atl_run_preview','atl_run_start','atl_run_status','atl_run_stop','atl_program_save','atl_program_reconcile','atl_project_bootstrap'])assert.ok(tools.has(name),`${name} is discoverable in the packaged host contract`);
  const boot=await post('project/bootstrap',{confirm:true,branch:'main'});
  assert.equal(boot.status,200);assert.equal(boot.result.repository.bootstrap_required,false);
  const context=await post('plan/context',{preference:{mode:'all',scope:'project'}});
  assert.equal(context.status,200);assert.equal(context.result.preferences.mode,'all');assert.equal(context.result.repository.branch,'main');
  const saved=await post('plan/save',{author:'current harness assistant',intent:'Create an auditable harness draft',artifact:{title:'Harness API draft',objective:'Create an auditable harness draft',plan_contract_version:2},state:'draft',baseBranch:'main',idempotencyKey:'api-draft'});
  assert.equal(saved.status,200,JSON.stringify(saved.result));assert.equal(saved.result.draft.author,'current harness assistant');
  const reloaded=await post('plan/context',{draftId:saved.result.draft.draftId});
  assert.equal(reloaded.result.draft.revision,saved.result.draft.revision);assert.equal(reloaded.result.draft.artifact.objective,'Create an auditable harness draft');
  const stale=await post('plan/answer',{draftId:saved.result.draft.draftId,expectedRevision:0,questionId:'q1',answer:'answer'});
  assert.equal(stale.status,409);assert.match(stale.result.error,/revision/);
  console.log('PASS: live harness HTTP routes, project preference persistence, bootstrap, shared draft readback, stale revision rejection, and packaged tool discovery');
}finally{
  await new Promise(resolve=>server.server.close(resolve));
  fs.rmSync(root,{recursive:true,force:true});
}
