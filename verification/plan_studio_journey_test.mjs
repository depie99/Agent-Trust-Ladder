import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createTask, emptyState, loadState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-journey-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-home-"));
const oldHome = process.env.USERPROFILE; const oldHomePosix = process.env.HOME; process.env.USERPROFILE = home; process.env.HOME = home;
const oldGithub = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = "test-github-token";
fs.mkdirSync(path.join(home, ".atl"), { recursive: true });
fs.writeFileSync(path.join(home, ".atl", "providers.json"), JSON.stringify({ providers: { test: { id:"test", label:"Test", worker:"openai-http", protocol:"openai", base_url:"https://example.test/v1", api_key:"test-key", model:"test-model" } } }));
fs.mkdirSync(path.join(root, "config"), {recursive:true}); fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({version:1}));
const initialState = emptyState();
const imported = createTask(initialState, { title: "Bug 6341: S2H - Top sales issue", source: { type: "azure", project: "example-project", remote_id: 6341, revision: 5, repository: null }, intake_key: "azure:6341", plan_review_required: true });
imported.objective_hint = "محصولات پرفروش درست نیستند؛ در نبود محصول پرفروش، محصولات براساس تاریخ درج و موجود بودن نمایش داده شوند. ادغام‌شده از #6375: هر دو سکشن محصول صفحه اول بازبینی شوند.";
imported.completion_checks = ["هر دو سکشن محصول صفحه اول بازبینی شوند"];
// The plan-under-test journey seeds its planning target directly: the
// browser task-creation modal is a separate surface with its own tests.
const seeded = createTask(initialState, { title: "Search project rooms" });
seeded.objective = "Filter repositories by name. Preserve deletion behavior.";
seeded.completion_checks = ["Filter repositories by name"];
saveState(root, initialState);
fs.mkdirSync(path.join(root, "src"), {recursive:true}); fs.writeFileSync(path.join(root, "src", "projects.js"), "// project fixture\n");
fs.mkdirSync(path.join(root, "test"), {recursive:true}); fs.writeFileSync(path.join(root, "test", "search.mjs"), "// verifier fixture\n");
let calls = 0, requested;
let publishWrites = 0;
const planningInvoke = async ({request}) => { calls++; requested=request; return {code:0,provider:"test",model:"test-model",text:JSON.stringify(request.review ? {verdict:"passed",findings:[]} : {plan_contract_version:2,title:"Search project rooms",objective:request.intent,requirements:[{id:"r1",text:"Search filters by repository name",source:"original request"}],constraints:["Do not change deletion"],observed_evidence:[{description:"Search test command is supplied",path:"test/search.mjs"}],assumptions:[],open_questions:[],risks:["Search could hide selected rows"],completion_checks:["Search filters by repository name"],acceptance_examples:[{given:"two repositories",when:"the user searches Alpha",then:"only Alpha is shown"}],selected_skills:["atl-implement"],skill_route:[],proposed_worker:"pip",implementation_steps:[{step:"Implement search",files:["src/projects.js"],verify:"node test/search.mjs"}],verifier_commands:["node test/search.mjs"],task_proposals:[{id:"p1",title:"Implement repository search",objective:request.intent,instructions:"Add repository name filtering while preserving the existing selection and deletion behavior.",deliverables:["search behavior in project list"],requirement_ids:["r1"],completion_checks:["node test/search.mjs"],proposed_worker:"pip",selected_skills:["atl-implement"],skill_reasons:{"atl-implement":"Implements the bounded UI behavior described by the request."},depends_on:[],files:["src/projects.js"],verify:"node test/search.mjs"}]})}; };
let browser, server;
try {
  const publishFetch = async (_url, options = {}) => { publishWrites++; assert.equal(options.method, "POST"); return { ok: true, status: 201, statusText: "Created", text: async () => JSON.stringify({ number: 24, html_url: "https://github.com/acme/demo/issues/24", updated_at: "r1" }) }; };
  const started = await startControlPlaneServer(root,{planningInvoke, publishFetch}); server=started.server;
  browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1280,height:900}}); page.setDefaultTimeout(30000); // slow CI runners and big trees need headroom
  await page.goto(started.url); await page.locator('[data-page="tasks"]').first().click();
  await page.getByText('Search project rooms',{exact:true}).first().click(); await page.getByRole('button',{name:'More task actions',exact:true}).click(); await page.getByRole('button',{name:'Plan task',exact:true}).click();
  assert.match(await page.locator('#goal').inputValue(),/Filter repositories by name/);
  const initialGoal = await page.locator('#goal').inputValue();
  assert.ok(await page.locator('.studio-plan').evaluate(pane => pane.clientWidth > pane.parentNode.querySelector('.studio-conversation').clientWidth), 'Plan gets more space in the desktop split');
  assert.ok(await page.locator('.studio-workspace').evaluate(workspace => workspace.getBoundingClientRect().left - workspace.closest('.main').getBoundingClientRect().left <= 16), 'Workspace sits close to the sidebar');
  await page.getByRole('button', {name:'Focus conversation',exact:true}).click();
  assert.equal(await page.locator('.studio-plan').isVisible(), false);
  assert.equal(await page.locator('#goal').inputValue(), initialGoal);
  await page.getByRole('button', {name:'Show Plan',exact:true}).click();
  assert.equal(await page.locator('.studio-plan').isVisible(), true);
  await page.getByRole('button', {name:'Focus Plan',exact:true}).click();
  assert.equal(await page.locator('.studio-conversation').isVisible(), false);
  await page.locator('.planpane-tabs [data-action="studio-plantab:tasks"]').click();
  assert.equal(await page.locator('.studio-conversation').isVisible(), false);
  await page.getByRole('button', {name:'Show conversation',exact:true}).click();
  assert.equal(await page.locator('#goal').inputValue(), initialGoal);
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-action="studio-pane:plan"]').click();
  assert.equal(await page.locator('.studio-plan').isVisible(), true);
  await page.locator('[data-action="studio-pane:conversation"]').click();
  assert.equal(await page.locator('#goal').inputValue(), initialGoal);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({width:1280,height:900});
  // The planning mode lives in the composer's settings popover now.
  await page.locator('.studio-settings > summary').click();
  await page.getByRole('button',{name:'Generate with model',exact:true}).click();
  assert.match(await page.locator('#goal').inputValue(),/Filter repositories by name/, 'objective survives rerender');
  await page.route('**/api/providers', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    assert.deepEqual(route.request().postDataJSON(), { action: 'models', id: 'test' });
    await route.fulfill({ json: { ok: true, models: ['discovered-model'] } });
  });
  await page.getByRole('button',{name:'Load models',exact:true}).click();
  await page.locator('#providerModelSuggestions option[value="discovered-model"]').waitFor({ state: 'attached' });
  await page.locator('#providerModel').fill('unlisted-exact-model');
  const generationRequest = page.waitForRequest((request) => request.url().endsWith('/api/plan/generate'));
  await page.getByRole('button',{name:'Generate plan',exact:true}).click();
  assert.equal((await generationRequest).postDataJSON().model, 'unlisted-exact-model');
  await page.getByText('Model plan ready', {exact:false}).waitFor();
  assert.equal(calls,1); assert.match(requested.intent,/Preserve deletion behavior/);
  assert.equal(Object.keys(loadState(root).tasks).length,2,'generation does not create tasks');
  // The plan opens in the Tasks tab; review controls live in the Review tab.
  await page.locator('.planpane-tabs [data-action="studio-plantab:review"]').click();
  await page.getByRole('heading',{name:'Review this plan'}).waitFor();
  await page.getByRole('button',{name:'Run review'}).click();
  await page.getByRole('region',{name:'Plan review'}).getByText('Accuracy review passed',{exact:false}).waitFor();
  const evidenceOutput = process.env.ATL_TEST_EVIDENCE_DIR;
  if (evidenceOutput) await page.screenshot({path:path.join(evidenceOutput,"before.png")});
  const approvalRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/plan/approve');
  await page.getByRole('region',{name:'Plan review'}).getByRole('button',{name:'Approve → Plan Queue'}).click();
  await page.getByText('Plan approved — Plan Queue created').waitFor();
  assert.ok(JSON.parse((await approvalRequest).postData()).draftId, 'browser approval always uses the revision-aware API');
  const state=loadState(root); const generated=Object.values(state.tasks).filter(t=>t.plan_draft_id);
  assert.equal(generated.length,1); assert.match(generated[0].objective,/Filter repositories by name/); assert.deepEqual(generated[0].completion_checks,['node test/search.mjs']);
  assert.notEqual(generated[0].status,'in_progress');
  if (evidenceOutput) await page.screenshot({path:path.join(evidenceOutput,"after.png")});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('[data-page="studio"]').first().click();
  await page.locator('.planpane-tabs [data-action="studio-plantab:review"]').click();
  await page.getByRole('button',{name:'Publish to GitHub/Azure'}).click();
  // The publish destination is an explicit HTML form, not a native prompt.
  await page.locator('#publishDestination').selectOption('github');
  await page.locator('#publishRepository').fill('acme/demo');
  await page.getByRole('button',{name:'Preview changes',exact:true}).click();
  await page.getByText('Review remote task changes',{exact:true}).waitFor();
  assert.equal(publishWrites,0,'the publish preview performs no writes');
  await page.getByRole('button',{name:'Publish tasks',exact:true}).click();
  await page.getByText('Tasks published',{exact:true}).waitFor();
  assert.equal(publishWrites,1,'publishing writes only after the explicit confirmation');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  // A fresh plan starts from a cleared composer: one conversation per draft.
  await page.getByRole('button',{name:'Clear form',exact:true}).click();
  await page.locator('.studio-settings > summary').click();
  await page.getByRole('button',{name:'Local skeleton',exact:true}).click();
  const localIntent = 'Add "case-insensitive" search.\nPreserve selected rows.';
  await page.locator('#goal').fill(localIntent);
  await page.getByRole('button',{name:/Generate local skeleton/}).click();
  await page.getByText('Not reviewable, not approvable', {exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Complete with model'}).count(),1);
  assert.match(await page.locator('#planOutput').innerText(),/Add "case-insensitive" search/,'the skeleton overview shows the request verbatim');
  assert.equal(Object.keys(loadState(root).tasks).length,3,'local generation creates no tasks');
  assert.equal(await page.getByText('Nothing has started.',{exact:true}).count(),0);

  console.log('PASS: browser create task → plan task → model draft → approve → persisted task/queue, no run');
  await page.locator('[data-page="tasks"]').first().click();
  await page.getByRole("button",{name:"Open imported requests",exact:true}).click();
  await page.getByText(/Bug 6341: S2H - Top sales issue/).first().waitFor();
  await page.getByRole("button",{name:"Create plan",exact:true}).click();
  assert.match(await page.locator("#goal").inputValue(),/محصولات پرفروش درست نیستند/,"the Azure work item description is preserved in Plan Studio");
  await page.getByText("Check the codebase before planning · example-project",{exact:false}).waitFor();
  assert.match(await page.locator("[data-plan-source-context]").textContent(),/no linked code repository/);
  await page.locator('.studio-settings > summary').click();
  await page.getByRole("button",{name:/Generate with model/}).click();
  await page.locator('[data-action="generate"]').last().click();
  await page.getByText("Confirm the current codebase",{exact:false}).waitFor();
  assert.equal(calls,2,"an unlinked Azure repository requires a workspace confirmation before model spend");
  await page.getByRole("button",{name:"This ATL workspace is the correct repository"}).click();
  await page.locator('[data-action="generate"]').last().click();
  await page.getByText("Model plan ready",{exact:false}).waitFor();
  assert.equal(calls,3);
  assert.match(requested.intent,/example-project/);
  assert.match(requested.intent,/محصولات پرفروش درست نیستند/);

  // Conversational refinement: one bounded call proposes changes beside the
  // saved plan; applying them bumps the revision and clears review readiness.
  await page.locator('#goal').fill('Add a regression task for empty search queries.');
  await page.getByRole('button',{name:'Update plan',exact:true}).click();
  await page.locator('[data-candidate-banner]').waitFor();
  assert.match(await page.locator('[data-candidate-banner]').innerText(),/based on rev 1/,'the proposal names the revision it is based on');
  assert.equal(calls,4); assert.match(requested.message,/regression task/); assert.ok(requested.current_artifact,'the refinement request carries the current artifact');
  assert.equal(Object.keys(loadState(root).tasks).length,3,'a proposed change creates no tasks until applied');
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  await page.getByText('Changes applied',{exact:false}).waitFor();
  assert.equal(Object.keys(loadState(root).tasks).length,3,'applying a proposal still creates no tasks');
  await page.locator('.planpane-tabs [data-action="studio-plantab:review"]').click();
  await page.getByRole('heading',{name:'Review this plan'}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Plan review'}).getByRole('button',{name:'Approve → Plan Queue'}).isDisabled(),true,'applying clears review readiness, so approval is locked again');

} finally { if(browser) await browser.close(); if(server) { const closed = new Promise(r=>server.close(r)); server.closeAllConnections?.(); await closed; } if(oldHome===undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE=oldHome; if(oldHomePosix===undefined) delete process.env.HOME; else process.env.HOME=oldHomePosix; if(oldGithub===undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN=oldGithub; fs.rmSync(root,{recursive:true,force:true});fs.rmSync(home,{recursive:true,force:true}); }
