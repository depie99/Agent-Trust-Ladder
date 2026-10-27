// Spec 014 — interactive task control room: acceptance A–E at the logic
// level, plus real CLI passes against a throwaway project. Nothing here
// starts a real provider session: dispatch containment is proven by a
// launch with the provider removed from PATH (acceptance D).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { emptyState, loadState, saveState, paths } from "../runtime/lib/state.mjs";
import { composeTask, importCandidates, normalizeDraftText } from "../runtime/lib/composer.mjs";
import { loadQueue, queueAdd, queueClear, queueIds, queueRemove } from "../runtime/lib/queue.mjs";
import { buildLaunchPlan, containmentBlock, executeLaunchQueue } from "../runtime/lib/launch.mjs";
import { discoverProvider, providerForRole, providerProfile } from "../runtime/lib/providers.mjs";
import { createDashboardSnapshot, renderDashboard } from "../runtime/lib/dashboard.mjs";

// The dashboard snapshot includes the full task portfolio and can exceed
// execFile's 1 MiB default buffer in a populated project. Keep the test
// bounded while allowing the child to flush and exit normally.
const run = (file, args, options = {}) => promisify(execFile)(file, args, {
  maxBuffer: 10 * 1024 * 1024,
  ...options,
});
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "runtime", "atl-manager.mjs");

// ---------- throwaway project scaffold

function newProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-control-room-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({
    version: 1,
    inbox_dir: ".trust/manager/inbox",
    providers: { default: "codex", auth: "subscription", by_role: { sage: "claude" } },
    intake: { file: { enabled: true }, github: { enabled: false }, azure: { enabled: false } },
  }, null, 2));
  saveState(root, emptyState());
  return root;
}

// ---------- A. natural-language task: draft + candidate + no agent

const rootA = newProject();
{
  const state = loadState(rootA);
  const text = "Fix the login redirect\nUsers land on /home after sign-in; they should land on /dashboard.\nChecks:\n- signed-in user lands on /dashboard\n@priority: high";
  const { task, created, draftPath } = composeTask(rootA, state, text, { source: "manual", cfg: {} });
  saveState(rootA, state);

  assert.equal(created, true, "A: first compose creates");
  assert.equal(task.status, "new", "A: candidate starts at new");
  assert.equal(task.title, "Fix the login redirect", "A: first line becomes the title");
  assert.deepEqual(task.completion_checks, ["signed-in user lands on /dashboard"], "A: Checks: bullets become checks");
  assert.equal(task.priority, "high", "A: @priority is honored");
  assert.match(task.intake_key, /^composer:[0-9a-f]{12}$/, "A: idempotency key by content");
  assert.ok(task.source.url && fs.existsSync(task.source.url), "A: task source points at the draft");
  assert.equal(task.source.url, draftPath, "A: compose returns the draft path");
  assert.match(fs.readFileSync(draftPath, "utf8"), /Fix the login redirect/, "A: draft keeps verbatim wording");
  assert.ok(fs.existsSync(path.join(rootA, ".trust", "manager", "feed.jsonl")), "A: composition narrates in the feed");
  assert.ok(!fs.existsSync(path.join(rootA, ".trust", "manager", "overnight")), "A: composing starts no provider session");

  // idempotency: same text again adds nothing
  const before = Object.keys(state.tasks).length;
  const again = composeTask(rootA, state, text, { source: "manual", cfg: {} });
  assert.equal(again.created, false, "A: identical text is idempotent");
  assert.equal(again.task.id, task.id, "A: identical text returns the same task");
  assert.equal(Object.keys(state.tasks).length, before, "A: no duplicate task");
}

// ---------- B. imported work: dedupe by source key, read-only apply

{
  const state = loadState(rootA);
  const candidates = [
    { title: "#7 broken sitemap", objective_hint: "the sitemap 404s", completion_checks: [], priority: "high", risk: "normal", labels: ["bug"], source: { type: "github", url: "https://github.com/x/y/issues/7" }, intake_key: "https://github.com/x/y/issues/7" },
    { title: "#7 broken sitemap (re-fetch)", objective_hint: "", completion_checks: [], priority: "normal", risk: "normal", labels: [], source: { type: "github", url: "https://github.com/x/y/issues/7" }, intake_key: "https://github.com/x/y/issues/7" },
    { title: "Task 42: polish header", objective_hint: "", completion_checks: [], priority: "low", risk: "normal", labels: [], source: { type: "azure", url: "https://azo/_workitems/edit/42" }, intake_key: "azure:p:42:1" },
  ];
  const { added, skipped } = importCandidates(rootA, state, candidates, { cfg: {} });
  assert.equal(added, 2, "B: dedupe by intake_key");
  assert.equal(skipped, 1, "B: re-fetched item is skipped, not duplicated");
  const gh = Object.values(state.tasks).find((t) => t.source.type === "github");
  assert.equal(gh.status, "new", "B: import lands at new for Pip");
  assert.equal(gh.intake_key, "https://github.com/x/y/issues/7", "B: provenance kept");
}

// ---------- normalizeDraftText grammar parity

{
  const cand = normalizeDraftText("Ship the release notes\nWrite them.\nChecks:\n- notes published\n@risk: risky");
  assert.equal(cand.risk, "risky", "grammar: @risk parsed");
  assert.deepEqual(cand.completion_checks, ["notes published"], "grammar: checks parsed");
  assert.throws(() => normalizeDraftText("   "), /needs some text/, "grammar: empty text rejected");
}

// ---------- C. human selection: persisted queue, order, focus independence

const rootC = newProject();
{
  const state = loadState(rootC);
  saveState(rootC, state); // seq stays 0; tasks created below via importCandidates
  const mk = (title) => {
    const { task } = composeTask(rootC, state, `${title}\nbody line`, { source: "manual", cfg: {} });
    return task;
  };
  const low = mk("Low priority chore");
  const high = mk("High priority fix");
  low.priority = "low";
  high.priority = "high";
  saveState(rootC, state);

  queueAdd(rootC, low.id, { by: "manager" });
  queueAdd(rootC, high.id, { by: "manager" });
  const dup = queueAdd(rootC, low.id, { by: "manager" });
  assert.equal(dup.added, false, "C: duplicate queue add is a no-op");
  assert.deepEqual(queueIds(rootC).sort(), [low.id, high.id].sort(), "C: membership persists in queue.json");
  assert.equal(loadQueue(rootC).items[0].added_by, "manager", "C: membership is auditable (added_by)");

  // execution order is priority-first (stored order is membership, not rank)
  const plan = buildLaunchPlan(rootC, { taskIds: queueIds(rootC), maxMinutes: 30, maxSessions: 4 });
  assert.deepEqual(plan.order, [high.id, low.id], "C: plan order is priority-then-id");
  assert.equal(plan.budget.maxMinutes, 30, "C: plan carries the budget");
  for (const item of plan.items) {
    assert.ok(item.role, "C: plan item names the role");
    assert.ok(item.provider && item.provider.worker, "C: plan item names the provider");
    assert.ok(item.containment.length >= 3, "C: plan item carries containment rules");
    assert.ok(item.sessionLogs.includes(item.taskId), "C: plan item names the session log path");
  }
  assert.match(plan.confirmCommand, /--confirm/, "C: preview prints the confirming command");

  // membership is visible in the dashboard and distinct from keyboard focus
  const snapshot = createDashboardSnapshot(rootC);
  assert.equal(snapshot.queue.length, 2, "C: snapshot exposes queue membership");
  const plain = renderDashboard(snapshot, { width: 120, height: 34, plain: true });
  assert.match(plain, /⌁/, "C: queued tasks carry the ⌁ badge");
  const focused = renderDashboard(snapshot, { width: 120, height: 34, plain: false, selected: 1 });
  assert.match(focused, /FOCUS 2\/2/, "C: focus is independent of membership");

  queueRemove(rootC, low.id);
  assert.deepEqual(queueIds(rootC), [high.id], "C: remove works");
  const cleared = queueClear(rootC);
  assert.equal(cleared.removed, 1, "C: clear empties the queue");
  assert.equal(queueIds(rootC).length, 0, "C: queue is empty after clear");
}

// ---------- D. provider failure containment

{
  const missing = discoverProvider("codex", { env: { PATH: "" } });
  assert.equal(missing.available, false, "D: discovery reports missing provider");
  assert.match(missing.error, /not found on PATH/, "D: actionable message");
  assert.match(missing.error, /Fix:/, "D: message includes the fix");

  const plan = buildLaunchPlan(rootC, {
    taskIds: queueIds(rootC),
    discover: (name) => ({ name, available: false, path: null, error: `provider "${name}" was not found on PATH. Fix: install it` }),
  });
  assert.equal(plan.blockedCount, plan.items.length, "D: plan marks every task blocked");
  assert.ok(plan.items.every((i) => i.blockers.some((b) => /not found on PATH/.test(b))), "D: blockers are actionable");

  // containment never violates the state contract: escalated is untouchable
  const state = loadState(rootC);
  const escalated = Object.values(state.tasks)[0];
  escalated.status = "escalated";
  assert.equal(containmentBlock(state, escalated.id, "x"), false, "D: containment respects the gate contract");
}

// ---------- E. bounded dispatch contracts (no real agent in CI)

{
  const empty = await executeLaunchQueue(rootC, {});
  assert.equal(empty.results.length, 0, "E: empty queue is a safe no-op");
  assert.match(empty.reason, /queue is empty/, "E: empty queue explains itself");

  const state = loadState(rootC);
  const someId = Object.keys(state.tasks)[0];
  queueAdd(rootC, someId, { by: "manager" });
  await assert.rejects(
    () => executeLaunchQueue(rootC, { confirm: false, dryRun: false }),
    /--confirm/,
    "E: execution refuses without --confirm"
  );
  const progress = [];
  const preview = await executeLaunchQueue(rootC, { dryRun: true, onProgress: (line) => progress.push(line) });
  assert.equal(preview.results.length, 1, "E: dry-run previews the queued task");
  assert.match(preview.results[0].reason, /dry-run preview/, "E: dry-run starts nothing");
  assert.ok(progress.some((line) => /session 1/.test(line)), "E: TUI-compatible launch progress is callback-driven");
  queueClear(rootC);
}

// ---------- provider profile resolution (OPEN-001)

{
  const profile = providerProfile({ providers: { default: "codex", auth: "subscription", by_role: { sage: "claude" } } });
  assert.equal(providerForRole(profile, "rowan").worker, "codex");
  assert.equal(providerForRole(profile, "rowan").auth, "subscription");
  assert.ok("model" in providerForRole(profile, "rowan"), "provider selection exposes the effective model");
  assert.deepEqual(providerForRole(profile, "sage"), { worker: "claude", auth: "subscription", model: null, source: "role-override" });
}

// ---------- real CLI pass: init → compose → queue → dry-run → blocked confirm

const rootCLI = newProject();
fs.rmSync(path.join(rootCLI, ".trust"), { recursive: true, force: true }); // exercise `init`
{
  const env = { ...process.env, ATL_PROJECT: rootCLI };
  await run(process.execPath, [CLI, "init"], { env });
  assert.ok(fs.existsSync(paths(rootCLI).state), "CLI: init creates state");

  const setProvider = await run(process.execPath, [CLI, "provider", "set", "--provider", "codex", "--model", "gpt-5.6-terra"], { env });
  assert.match(setProvider.stdout, /Saved default selection: codex · gpt-5\.6-terra/, "CLI: provider/model selection is persisted");
  const configured = JSON.parse(fs.readFileSync(path.join(rootCLI, "config", "manager.json"), "utf8"));
  assert.equal(configured.providers.model, "gpt-5.6-terra", "CLI: selected model is written to manager config");
  const setRoleProvider = await run(process.execPath, [CLI, "provider", "set", "--role", "sage", "--provider", "claude", "--model", "claude-sonnet"], { env });
  assert.match(setRoleProvider.stdout, /Saved sage role selection: claude · claude-sonnet/, "CLI: per-role provider/model selection is persisted");

  const compose = await run(process.execPath, [CLI, "compose", "--title", "Write the onboarding doc", "Explain the first sprint.", "--check", "doc exists in docs/"], { env });
  assert.match(compose.stdout, /\+ T-001 \[new\] \(composer\) Write the onboarding doc\n/, "CLI: compose creates the candidate with the structured title");
  assert.match(compose.stdout, /draft:/, "CLI: compose names the immutable draft");
  const packet = loadState(rootCLI).tasks["T-001"];
  assert.deepEqual(packet.completion_checks, ["doc exists in docs/"], "CLI: --check flags become completion checks");
  assert.equal(packet.priority, "normal", "CLI: default priority");

  const dup = await run(process.execPath, [CLI, "compose", "--title", "Write the onboarding doc", "Explain the first sprint.", "--check", "doc exists in docs/"], { env });
  assert.match(dup.stdout, /Already composed: T-001/, "CLI: compose is idempotent");

  // non-interactive dashboard snapshot renders with the new furniture
  const ui = await run(process.execPath, [CLI, "ui", "--once", "--plain"], { env });
  assert.match(ui.stdout, /CONTROL ROOM/, "CLI: ui renders");

  const qadd = await run(process.execPath, [CLI, "queue", "add", "T-001"], { env });
  assert.match(qadd.stdout, /queued for execution/, "CLI: queue add");
  const qlist = await run(process.execPath, [CLI, "queue", "list"], { env });
  assert.match(qlist.stdout, /T-001/, "CLI: queue list shows the task");
  assert.match(qlist.stdout, /Launch plan/, "CLI: queue list renders the plan");

  const prov = await run(process.execPath, [CLI, "providers"], { env });
  assert.match(prov.stdout, /Per-role mapping/, "CLI: providers prints the mapping");
  assert.match(prov.stdout, /sage/, "CLI: providers prints the sage override");
  assert.match(prov.stdout, /gpt-5\.6-terra/, "CLI: providers prints the selected default model");
  assert.match(prov.stdout, /claude · claude-sonnet/, "CLI: providers prints the selected per-role model");

  await assert.rejects(
    () => run(process.execPath, [CLI, "launch"], { env }),
    /--confirm/,
    "CLI: launch refuses without --confirm"
  );

  const dry = await run(process.execPath, [CLI, "launch", "--dry-run"], { env });
  assert.match(dry.stdout, /dry-run: no agent started/, "CLI: dry-run starts nothing");
  assert.match(dry.stdout, /new → pip/, "CLI: dry-run preview names the role");

  // acceptance D end-to-end: with no provider on PATH, a confirmed launch
  // starts no agent, blocks the task with the actionable reason, and the
  // task never reaches in_progress.
  const strippedEnv = { ...env, PATH: "", Path: "" };
  const confirmed = await run(process.execPath, [CLI, "launch", "--confirm", "--max-minutes", "1"], { env: strippedEnv });
  assert.match(confirmed.stdout, /BLOCKED: /, "D: confirmed launch reports the blocker up front");
  const after = loadState(rootCLI).tasks["T-001"];
  assert.equal(after.status, "blocked", "D: task is containment-blocked");
  assert.match(after.blocker.reason, /not found on PATH/, "D: blocker carries the fix");
  assert.notEqual(after.status, "in_progress", "D: task never entered in_progress");
  assert.ok(!fs.existsSync(path.join(rootCLI, ".trust", "manager", "overnight", "T-001")), "D: no session directory was created");

  const validate = await run(process.execPath, [CLI, "validate"], { env });
  assert.match(validate.stdout, /State OK/, "CLI: validate passes with the queue present");

  // queue referencing an unknown task must fail validation
  const qfile = path.join(rootCLI, ".trust", "manager", "queue.json");
  const q = JSON.parse(fs.readFileSync(qfile, "utf8"));
  q.items.push({ id: "T-999", added_at: new Date().toISOString(), added_by: "manager" });
  fs.writeFileSync(qfile, JSON.stringify(q, null, 2));
  await assert.rejects(
    () => run(process.execPath, [CLI, "validate"], { env }),
    /queue references unknown task/,
    "CLI: validate catches dangling queue entries"
  );
}

for (const dir of [rootA, rootC, rootCLI]) fs.rmSync(dir, { recursive: true, force: true });
console.log("PASS: control room — compose/drafts/idempotency, import dedupe, persistent queue, launch plan, provider containment (A–E)");
