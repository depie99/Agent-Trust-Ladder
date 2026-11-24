import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { emptyState, saveState } from '../runtime/lib/state.mjs';
import { startControlPlaneServer } from '../runtime/lib/control-plane-server.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atl-source-design-'));
const evidence=path.resolve('.atl-evidence/issue-sources-reference');fs.mkdirSync(evidence,{recursive:true});
fs.mkdirSync(path.join(root,'config'),{recursive:true});fs.writeFileSync(path.join(root,'config/manager.json'),JSON.stringify({version:1}));saveState(root,emptyState());
const connections=[
{id:'gh',provider:'github',name:'Temp Mishka CMS',enabled:true,status:'verified',settings:{repo:'shahryarjb/temp_mishka_cms'}},
{id:'az',provider:'azure',name:'Solico Sprint 74',enabled:true,status:'needs-auth',settings:{org_url:'https://dev.azure.com/Solico-Group',project:'Middleware-and-Portals',token_env:'AZDO_PAT'}},
{id:'jira',provider:'jira',name:'Internal Support',enabled:false,status:'unchecked',settings:{base_url:'https://jira.example.com',projects:['IT','IS'],token_env:'JIRA_TOKEN'}},
{id:'platform',provider:'azure',name:'Platform Backlog',enabled:true,status:'unchecked',settings:{org_url:'https://dev.azure.com/Solico-Group',project:'Platform',token_env:'AZDO_PAT'}}];
fs.writeFileSync(path.join(root,'.trust/manager/issue-connections.json'),JSON.stringify({version:1,revision:1,connections,defaults:{github:'gh'},dismissed_legacy:[]}));
let browser,running;
try {
 running=await startControlPlaneServer(root,{intakeAdapters:{github:async()=>[
 {index:0,title:'Fix responsive navigation on mobile',labels:['bug'],source:{type:'github',remote_id:128,repo:'shahryarjb/temp_mishka_cms'},intake_key:'github:128'},
 {index:1,title:'Add dark mode support for dashboard',labels:['enhancement'],source:{type:'github',remote_id:131,repo:'shahryarjb/temp_mishka_cms'},intake_key:'github:131'},
 {index:2,title:'Update installation documentation',labels:['docs'],source:{type:'github',remote_id:124,repo:'shahryarjb/temp_mishka_cms'},intake_key:'github:124'}]}});
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1512,height:1120}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('atl-cp-theme','light'));
 await page.goto(running.url);await page.locator('[data-page="sources"]:visible').first().click();await page.locator('.connection').first().waitFor();
 await page.locator('[data-action="sources-browse:gh"]').click();await page.locator('[data-action="sources-preview-selected"]').click();await page.locator('tbody tr').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true});
 assert.equal(await page.locator('.connections').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),4);
 await page.locator('#sourceSearch').fill('dark mode');assert.equal(await page.locator('tbody tr:visible').count(),1);
 await page.locator('#sourceSearch').fill('');await page.locator('[data-action="sources-clear-selection"]').click();assert(await page.locator('[data-action="sources-import"]').isDisabled());await page.locator('#sourceSelectAll').check();assert.equal(await page.locator('#sourceSelectionCount').innerText(),'3 selected');
 await page.locator('#sourceLabelFilter').selectOption('bug');assert.equal(await page.locator('tbody tr:visible').count(),1);await page.locator('#sourceLabelFilter').selectOption('');
 await page.locator('[data-action="sources-add"]').click();await page.screenshot({path:path.join(evidence,'add-source.png')});await page.locator('[data-action="close"]').last().click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('.connections').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),1);
 await page.locator('[data-action="sources-add"]').click();await page.screenshot({path:path.join(evidence,'mobile-dialog.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('[data-action="close"]').last().click();
 await page.setViewportSize({width:1512,height:1120});await page.evaluate(()=>document.documentElement.classList.remove('light'));await page.screenshot({path:path.join(evidence,'dark.png'),fullPage:true});await page.evaluate(()=>document.documentElement.dir='rtl');await page.screenshot({path:path.join(evidence,'rtl.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: desktop four cards, mobile one card, no overflow, search/label filtering, clear/select all, dialog, dark/RTL captures, no browser errors.');
} finally {await browser?.close();if(running)await new Promise(resolve=>running.server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
