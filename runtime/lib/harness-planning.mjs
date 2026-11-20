import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { withFileLock, readJson, atomicJson } from './file-transaction.mjs';
import { planningEvidence, savePlanDraft, loadPlanDraft, validatePlanArtifact, validatePlanGrounding, repositoryStamp, resolvePlanRepository, replaceHarnessPlanArtifact, answerPlanQuestion, listPlanDrafts } from './plan-studio.mjs';
import { loadState } from './state.mjs';
import { programPlanningContext } from './programs.mjs';

export const clarificationModes = ['all', 'consequential', 'defaults'];
const home = () => process.env.ATL_HOME || path.join(process.env.HOME || process.env.USERPROFILE, '.atl');
const store = root => path.join(root, '.trust', 'manager', 'harness-planning.json');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { statusCode: 409 }); };
const git = (root, args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim(); } catch { return null; } };
export function repositoryContext(root) {
  return { root: fs.realpathSync(root), git: git(root, ['rev-parse', '--is-inside-work-tree']) === 'true', branch: git(root, ['symbolic-ref', '--short', '-q', 'HEAD']), base_revision: git(root, ['rev-parse', '--verify', 'HEAD']), bootstrap_required: !git(root, ['rev-parse', '--verify', 'HEAD']) };
}
export function planningPreferences(root, { mode, scope = 'request' } = {}) {
  if (mode !== undefined && !clarificationModes.includes(mode)) throw new Error('clarification mode must be all, consequential, or defaults');
  if (!['personal', 'project', 'request'].includes(scope)) throw new Error('preference scope must be personal, project, or request');
  const personalFile = path.join(home(), 'planning-preferences.json');
  if (mode && scope !== 'request') {
    const file = scope === 'personal' ? personalFile : path.join(root, '.trust', 'planning-preferences.json');
    withFileLock(file, () => atomicJson(file, { mode, updated_at: new Date().toISOString() }));
  }
  const personal = readJson(personalFile, {}), project = readJson(path.join(root, '.trust', 'planning-preferences.json'), {});
  return { mode: (scope === 'request' && mode) || project.mode || personal.mode || 'consequential', source: scope === 'request' && mode ? 'request' : project.mode ? 'project' : personal.mode ? 'personal' : 'default', ask_preference: !personal.mode && !project.mode && !mode };
}
export function assertHarnessRevision(root, payload) {
  const draft = loadPlanDraft(root, String(payload.draftId || ''));
  if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision !== draft.revision) fail('Plan changed; reload the current revision before continuing');
  if (draft.harness?.project && draft.harness.project !== fs.realpathSync(root)) fail('Plan belongs to another project');
  const repo = resolvePlanRepository(root, draft);
  if (draft.harness?.base_revision !== undefined && draft.harness.base_revision !== (draft.harness.base_branch ? git(repo.repoRoot || root, ['rev-parse', '--verify', `${draft.harness.base_branch}^{commit}`]) : repositoryContext(repo.repoRoot || root).base_revision)) fail('Repository base revision changed; refresh the plan and review');
  return draft;
}
export function harnessPlanView(root, draft) {
  const artifact = draft.artifact || {};
  return { draftId: draft.id, revision: draft.revision, stage: draft.stage, author: draft.harness?.author || null, target: draft.harness || draft.repository, artifact, review: draft.review || null, questions: (artifact.open_questions || []).filter(q => !q.resolved), next_actions: draft.stage === 'approved' ? ['run_preview'] : ['save', 'answer', 'review', 'approve'], approval_packet: { outcome: artifact.objective, target: draft.harness || draft.repository, assumptions: artifact.assumptions || [], verification: artifact.verifier_commands || [], delivery: 'reviewed-local-branches; draft PR only when explicitly authorized' } };
}
export function harnessPlanContext(root, payload = {}) {
  const preferences = planningPreferences(root, payload.preference || {});
  const draft = payload.draftId ? loadPlanDraft(root, payload.draftId) : null;
  const repo = payload.repositoryId || payload.sourceTaskId ? resolvePlanRepository(root, { repository_id: payload.repositoryId, source_task_id: payload.sourceTaskId }) : { repoRoot: root };
  if (payload.sourceTaskId && !loadState(root).tasks[payload.sourceTaskId]) throw new Error('Unknown source task');
  if(Boolean(payload.programId)!==Boolean(payload.milestoneId))throw new Error('programId and milestoneId must be supplied together');
  const program=payload.programId?programPlanningContext(payload.programCoordinator?fs.realpathSync(payload.programCoordinator):root,payload.programId,payload.milestoneId):null;
  return { project: fs.realpathSync(root), repository: repositoryContext(repo.repoRoot || root), preferences, evidence: planningEvidence(root, draft?.artifact || {}, { repoRoot: repo.repoRoot }), source: payload.sourceTaskId ? loadState(root).tasks[payload.sourceTaskId] : null, program, draft: draft && harnessPlanView(root, draft), drafts: draft ? undefined : listPlanDrafts(root).map(d => ({ id: d.id, stage: d.stage, title: d.artifact?.title })), contract_version: 2, instructions: 'Plan in this harness chat. Ask the clarification preference once. Investigate discoverable facts, record assumptions, persist questions and answers. Use the full version 2 Plan Studio contract. For a program milestone, plan only when program.ready is true and use its predecessor_evidence. Review through ATL policy, then obtain approval of this revision and a bounded run preview. Never fabricate evidence or user authorization.' };
}
export function saveHarnessPlan(root, payload) {
  if (!payload.idempotencyKey || typeof payload.idempotencyKey !== 'string') throw new Error('idempotencyKey is required');
  const author = String(payload.author || '').trim();
  if (!author) throw new Error('Identify the current harness assistant as author');
  const artifact = structuredClone(payload.artifact);
  // Reviews are produced by the existing runtime reviewer, never imported from an author.
  if (!artifact || artifact.review) throw new Error('Supply an artifact without author-supplied review evidence');
  const intent = String(payload.intent || artifact.objective || '').trim();
  if (!intent) throw new Error('Planning intent is required');
  const file = store(root);
  return withFileLock(file, () => {
    const book = readJson(file, { operations: {} });
    const digest = hash(payload);
    const prior = book.operations[payload.idempotencyKey];
    if (prior) {
      if (prior.digest !== digest) fail('Idempotency key was already used for different content');
      return harnessPlanView(root, loadPlanDraft(root, prior.draftId));
    }
    const current = payload.draftId ? assertHarnessRevision(root, payload) : null;
    if (current && payload.repositoryId && payload.repositoryId !== current.repository?.id) fail('Repository binding cannot change during an edit');
    if (current?.stage === 'approved') fail('Approved plan is immutable; create a successor draft');
    const sourceTaskId = current?.source_task_id || payload.sourceTaskId || null;
    if (sourceTaskId && !loadState(root).tasks[sourceTaskId]) throw new Error('Unknown source task');
    if (current && payload.sourceTaskId && payload.sourceTaskId !== current.source_task_id) fail('Source issue cannot change during an edit');
    if (current && payload.issue && payload.issue !== current.harness?.issue) fail('Source issue binding cannot change during an edit');
    const repository = current?.repository || ((payload.repositoryId || sourceTaskId) ? repositoryStamp(root, { repository_id: payload.repositoryId, source_task_id: sourceTaskId }) : null);
    const repo = resolvePlanRepository(root, { repository, source_task_id: sourceTaskId });
    const target = repositoryContext(repo.repoRoot || root);
    if (payload.baseBranch && target.base_revision && !git(repo.repoRoot || root, ['rev-parse', '--verify', `${payload.baseBranch}^{commit}`])) throw new Error('Requested base branch does not exist');
    if (payload.baseBranch && git(repo.repoRoot || root, ['rev-parse', '--verify', `${payload.baseBranch}^{commit}`]) !== target.base_revision) fail('Select a worktree checked out at the requested base branch before grounding this plan');
    const baseRevision = payload.baseBranch ? git(repo.repoRoot || root, ['rev-parse', '--verify', `${payload.baseBranch}^{commit}`]) : target.base_revision;
    const stage=payload.state==='draft'?'frame':'plan';
    if (stage === 'plan') {
      validatePlanArtifact(artifact);
      if (artifact.plan_contract_version !== 2) throw new Error('Harness plans require plan contract version 2');
      validatePlanGrounding(root, artifact, { repoRoot: repo.repoRoot });
    } else if (!artifact.title || !(artifact.objective || intent)) {
      throw new Error('A saved planning draft needs a title and objective');
    }
    const harness = { project: fs.realpathSync(root), author, base_branch: payload.baseBranch || target.branch, base_revision: baseRevision, clarification: planningPreferences(root, payload.preference || {}), issue: current ? current.harness?.issue || null : payload.issue || null, updated_at: new Date().toISOString() };
    let draft;
    if (current) draft = replaceHarnessPlanArtifact(root, current, artifact, harness, stage);
    else {
      // Deterministic creation identity makes a retry after a process interruption recoverable.
      const id = `harness-${hash({ project: fs.realpathSync(root), key: payload.idempotencyKey }).slice(0, 24)}`;
      const dir = path.join(root, '.trust', 'manager', 'plan-studio', id);
      if (fs.existsSync(path.join(dir, 'artifact.json'))) {
        draft = loadPlanDraft(root, id);
        if (draft.harness?.creation_digest !== digest) fail('Interrupted creation needs reconciliation');
      } else {
        draft = savePlanDraft(root, { id, intent, artifact, stage, sourceTaskId, repository });
        draft = replaceHarnessPlanArtifact(root, draft, artifact, { ...harness, creation_digest: digest }, stage);
      }
    }
    book.operations[payload.idempotencyKey] = { digest, draftId: draft.id, revision: draft.revision };
    atomicJson(file, book);
    return harnessPlanView(root, draft);
  });
}
export function answerHarnessPlan(root, payload) {
  const draft = assertHarnessRevision(root, payload);
  return harnessPlanView(root, answerPlanQuestion(root, draft, payload.questionId, payload.answer, { expectedRevision: payload.expectedRevision }));
}
// Establish an initial revision without staging or committing developer files.
export function bootstrapRepository(root, { confirm = false, branch = 'main' } = {}) {
  if (confirm !== true) throw new Error('Repository initialization and initial local commit require explicit confirmation');
  const current = repositoryContext(root);
  if (current.base_revision) return { ...current, created: false };
  const run = (args, input) => execFileSync('git', args, { cwd: root, input, encoding:'utf8', stdio:['pipe','pipe','pipe'], env:{...process.env,GIT_AUTHOR_NAME:'ATL runtime',GIT_AUTHOR_EMAIL:'atl@localhost',GIT_COMMITTER_NAME:'ATL runtime',GIT_COMMITTER_EMAIL:'atl@localhost'} }).trim();
  run(['check-ref-format', `refs/heads/${branch}`]);
  if (!current.git) run(['init', '-b', branch]);
  const ref = run(['symbolic-ref','HEAD']);
  const tree = run(['hash-object','-t','tree','-w','--stdin'], '');
  const commit = run(['commit-tree',tree], 'ATL approved project bootstrap\n');
  run(['update-ref',ref,commit,'0'.repeat(commit.length)]);
  return { ...repositoryContext(root), created:true, initial_commit:commit };
}
export function claimPlanApproval(root,payload){
  if(payload.confirm!==true||!payload.idempotencyKey)throw new Error('Plan approval needs explicit confirmation and idempotencyKey');
  const file=store(root);
  return withFileLock(file,()=>{
    const book=readJson(file,{operations:{}}),key=`approval:${payload.idempotencyKey}`;
    const value={draftId:payload.draftId,revision:payload.expectedRevision};
    const prior=book.operations[key];
    if(prior&&hash(prior)!==hash(value))fail('Approval idempotency key is bound to another plan revision');
    book.operations[key]=value;atomicJson(file,book);return value;
  });
}
