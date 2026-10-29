import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {startControlPlaneServer} from '../runtime/lib/control-plane-server.mjs';
import {emptyState,createTask,saveState} from '../runtime/lib/state.mjs';
import {queueCreate,queueAdd,loadQueue,saveQueue} from '../runtime/lib/queue.mjs';
import {recordExecution,learnFromExecution} from '../runtime/lib/execution-report.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-execution-ui-'));
let server,browser;
try {
  const state=emptyState(),task=createTask(state,{title:'Inspect mixed Persian متن and Latin path'});
  Object.assign(task,{status:'in_review',objective:'Inspect the execution report',execution_budget:{used:3,max_sessions:5,source:'automatic'}});
  state.log.push({task:task.id,event:'session_budget_increased',actor:'owner',at:'2026-10-29T10:00:00Z',detail:'Limit increased from 3 to 5; 2 already used'});
  state.log.push({task:task.id,event:'provider_quota_failover',actor:'runner',at:'2026-10-29T10:02:00Z',detail:'Quota exhausted; switched to the approved general-model route'});
  saveState(root,state);queueCreate(root,'execution-ui',{name:'Execution report queue'});queueAdd(root,task.id,{queueId:'execution-ui'});
  const queue=loadQueue(root,'execution-ui');queue.plan_draft_id='draft-ui';saveQueue(root,queue);
  recordExecution(root,{id:'ui-one',taskId:task.id,role:'rowan',provider:'gapgpt',model:'routine-model',startedAt:'2026-10-29T10:00:00Z',finishedAt:'2026-10-29T10:01:00Z',exitCode:0,tokens:{total:100,input:null,output:null,cached_input:null,source:'provider-cli-summary'},budget:{used:1,max_sessions:3}});
  recordExecution(root,{id:'ui-two',taskId:task.id,role:'sage',provider:'gapgpt',model:'general-model',startedAt:'2026-10-29T10:02:00Z',finishedAt:'2026-10-29T10:03:00Z',exitCode:0,tokens:{total:250,input:200,output:50,cached_input:100,source:'provider-turn-usage'},budget:{used:2,max_sessions:5}});
  recordExecution(root,{id:'ui-plan',draftId:'draft-ui',role:'planning',provider:'gapgpt',model:'general-model',tokens:{total:75,source:'provider-cli-summary'}});
  learnFromExecution(root,state,task.id);
  const started=await startControlPlaneServer(root);server=started.server;
  browser=await chromium.launch({headless:true});
  const output=path.join(process.cwd(),'.atl-evidence','execution-reports');fs.mkdirSync(output,{recursive:true});
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{if(!sessionStorage.getItem('atl-cp-page'))sessionStorage.setItem('atl-cp-page','tasks');});
    await page.goto(started.url);
    const row=page.locator(`[data-task="${task.id}"]`);await row.waitFor();
    await row.getByText('350 reported tokens',{exact:false}).waitFor();
    await row.locator('.task-title-text').click();
    const report=page.locator('#modal [data-execution-report]');await report.waitFor();
    await report.getByText('1 session(s) without reported token usage.',{exact:false}).waitFor();
    assert.equal(await report.locator('tbody tr').count(),2);
    await report.getByText('Session timeline (2)',{exact:true}).click();
    await report.getByText('Model changed',{exact:true}).waitFor();
    await report.getByText('Budget changes (1)',{exact:true}).click();
    await report.getByText('Quota failover history (1)',{exact:true}).click();
    await report.getByText('Quota exhausted; switched to the approved general-model route',{exact:true}).waitFor();
    await report.getByText('Limit increased from 3 to 5; 2 already used',{exact:false}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'task report does not overflow the page');
    await report.screenshot({path:path.join(output,`task-${viewport.width}.png`)});
    await page.keyboard.press('Escape');
    await page.locator('[data-page="queues"]:visible').first().click();
    const card=page.locator('[data-queue="execution-ui"]');await card.waitFor();
    await card.getByText('425 reported tokens',{exact:false}).waitFor();
    await card.locator('h2').click();
    await page.locator('#modal [data-execution-report]').getByText('1 shared planning session(s), counted once for this queue.',{exact:true}).waitFor();
    assert.equal(errors.length,0,errors.join('\n'));
    await page.close();
  }
}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: task/queue token badges, partial totals, model/budget history and responsive reports');
