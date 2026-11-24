import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { emptyState, saveState } from '../runtime/lib/state.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
import { azureQuery } from '../skills/atl/scripts/azure-intake.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-browse-sources-'));
fs.mkdirSync(path.join(root,'config'), {recursive:true});
fs.writeFileSync(path.join(root,'config/manager.json'), JSON.stringify({version:1}));
saveState(root,emptyState());
const sources = [
 {id:'github',provider:'github',name:'GitHub source',enabled:true,status:'unchecked',settings:{repo:'example/one'}},
 {id:'azure-a',provider:'azure',name:'Azure A',enabled:true,status:'unchecked',settings:{org_url:'https://azure.example/collection-a',project:'Alpha',iteration_path:'Alpha\\Sprint 74',token_env:'AZDO_BROWSE_A'}},
 {id:'azure-b',provider:'azure',name:'Azure B',enabled:true,status:'unchecked',settings:{org_url:'https://azure.example/collection-b',project:'Beta',iteration_path:'',token_env:'AZDO_BROWSE_B'}},
 {id:'jira',provider:'jira',name:'Jira source',enabled:true,status:'unchecked',settings:{base_url:'https://jira.example',projects:['OPS'],token_env:'JIRA_BROWSE'}}
];
fs.writeFileSync(path.join(root,'.trust/manager/issue-connections.json'),JSON.stringify({version:1,revision:1,connections:sources,defaults:{github:'github',azure:'azure-a',jira:'jira'},dismissed_legacy:[]}));
const priorA=process.env.AZDO_BROWSE_A, priorB=process.env.AZDO_BROWSE_B;
process.env.AZDO_BROWSE_A='test-token-alpha'; process.env.AZDO_BROWSE_B='test-token-beta';
const seenAzure=[], seenIterations=[];
const candidate=(type,id,title,extra={})=>({title,objective_hint:'',completion_checks:[],priority:'normal',labels:['bug'],source:{type,remote_id:id,...extra},intake_key:`${type}:${id}`});
let running,browser;
try {
 running=await startControlPlaneServer(root,{
  azureFetch:async (url, options)=>{const auth=Buffer.from(options.headers.authorization.slice(6),'base64').toString();seenIterations.push({url:String(url),auth});return {ok:true,status:200,json:async()=>({children:[{name:'Sprint 74'},{name:'Sprint 75'}]})};},
  intakeAdapters:{
   github:async cfg=>[candidate('github',1,'GitHub issue',{repo:cfg.repos[0]})],
   jira:async cfg=>[candidate('jira','OPS-1','Jira issue',{base_url:cfg.base_url})],
   azure:async (cfg,options)=>{seenAzure.push({cfg:{...cfg},token:options.token});return [candidate('azure',42,`Work item ${cfg.project}`,{project:cfg.project,iteration:cfg.iteration_path})];}
  }
 });
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(running.url);await page.locator('[data-page="sources"]:visible').first().click();
 await page.locator('.issue-title').filter({hasText:'GitHub issue'}).waitFor();
 assert.equal(await page.locator('#sourceConnectionSelect').inputValue(),'github','default source is automatically browsed');
 // A long idle period previously let the page mark its live service offline.
 await page.waitForTimeout(12000);
 assert(await page.locator('#sourceConnectionSelect').isEnabled(),'browse controls stay enabled on the live source page');
 assert(await page.locator('[data-action="sources-preview-selected"]').isEnabled(),'search stays enabled on the live source page');
 await page.locator('#sourceConnectionSelect').selectOption('azure-a');
 await page.locator('.issue-title').filter({hasText:'Work item Alpha'}).waitFor();
 await page.locator('#sourceAzureSearchIteration option').filter({hasText:'Sprint 75'}).waitFor({state:'attached'});
 assert.equal(await page.locator('#sourceAzureSearchIteration').inputValue(),'Alpha\\Sprint 74');
 assert(seenIterations.some(x=>x.url.includes('/collection-a/Alpha/') && x.auth===':test-token-alpha'));
 assert(seenAzure.some(x=>x.cfg.project==='Alpha' && x.cfg.iteration_path==='Alpha\\Sprint 74' && x.token==='test-token-alpha'));
 await page.locator('#sourceAzureSearchIteration').selectOption('Alpha\\Sprint 75');
 // Wait on the actual adapter call: the result notice text is identical for
 // every browse of this connection, so it cannot disambiguate the new POST.
 for (let i = 0; i < 50 && !seenAzure.some(x=>x.cfg.project==='Alpha' && x.cfg.iteration_path==='Alpha\\Sprint 75'); i++) await page.waitForTimeout(100);
 assert(seenAzure.some(x=>x.cfg.project==='Alpha' && x.cfg.iteration_path==='Alpha\\Sprint 75'));
 await page.locator('#sourceConnectionSelect').selectOption('azure-b');
 await page.locator('.issue-title').filter({hasText:'Work item Beta'}).waitFor();
 await page.locator('#sourceAzureSearchIteration option').filter({hasText:'Sprint 75'}).waitFor({state:'attached'});
 assert.equal(await page.locator('#sourceAzureSearchIteration').inputValue(),'');
 assert(seenIterations.some(x=>x.url.includes('/collection-b/Beta/') && x.auth===':test-token-beta'));
 assert(seenAzure.some(x=>x.cfg.project==='Beta' && x.cfg.all_iterations === true && x.token==='test-token-beta'));
 await page.locator('#sourceConnectionSelect').selectOption('jira');await page.locator('.issue-title').filter({hasText:'Jira issue'}).waitFor();
 const forbidden=await fetch(new URL('/api/intake/azure/iterations?connection_id=azure-a',running.url));assert.equal(forbidden.status,403);
 const bad=await page.evaluate(async()=>{const r=await fetch('/api/intake/azure/iterations?connection_id=missing',{headers:{'x-atl-csrf':document.querySelector('meta[name="atl-csrf"]').content}});return {status:r.status,body:await r.json()};});assert.equal(bad.status,400);assert.match(bad.body.error,/not found/);
 const cfg={org_url:'https://azure.example/collection',project:'Alpha',iteration_path:'Alpha\\Sprint 74'};
 assert.match(azureQuery(cfg),/\[System.IterationPath\]/);assert.doesNotMatch(azureQuery({...cfg,all_iterations:true}),/\[System.IterationPath\]/);
 assert.deepEqual(errors,[]);
 console.log('PASS: idle live controls, automatic default browsing, Azure connection-specific sprints/tokens, default and changed sprint, all-sprint query, GitHub/Jira lists and owner checks.');
} finally {
 await browser?.close();running?.server.closeAllConnections?.();if(running)await new Promise(resolve=>running.server.close(resolve));fs.rmSync(root,{recursive:true,force:true});
 if(priorA===undefined)delete process.env.AZDO_BROWSE_A;else process.env.AZDO_BROWSE_A=priorA;
 if(priorB===undefined)delete process.env.AZDO_BROWSE_B;else process.env.AZDO_BROWSE_B=priorB;
}
