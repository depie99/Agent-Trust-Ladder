import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {startControlPlaneServer} from '../runtime/lib/control-plane-server.mjs';
import {emptyState,saveState} from '../runtime/lib/state.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-resource-ui-'));
const config={providers:{default:'gapgpt',model:'routine-model',catalog:{gapgpt:{command:process.execPath,model:'routine-model'}}},resource_policy:{enabled:true,default_sessions:8,max_sessions:20,auto_extend:true,auto_models:true,max_model_tier:'advanced',models:[{provider:'gapgpt',model:'routine-model',tier:'economy',cost_order:1,enabled:true},{provider:'gapgpt',model:'general-model',tier:'standard',cost_order:5,enabled:true}]}};
fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/manager.json'),JSON.stringify(config));
const state=emptyState();state.tasks['T-001']={id:'T-001',title:'Correct README typo',objective:'Fix a small typo',status:'assigned',files:['README.md'],completion_checks:['Correct spelling'],priority:'normal'};saveState(root,state);
let browser,server;
try {
  const started=await startControlPlaneServer(root);server=started.server;
  browser=await chromium.launch({headless:true});
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>sessionStorage.setItem('atl-cp-page','settings'));
    await page.goto(started.url);
    await page.locator('#resourceDefault').waitFor();
    await page.locator('#resourceDefault').fill('9');await page.locator('#resourceMax').fill('18');
    await page.locator('#resourceCeiling').selectOption('standard');
    await page.locator('[data-action="resource-save"]').click();
    await page.getByText('Resource policy saved. New sessions use these limits.',{exact:true}).waitFor();
    const saved=await fetch(started.url+'api/resource-policy').then(r=>r.json());
    assert.equal(saved.policy.default_sessions,9);assert.equal(saved.policy.max_sessions,18);assert.equal(saved.policy.max_model_tier,'standard');
    await page.locator('#resourceProvider').fill('gapgpt');await page.locator('#resourceModel').fill('upper-model');
    await page.locator('[data-action="resource-add"]').click();
    assert.equal(await page.locator('[data-resource-row]').count(),3);
    await page.locator('[data-resource-row="2"] [data-route-tier]').selectOption('advanced');
    await page.locator('[data-action="resource-save"]').click();
    await page.getByText('Resource policy saved. New sessions use these limits.',{exact:true}).waitFor();
    assert.equal((await fetch(started.url+'api/resource-policy').then(r=>r.json())).policy.models[2].tier,'advanced');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Settings fit the viewport; wide route table scrolls internally');
    const artifactDir=path.join(process.cwd(),'.atl-evidence','resource-policy');fs.mkdirSync(artifactDir,{recursive:true});
    await page.locator('[data-resource-form]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(artifactDir,`settings-${viewport.width}.png`),fullPage:true});
    await page.locator('[data-action="resource-remove:2"]').click();await page.locator('[data-action="resource-save"]').click();
    await page.getByText('Resource policy saved. New sessions use these limits.',{exact:true}).waitFor();
    // Exercise the model planner's automatic option without spending a session.
    await page.evaluate(()=>sessionStorage.setItem('atl-cp-page','studio'));
    await page.locator('[data-page="studio"]:visible').first().click();
    await page.locator('[data-action="mode:model"]').click();
    assert.equal(await page.locator('#providerSelect').inputValue(),'auto');
    await page.close();assert.deepEqual(errors,[]);
  }
} finally {await browser?.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: resource Settings save/add/remove, capability ceiling and responsive desktop/mobile rendering');
