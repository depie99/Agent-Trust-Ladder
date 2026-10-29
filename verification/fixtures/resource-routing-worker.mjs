// Local deterministic adapter: exercise actual process/model arguments and gates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadState,saveState,transition,addEvidence} from '../../runtime/lib/state.mjs';
import {snapshot} from '../../runtime/lib/handoffs.mjs';
const [root,id,role,model]=process.argv.slice(2);
const state=loadState(root),task=state.tasks[id];
fs.appendFileSync(path.join(root,'.trust','routes.jsonl'),JSON.stringify({role,model})+'\n');
if(model==='exhausted') {
  process.stderr.write("ERROR: You've hit your usage limit for GapCode.\n");
  process.exit(1);
}
if(role==='rowan') {
  if(task.status==='assigned')transition(state,id,'in_progress',{actor:'rowan'});
  fs.writeFileSync(path.join(task.workspace,'README.md'),'Correct spelling.\n');
  for(const check of task.completion_checks)addEvidence(state,id,{kind:'check',check,result:'pass',coverage:'complete',code_revision:snapshot(root,task.workspace).revision,command:'fixture readback assertion',exit_code:0},'rowan');
  transition(state,id,'in_review',{actor:'rowan'});
}else if(role==='sage') {
  assert.equal(fs.readFileSync(path.join(task.workspace,'README.md'),'utf8'),'Correct spelling.\n');
  const rejected=task.evidence.some(e=>e.kind==='review'&&e.result==='changes-requested');
  addEvidence(state,id,{kind:'review',result:rejected?'approve':'changes-requested',detail:rejected?'Readback verified':'Require one bounded repair verification',code_revision:snapshot(root,task.workspace).revision},'sage');
  transition(state,id,rejected?'verifying':'in_progress',{actor:'sage'});
}else if(role==='beacon') {
  assert.equal(fs.readFileSync(path.join(task.workspace,'README.md'),'utf8'),'Correct spelling.\n');
  transition(state,id,'done',{actor:'beacon'});
}
saveState(root,state);
process.stderr.write('tokens used\n150\n');
