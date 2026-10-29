// Render the real generated website, with all external requests blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {createDocsServer} from '../scripts/serve-docs.mjs';
const root=path.resolve(import.meta.dirname,'..');
const pages=JSON.parse(fs.readFileSync(path.join(root,'docs/site.json'),'utf8'));
const artifactDir=path.join(root,'.atl-evidence/docs-refresh');
fs.mkdirSync(artifactDir,{recursive:true});
const server=createDocsServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
let browser;
const results=[],errors=[];
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
 const page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 for(const item of pages){
  const response=await page.goto(base+item.url,{waitUntil:'networkidle'});
  assert.equal(response.status(),200,item.url);
  const count=await page.locator('.mermaid').count();
  if(count)await page.waitForFunction(expected=>document.querySelectorAll('.mermaid svg').length===expected||document.documentElement.dataset.diagramError, count);
  const result=await page.evaluate(()=>({h1:document.querySelectorAll('h1').length,diagrams:document.querySelectorAll('.mermaid svg').length,diagramError:Boolean(document.documentElement.dataset.diagramError),missingImages:[...document.images].filter(image=>!image.complete||!image.naturalWidth).map(image=>image.src),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}));
  assert.equal(result.h1,1,item.url+' heading');
  assert.equal(result.diagrams,count,item.url+' rendered diagrams');
  assert.equal(result.diagramError,false,item.url+' diagram parse');
  assert.deepEqual(result.missingImages,[],item.url+' images');
  assert.equal(result.overflow,false,item.url+' desktop overflow');
  results.push({url:item.url,...result});
 }
 fs.writeFileSync(path.join(artifactDir,'site-pages.json'),JSON.stringify(results,null,2)+'\n');
 await page.goto(base+'getting-started.html');
 await page.getByRole('button',{name:'Search',exact:false}).click();
 await page.getByRole('searchbox').fill('Jira');
 await page.locator('#search-results a[href^="issue-sources.html"]').first().waitFor();
 await page.getByRole('searchbox').fill('zz-no-such-doc-entry');
 await page.getByText('No results. Try fewer words or a feature name.').waitFor();
 await page.keyboard.press('Escape');
 await page.locator('#search-dialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('#search-dialog').evaluate(element=>element.open),false);
 await page.waitForFunction(()=>document.activeElement===document.querySelector('#search-open'));
 assert.equal(await page.locator('#search-open').evaluate(element=>element===document.activeElement),true,'search restores keyboard focus');
 await page.keyboard.press('Control+k');
 await page.locator('#search-dialog').waitFor({state:'visible'});
 await page.keyboard.press('Escape');
 await page.locator('#search-dialog').waitFor({state:'hidden'});
 await page.locator('.copy-code').first().click();
 await page.waitForFunction(()=>document.querySelector('.copy-code')?.textContent==='Copied');
 assert.equal(await page.locator('.copy-code').first().innerText(),'Copied');
 assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/git clone/);
 await page.getByRole('button',{name:'Toggle theme'}).click();
 const theme=await page.locator('html').getAttribute('data-theme');
 await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-theme'),theme,'theme survives navigation');
 await page.screenshot({path:path.join(artifactDir,'site-desktop.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Menu',exact:true}).getAttribute('aria-expanded'),'true');
 await page.locator('#sidebar').getByRole('link',{name:'Resource and file model',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.mermaid svg').length===2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'resource model mobile overflow');
 assert.equal(await page.locator('.mermaid svg title').count(),2,'ER diagrams have accessible titles');
 await page.screenshot({path:path.join(artifactDir,'resource-model-mobile.png'),fullPage:false});
 assert.deepEqual(errors,[],'browser errors');
 fs.writeFileSync(path.join(artifactDir,'site-test.json'),JSON.stringify({status:'passed',pages:results,interactive:['search results','empty search','Escape and focus restoration','Ctrl+K','copy code','persistent theme','mobile navigation','mobile ER rendering'],externalNetwork:'blocked'},null,2)+'\n');
 console.log(`PASS: ${pages.length} offline documentation pages, diagrams, images, search, copy, theme, focus, and mobile navigation`);
}catch(error){
 fs.writeFileSync(path.join(artifactDir,'site-failure.json'),JSON.stringify({status:'failed',error:error.message,stack:error.stack,pages:results},null,2)+'\n');
 throw error;
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
