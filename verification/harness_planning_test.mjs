import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { emptyState, saveState } from '../runtime/lib/state.mjs';
import { saveHarnessPlan, harnessPlanContext, planningPreferences, answerHarnessPlan } from '../runtime/lib/harness-planning.mjs';
import { loadPlanDraft, planDraftLabel } from '../runtime/lib/plan-studio.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-harness-plan-'));
const oldHome = process.env.ATL_HOME; process.env.ATL_HOME = path.join(root, 'personal');
let server;
try {
  saveState(root, emptyState());
  fs.mkdirSync(path.join(root, 'verification'), {recursive:true});
  fs.writeFileSync(path.join(root, 'verification/fixture.mjs'), '// fixture');
  const git = args => execFileSync('git', args, {cwd:root,stdio:'pipe'});
  git(['init']); git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','--allow-empty','-m','Initial']);
  assert.equal(planningPreferences(root).ask_preference,true);
  assert.equal(planningPreferences(root,{mode:'all',scope:'personal'}).mode,'all');
  assert.equal(planningPreferences(root,{mode:'defaults',scope:'project'}).mode,'defaults');
  assert.equal(planningPreferences(root,{mode:'consequential'}).mode,'consequential');
  const artifact = JSON.parse(fs.readFileSync(new URL('./plan_contract_fixture.json', import.meta.url)));
  const input = { author:'Current harness assistant', intent:artifact.objective, artifact, issue:'GH-123', idempotencyKey:'first' };
  const first = saveHarnessPlan(root,input);
  assert.equal(saveHarnessPlan(root,input).draftId,first.draftId);
  assert.equal(planDraftLabel(loadPlanDraft(root,first.draftId)).mode,'model');
  assert.throws(()=>saveHarnessPlan(root,{...input,author:'Other'}),/Idempotency/);
  assert.throws(()=>saveHarnessPlan(root,{...input,draftId:first.draftId,expectedRevision:first.revision-1,idempotencyKey:'stale'}),/changed/);
  const withQuestion = structuredClone(artifact); withQuestion.open_questions=[{id:'q1',question:'Which destination?',blocks_readiness:true}];
  const changed = saveHarnessPlan(root,{...input,artifact:withQuestion,draftId:first.draftId,expectedRevision:first.revision,idempotencyKey:'question'});
  assert.throws(()=>saveHarnessPlan(root,{...input,issue:'GH-456',draftId:first.draftId,expectedRevision:changed.revision,idempotencyKey:'wrong-issue'}),/issue binding cannot change/);
  const answered=answerHarnessPlan(root,{draftId:first.draftId,expectedRevision:changed.revision,questionId:'q1',answer:'Local delivery only'});
  assert.equal(answered.questions.length,0);
  assert.equal(harnessPlanContext(root,{draftId:first.draftId}).draft.revision,answered.revision);
  assert.throws(()=>saveHarnessPlan(root,{...input,artifact:{...artifact,review:{verdict:'passed'}},idempotencyKey:'fake'}),/review evidence/);
  const started = await startControlPlaneServer(root); server=started.server;
  const post = async (op,payload) => {const r=await fetch(new URL(`/api/harness/${op}`,started.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};};
  assert.equal((await post('plan/context',{draftId:first.draftId})).body.draft.revision,answered.revision);
  const approval=await post('plan/approve',{draftId:first.draftId,expectedRevision:answered.revision,confirm:true,idempotencyKey:'approve'});
  assert.equal(approval.status,409); assert.match(approval.body.error,/review/);
  assert.equal((await post('run/status',{})).status,200);
  console.log('PASS: harness planning preferences, persistence, idempotency, revision checks, shared labels, answers and review gate');
} finally {
  if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}
  if(oldHome===undefined)delete process.env.ATL_HOME;else process.env.ATL_HOME=oldHome;
  fs.rmSync(root,{recursive:true,force:true});
}
