import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { loadPlanDraft, savePlanDraft, editProposal } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// The provider registry lives in the machine home; this test pins USERPROFILE
// to a scratch home so the accuracy endpoint contract is tested without
// touching (or depending on) the real ~/.atl/providers.json.
const realHome = process.env.USERPROFILE;
const realHomePosix = process.env.HOME;
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
fs.mkdirSync(path.join(fakeHome, ".atl"), { recursive: true });
fs.writeFileSync(path.join(fakeHome, ".atl", "providers.json"), JSON.stringify({
  providers: {
    testprov: { id: "testprov", label: "Test Provider", worker: "claude", base_url: "https://example.test/api", api_key: "sk-secret-value", model: "m-1", models: ["m-1", "m-2"] },
  },
}, null, 2));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-accuracy-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(path.join(root, "verification", "plan_studio_accuracy_test.mjs"), "// verifier fixture\n");
saveState(root, emptyState());
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 }));

const verifier = "node verification/plan_studio_accuracy_test.mjs";
const v2Plan = (title, extra = {}) => ({
  plan_contract_version: 2,
  title,
  objective: "Plan the bounded feature end to end",
  requirements: [{ id: "r1", text: "The feature works", source: "original request" }],
  constraints: [],
  observed_evidence: [{ description: "Relevant project verification exists", path: "verification/plan_studio_accuracy_test.mjs" }],
  assumptions: [],
  open_questions: [],
  risks: [],
  completion_checks: ["the feature is observable"],
  acceptance_examples: [{ given: "g", when: "w", then: "t" }],
  implementation_steps: [{ step: "Implement it", files: ["verification/"], verify: verifier }],
  verifier_commands: [verifier],
  task_proposals: [
    { id: "p1", title: "Implement it", objective: "Implement the feature", instructions: "Implement the requested behavior and preserve existing contracts.", deliverables: ["working feature"], requirement_ids: ["r1"], completion_checks: ["the feature is observable"], proposed_worker: "pip", selected_skills: ["atl-verify"], skill_reasons: { "atl-verify": "Plans verifiable acceptance evidence." }, depends_on: [], files: ["verification/plan_studio_accuracy_test.mjs"], verify: verifier },
  ],
  ...extra,
});
let mode = 'accepted', calls = [], pause = null, release = null, startCall = null;
const fakeInvoke = async ({ request }) => {
  calls.push(request);
  if (mode === 'failure' || (mode === 'review-failure' && request.review)) return { code: 1, providerFailure: { reason: 'provider unavailable' } };
  if (pause && request.accuracy_context) { startCall(); await pause; }
  if (request.review && mode === 'review-repair' && calls.filter(call => call.review).length === 1) return { code: 0, text: JSON.stringify({ verdict: 'blocked', findings: [{ severity: 'major', message: 'Answer needs a usable default', correction: 'Use a reversible default' }] }) };
  if (request.review) return { code: 0, text: JSON.stringify({ verdict: mode === 'blocked' ? 'blocked' : 'passed', findings: mode === 'blocked' ? [{ severity: 'major', message: 'Need a consequential decision', correction: 'Choose the required behavior' }] : [] }) };
  if (mode === 'proposal') return { code: 0, text: JSON.stringify({ summary: 'Proposed changes with a question', artifact: v2Plan('Candidate', { open_questions: [{ id: 'q1', question: 'Which verifier?', kind: 'factual', blocks_approval: true }], clarifications: [] }) }) };
  assert.ok(request.accuracy_context);
  const artifact = structuredClone(request.current_artifact);
  artifact.task_proposals[0].instructions += ' Apply the assessed answer.';
  const assessments = request.accuracy_context.questions.map(question => {
    const original = [...artifact.clarifications].reverse().find(a => a.question_id === question.id)?.answer || '';
    return { question_id: question.id, kind: mode === 'preference' ? 'preference' : 'factual', status: ['assumed', 'review-repair'].includes(mode) ? 'assumed' : mode === 'corrected' ? 'corrected' : mode === 'blocked' ? 'unresolved' : 'accepted', answer: mode === 'corrected' ? 'Use the existing project verifier' : ['assumed', 'review-repair'].includes(mode) ? 'Use a reversible default' : mode === 'blocked' ? '' : mode === 'preference' ? 'wrong replacement' : original, explanation: 'Checked the answer against project evidence and updated the affected task.', evidence_paths: ['verification/plan_studio_accuracy_test.mjs'] };
  });
  return { code: 0, text: JSON.stringify({ summary: 'Updated affected task using the assessed answer.', artifact, assessments }) };
};
const running = await startControlPlaneServer(root, { planningInvoke: fakeInvoke });
const post = async (pathname, body) => fetch(`${running.url}${pathname.replace(/^\//, '')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json() }));
const create = (kind = 'factual') => savePlanDraft(root, { intent: 'Implement the bounded feature', artifact: v2Plan('Accuracy conversation', { open_questions: [{ id: 'q1', question: 'Which verifier?', kind, blocks_approval: true }], clarifications: [] }), stage: 'plan', provider: 'testprov', model: 'm-1' });
const clarify = (draft, answer = 'Use the project verifier', extra = {}) => post('/api/plan/clarify', { draftId: draft.id, revision: draft.revision, questionId: 'q1', answer, provider: 'testprov', ...extra });
let browser;
try {
  const { planningPrompt } = await import('../runtime/lib/plan-model.mjs');
  const prompt = planningPrompt({ intent: 'intent', message: 'latest correction', current_artifact: { title: 'retained plan' }, saved_answers: [{ answer: 'retained answer' }], recent_conversation: [{ text: 'retained context' }] });
  for (const value of ['latest correction', 'retained plan', 'retained answer', 'retained context']) assert.ok(prompt.includes(value), 'provider receives refinement context');

  for (const testMode of ['accepted', 'corrected', 'assumed']) {
    mode = testMode; calls = [];
    const draft = create();
    const result = await clarify(draft, testMode === 'accepted' ? 'Use the project verifier' : 'incomplete or incorrect');
    assert.equal(result.status, 200, result.body.error);
    assert.equal(result.body.feedback.status, testMode);
    assert.equal(result.body.feedback.original_answer, testMode === 'accepted' ? 'Use the project verifier' : 'incomplete or incorrect');
    assert.equal(result.body.review_ready, true);
    assert.equal(result.body.draft.pending_candidate, undefined, 'automatic correction needs no candidate approval');
    assert.equal(calls.length, 2, 'exactly one correction and one review');
    assert.ok(result.body.draft.conversation.some(entry => entry.role === 'manager' && entry.text === result.body.feedback.original_answer), 'conversation preserves what the chief actually answered');
    assert.match(loadPlanDraft(root, draft.id).artifact.task_proposals[0].instructions, /assessed answer/);
    if (testMode === 'assumed') assert.match(result.body.draft.artifact.assumptions.join(' '), /Assumption/);
    const count = calls.length;
    await clarify(result.body.draft, result.body.feedback.original_answer);
    assert.equal(calls.length, count, 'duplicate submission does not spend again');
  }
  mode = 'review-repair'; calls = [];
  const reviewedDraft = create();
  const reviewFlow = await post('/api/plan/review', { draftId: reviewedDraft.id, provider: 'testprov' });
  assert.equal(reviewFlow.status, 200, reviewFlow.body.error);
  assert.equal(reviewFlow.body.review.verdict, 'passed');
  assert.equal(calls.length, 3, 'review finding triggers exactly one repair and one follow-up review');
  assert.ok(reviewFlow.body.draft.conversation.some(entry => /Answer needs a usable default/.test(entry.text)));
  assert.equal(reviewFlow.body.draft.answer_assessments.q1.status, 'assumed');

  mode = 'review-failure'; calls = [];
  const reviewFailure = await clarify(create());
  assert.equal(reviewFailure.status, 200);
  assert.equal(reviewFailure.body.draft.accuracy_followup.status, 'retry');
  assert.equal(reviewFailure.body.review_ready, false);
  assert.equal(calls.length, 2);
  assert.match(reviewFailure.body.draft.artifact.task_proposals[0].instructions, /assessed answer/);

  mode = 'proposal';
  const candidateBase = create();
  await post('/api/plan/refine', { draftId: candidateBase.id, provider: 'testprov', message: 'Propose a change', confirm: true });
  mode = 'corrected'; calls = [];
  const candidateResult = await clarify(loadPlanDraft(root, candidateBase.id), 'wrong verifier', { target: 'candidate' });
  assert.equal(candidateResult.status, 200, candidateResult.body.error);
  assert.equal(candidateResult.body.feedback.status, 'corrected');
  assert.equal(candidateResult.body.draft.pending_candidate.review.verdict, 'passed');
  assert.equal(candidateResult.body.draft.revision, candidateBase.revision, 'checking proposed changes cannot apply them');
  assert.deepEqual(candidateResult.body.draft.artifact, candidateBase.artifact, 'saved plan remains unchanged until explicit apply');
  assert.equal(candidateResult.body.review_ready, false);
  assert.equal(calls.length, 2);
  assert.equal(candidateResult.body.draft.pending_candidate.answer_assessments.q1.original_answer, 'wrong verifier');

  mode = 'preference'; calls = [];
  const preference = create('preference');
  const prefResult = await clarify(preference, 'Keep my chosen behavior');
  assert.equal(prefResult.body.draft.accuracy_followup.status, 'retry');
  assert.equal(prefResult.body.draft.artifact.clarifications.at(-1).answer, 'Keep my chosen behavior');
  assert.equal(calls.length, 1, 'a rejected correction cannot reach review');

  mode = 'failure';
  const failed = create();
  const failure = await clarify(failed);
  assert.equal(failure.body.draft.answer_assessments.q1.status, 'pending');
  assert.equal(failure.body.draft.accuracy_followup.status, 'retry');
  assert.equal(loadPlanDraft(root, failed.id).artifact.clarifications.length, 1);
  mode = 'accepted';
  const retry = await clarify(failure.body.draft);
  assert.equal(retry.body.review_ready, true);

  mode = 'blocked'; calls = [];
  const blocked = create();
  const response = await clarify(blocked);
  assert.equal(response.body.review.verdict, 'blocked');
  assert.equal(response.body.draft.accuracy_followup.status, 'complete');
  assert.equal(calls.length, 2, 'follow-up findings cannot trigger a loop');
  assert.equal((await post('/api/plan/approve', { draftId: blocked.id })).status, 409);
  assert.ok(response.body.draft.conversation.some(entry => /Planning stays open/i.test(entry.text)));

  mode = 'accepted'; calls = [];
  const stale = create();
  assert.equal((await clarify(stale, 'answer', { revision: 999 })).status, 409);
  assert.equal(calls.length, 0);
  pause = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { startCall = resolve; });
  const pending = clarify(stale);
  await started;
  const latest = loadPlanDraft(root, stale.id);
  editProposal(root, latest, 'p1', { title: 'Newer manual edit' });
  release();
  assert.equal((await pending).status, 409);
  assert.equal(loadPlanDraft(root, stale.id).artifact.task_proposals[0].title, 'Newer manual edit');
  pause = null;

  const progress = create();
  await post('/api/plan/question-progress', { draftId: progress.id, progress: { q1: 'unfinished answer' } });
  assert.equal(loadPlanDraft(root, progress.id).question_progress.q1, 'unfinished answer');
  assert.equal(loadPlanDraft(root, progress.id).revision, 1);
  assert.equal((await clarify(progress, '')).status, 400);

  // Optional questions are allowed only with an explicit usable default.
  const { reviewPlanArtifact } = await import('../runtime/lib/plan-studio.mjs');
  const optional = savePlanDraft(root, { intent: 'Optional choice', artifact: v2Plan('Optional', { open_questions: [{ id: 'q1', question: 'Color?', blocks_approval: false, default_answer: 'blue' }] }), stage: 'plan' });
  const reviewed = reviewPlanArtifact(root, optional, { verdict: 'passed', findings: [] });
  assert.equal(reviewed.review.verdict, 'passed');

  // Render the actual Studio on desktop and mobile using the same endpoint.
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  await page.goto(running.url);
  await page.locator('[data-page="studio"]').first().click();
  const savedPlans = page.locator('[data-saved-plans]');
  await savedPlans.evaluate(node => { node.open = true; });
  await page.locator(`[data-action="plan-load:${progress.id}"]`).click();
  const panel = page.locator('[data-studio-questions]');
  await panel.locator('summary').click();
  const input = page.locator('#studio-q-custom-artifact-q1');
  assert.equal(await input.inputValue(), 'unfinished answer');
  await input.fill('my unfinished response');
  await panel.locator('summary').click();
  await panel.locator('summary').click();
  assert.equal(await input.inputValue(), 'my unfinished response');
  await page.reload();
  await page.locator('[data-page="studio"]').first().click();
  await page.locator('[data-saved-plans]').evaluate(node => { node.open = true; });
  await page.locator(`[data-action="plan-load:${progress.id}"]`).click();
  assert.equal(await input.inputValue(), 'my unfinished response');
  await page.setViewportSize({ width: 390, height: 844 });
  const conversationTab = page.locator('[data-action="studio-pane:conversation"]');
  if (await conversationTab.isVisible()) await conversationTab.click();
  assert.ok(await page.locator('.studio-conversation').evaluate(node => node.getBoundingClientRect().width > window.innerWidth * 0.8), 'mobile conversation uses the available width');
  await input.focus();
  await input.press('Tab');
  assert.equal(await page.locator('[data-action="question-answer:artifact:q1"]').evaluate(node => node === document.activeElement), true, await page.evaluate(() => document.activeElement.outerHTML.slice(0, 400)));
  mode = 'corrected';
  pause = new Promise(resolve => { release = resolve; });
  const browserCheckStarted = new Promise(resolve => { startCall = resolve; });
  await page.locator('[data-action="question-answer:artifact:q1"]').click();
  await browserCheckStarted;
  assert.match(await page.locator('[data-studio-question="q1"]').textContent(), /Checking answer/);
  assert.equal(await page.locator('#goal').isEnabled(), true, 'conversation stays open during answer checking');
  assert.equal(await page.locator('[data-action="refine-submit"]').isDisabled(), false);
  release(); pause = null;
  await page.getByText('Answer checked and plan updated. You can keep planning.', { exact: true }).waitFor();
  assert.match(await page.locator('[data-studio-question="q1"]').textContent(), /Using: Use the existing project verifier/);
  assert.equal(await page.locator('#goal').isEnabled(), true);
  await page.screenshot({ path: path.join(root, 'accuracy-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(root, 'accuracy-desktop.png'), fullPage: true });
  // A review completing in the background must not reopen the old draft.
  mode = 'review-repair'; calls = [];
  pause = new Promise(resolve => { release = resolve; });
  const backgroundStarted = new Promise(resolve => { startCall = resolve; });
  await page.locator('[data-action="studio-plantab:review"]').click();
  const backgroundResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plan/review');
  await page.locator(`[data-action="plan-review:${progress.id}"]`).click();
  await backgroundStarted;
  assert.equal(await page.locator('[data-action="refine-submit"]').isDisabled(), false, 'review does not lock conversation');
  await page.locator('[data-action="studio-plantab:overview"]').click();
  await page.locator('[data-saved-plans]').evaluate(node => { node.open = true; });
  await page.locator(`[data-action="plan-load:${optional.id}"]`).click();
  release(); pause = null;
  await (await backgroundResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('heading', { name: 'Optional', exact: true }).count() > 0, true, 'completed review preserves the selected draft');
  console.log(`PASS: conversational accuracy API, concurrency, failures, and desktop/mobile questionnaire. Screenshots: ${root}`);
} finally {
  await browser?.close();
  await new Promise(resolve => running.server.close(resolve));
  process.env.USERPROFILE = realHome;
  if (realHomePosix === undefined) delete process.env.HOME; else process.env.HOME = realHomePosix;
}
