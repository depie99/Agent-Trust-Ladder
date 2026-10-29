import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateLocalPlan, validatePlanArtifact, approvePlanDraft, savePlanDraft, reviewPlanArtifact } from "../runtime/lib/plan-studio.mjs";
import { queueSelect, buildInvocation, runInvocation } from "../runtime/lib/worker.mjs";
import { emptyState, saveState, loadState, reviseTaskPacket } from "../runtime/lib/state.mjs";
import { autoRecoverBlockedTask } from "../runtime/lib/recovery.mjs";
import { executeLaunchQueue, stalledHandoffFailure } from "../runtime/lib/launch.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-dependency-contract-"));
try {
  assert.equal(stalledHandoffFailure("error: EPERM: operation not permitted, open 'D:\\p\\.trust\\manager\\state.json.tmp'\n").cause, "manager-state-access");
  assert.equal(stalledHandoffFailure("error: scoped worker credential cannot impersonate this actor\n").cause, "worker-credential");
  assert.equal(stalledHandoffFailure("error: EPERM: operation not permitted, open 'D:\\p\\workspace\\file.txt'\n"), null);
  assert.equal(stalledHandoffFailure("The documentation mentions scoped worker credential cannot impersonate this actor."), null);
  saveState(root, emptyState());
  const plan = generateLocalPlan("Dependency regression");
  fs.writeFileSync(path.join(root, 'check.mjs'), 'process.exit(0);\n');
  plan.plan_contract_version = 2;
  plan.requirements = [{ id: 'r1', text: 'Preserve dependencies through approval', source: 'original request' }];
  plan.open_questions = [];
  plan.assumptions = [];
  plan.observed_evidence = [{ path: 'check.mjs', description: 'Executable fixture verifier' }];
  plan.verifier_commands = ['node check.mjs'];
  plan.implementation_steps = plan.implementation_steps.map(step => ({ ...step, files: ['check.mjs'], verify: 'node check.mjs' }));
  for (const proposal of plan.task_proposals) Object.assign(proposal, { requirement_ids: ['r1'], instructions: proposal.objective, deliverables: ['check.mjs'], files: ['check.mjs'], verify: 'node check.mjs', skill_reasons: Object.fromEntries(proposal.selected_skills.map(skill => [skill, 'Owns this bounded dependency fixture stage.'])) });
  const cycle = structuredClone(plan);
  cycle.task_proposals[0].depends_on = [cycle.task_proposals.at(-1).id];
  assert.throws(() => validatePlanArtifact(cycle), /dependency cycle/);
  plan.task_proposals.reverse();
  const draft = savePlanDraft(root, { intent: plan.objective, artifact: plan, stage: "plan" });
  assert.throws(() => approvePlanDraft(root, draft.id), /fresh, passing accuracy review/);
  const reviewed = reviewPlanArtifact(root, draft.id, { verdict: 'passed', findings: [] });
  const approved = approvePlanDraft(root, reviewed.id);
  const tasks = approved.tasks;
  assert.equal(tasks[0].plan_proposal_id, "p1");
  assert.ok(tasks[1].plan_depends_on.includes(tasks[0].id), "forward references survive approval");
  const prerequisite = { id: "T-018", status: "assigned", priority: "low", plan_depends_on: [] };
  const dependent = { id: "T-019", status: "assigned", priority: "urgent", plan_depends_on: ["T-018"] };
  assert.deepEqual(queueSelect([dependent, prerequisite]).map(t => t.id), ["T-018", "T-019"]);
  assert.deepEqual(queueSelect([dependent, prerequisite], { preserveOrder: true }).map(t => t.id), ["T-018", "T-019"]);
  assert.throws(() => queueSelect([{ ...prerequisite, plan_depends_on: ["T-019"] }, dependent]), /dependency cycle/);
  const state = loadState(root);
  const task = state.tasks[tasks[0].id];
  task.attempt_count = 17;
  task.evidence = [{ kind: "review", result: "changes-requested", detail: "OBSOLETE REVIEW", packet_revision: 1 }];
  reviseTaskPacket(state, task.id, { reason: "correct downstream ownership" });
  assert.equal(task.attempt_count, 17);
  assert.equal(task.attempt_count_at_revision, 17);
  const invocation = buildInvocation("codex", { root, role: "rowan", task: { ...task, plan_context: [{ id: "T-019", objective: "Client wiring" }] } });
  assert.ok(invocation.prompt.includes("Client wiring"));
  assert.ok(!invocation.prompt.includes("OBSOLETE REVIEW"));
  assert.match(invocation.prompt, /revision: 0; lifetime attempts: 17/);
  task.status = "blocked";
  task.blocker = { reason: "contract conflict: downstream task owns the required wiring" };
  saveState(root, state);
  const recovery = autoRecoverBlockedTask(root, task.id, { maxRecoveries: 3 });
  assert.equal(recovery.kind, "contract-conflict");
  assert.equal(loadState(root).tasks[task.id].status, "blocked");
  const mismatch = await runInvocation({
    command: process.execPath,
    args: ["-e", "process.stdout.write('GapCode v0.test\\n--------\\nworkdir: test\\nsandbox: read-only\\n--------\\nuser\\n'); setTimeout(() => {}, 30000)", "--", "--sandbox", "workspace-write"],
    cwd: root,
  }, { logPath: path.join(root, "mismatch.log"), timeoutMs: 5000 });
  assert.match(mismatch.permissionMismatch, /effective read-only sandbox/);
  assert.equal(mismatch.timedOut, false, "policy mismatch fails before wasting the worker timeout");
  const normal = await runInvocation({
    command: process.execPath,
    args: ["-e", "process.stdout.write('GapCode v0.test\\n--------\\nsandbox: workspace-write\\n--------\\nuser\\nsandbox: read-only\\n')", "--", "--sandbox", "workspace-write"],
    cwd: root,
  }, { logPath: path.join(root, "normal.log"), timeoutMs: 5000 });
  assert.equal(normal.permissionMismatch, null, "prompt text cannot impersonate the startup policy");
  assert.equal(normal.code, 0);
  const namedMismatch = await runInvocation({
    command: process.execPath,
    args: ["-e", "process.stdout.write('GapCode v0.test\\nsandbox: read-only\\nuser\\n'); setTimeout(() => {}, 30000)", "--", "-c", 'default_permissions=":workspace"'],
    cwd: root,
  }, { logPath: path.join(root, "named-mismatch.log"), timeoutMs: 5000 });
  assert.match(namedMismatch.permissionMismatch, /effective read-only sandbox/, "named workspace profiles receive the same downgrade guard");
  const quota = await runInvocation({
    command: process.execPath,
    args: ["-e", "process.stderr.write(\"ERROR: You’ve hit your usage limit for GapCode. Switch to another model now, or try again later.\\n\"); process.exit(1)"],
    cwd: root,
  }, { logPath: path.join(root, "quota.log"), timeoutMs: 5000 });
  assert.equal(quota.providerFailure.kind, "provider-quota");
  task.blocker = { reason: quota.providerFailure.reason };
  saveState(root, state);
  assert.equal(autoRecoverBlockedTask(root, task.id, { maxRecoveries: 3 }).kind, "provider-quota", "quota failures are not blindly retried");
  task.status = "assigned";
  task.blocker = null;
  task.assigned_worker = "rowan";
  saveState(root, state);
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({
    providers: { default: "policyprobe", catalog: { policyprobe: {
      command: process.execPath,
      args: ["-e", "process.stdout.write('GapCode v0.test\\nsandbox: read-only\\nuser\\n'); setTimeout(() => {}, 30000)", "--", "--sandbox", "workspace-write"],
    } } },
  }));
  const run = await executeLaunchQueue(root, { taskIds: [task.id], confirm: true, maxSessions: 3, maxMinutes: 1, onProgress: () => {} });
  assert.equal(run.budget.sessions, 1, "a policy mismatch is never blindly retried");
  assert.equal(run.results[0].status, "blocked", "the result reflects the persisted containment status");
  assert.equal(run.results[0].blocker, "runtime_permission_mismatch");
  assert.match(run.reason, /effective read-only sandbox/, "failure is not summarized as queue completion");
  console.log("task dependency contract tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
