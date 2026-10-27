import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { emptyState, createTask, saveState, loadState, addEvidence } from "../runtime/lib/state.mjs";
import { ensureWorkspace } from "../runtime/lib/workspace.mjs";
import { snapshot, startBaseline, recordHandoff, prepareInputs, readHandoff, deliveryGate } from "../runtime/lib/handoffs.mjs";
import { dispatchPreflight } from "../runtime/lib/dispatch-preflight.mjs";
import { recordBlocker, repairBlocker, repairContract, validateContracts } from "../runtime/lib/queue-recovery.mjs";
import { queueAdd, queueInspect } from "../runtime/lib/queue.mjs";
import { executeLaunchQueue, readOvernightRun, reconcileOvernightRun } from "../runtime/lib/launch.mjs";
import { listDeliveryPackets } from "../runtime/lib/delivery.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-owned-recovery-"));
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
try {
  git(["init", "-q"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  write("client.html", '<button id="old">Original</button>');
  write(".gitignore", ".trust/\nnode_modules/\n.atl-*\n");
  // A locked local package can be provisioned even with no registry/network.
  const packageRoot = { name: "offline-queue-fixture", version: "1.0.0", dependencies: { "fixture-local": "file:vendor/local" } };
  write("package.json", JSON.stringify(packageRoot));
  write("vendor/local/package.json", JSON.stringify({ name: "fixture-local", version: "1.0.0" }));
  write("package-lock.json", JSON.stringify({ name: packageRoot.name, version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": packageRoot, "node_modules/fixture-local": { resolved: "vendor/local", link: true }, "vendor/local": { name: "fixture-local", version: "1.0.0" } } }));
  git(["add", "."]); git(["commit", "-qm", "baseline"]);
  const main = git(["rev-parse", "HEAD"]);
  const state = emptyState();
  const a = createTask(state, { title: "Catalog", objective: "Provide the catalog and preserve the original client", completion_checks: ["catalog and original client work"] });
  const b = createTask(state, { title: "Client", objective: "Compose catalog search and client filtering", completion_checks: ["search and filter work"] });
  a.objective = "Provide the catalog and preserve the original client"; a.completion_checks = ["catalog and original client work"];
  b.objective = "Compose catalog search and client filtering"; b.completion_checks = ["search and filter work"];
  const independent = createTask(state, { title: "Independent work", labels: ["independent"] }); independent.objective = "Preserve independent output"; independent.completion_checks = ["independent output preserved"];
  a.priority = "high";
  for (const task of [a, b, independent]) { task.status = "assigned"; task.assigned_worker = "rowan"; task.review_required = true; task.workspace = ensureWorkspace(root, {}, task).dir; }
  // Downstream already exists before A publishes, with independent client edits.
  fs.writeFileSync(path.join(b.workspace, "client.html"), '<button id="old">Original</button><button id="filter">Filter</button>');
  b.plan_depends_on = [a.id, independent.id]; b.integrated_delivery = true; b.integrated_checks = [...a.completion_checks, ...b.completion_checks, ...independent.completion_checks];
  b.dispatch_contract = { artifacts: ["catalog.json"], commands: [[process.execPath, "-e", "require('node:fs').accessSync('products.json')"]] };
  saveState(root, state);
  const fixture = fileURLToPath(new URL("./fixtures/queue-recovery-worker.mjs", import.meta.url));
  write("config/manager.json", JSON.stringify({ workspaces: { provisionLocal: true }, providers: { default: "fixture", catalog: { fixture: { command: process.execPath, args: [fixture, "{root}", "{task}", "{role}"] } } } }));
  queueAdd(root, b.id); queueAdd(root, a.id); queueAdd(root, independent.id);
  const run = await executeLaunchQueue(root, { confirm: true, maxSessions: 8, maxMinutes: 2, onProgress: () => {} });
  const after = loadState(root);
  if (after.tasks[a.id].status !== "done" || after.tasks[b.id].status !== "done") {
    console.error(JSON.stringify(after.tasks[b.id], null, 2));
    for (const file of fs.readdirSync(path.join(root, ".trust/manager/overnight"), { recursive: true }).filter((name) => name.endsWith(".log"))) console.error(fs.readFileSync(path.join(root, ".trust/manager/overnight", file), "utf8"));
  }
  assert.equal(after.tasks[a.id].status, "done", JSON.stringify(run.results));
  assert.equal(after.tasks[b.id].status, "done", JSON.stringify(run.results));
  assert.equal(after.tasks[independent.id].status, "done");
  assert.ok(run.results.findIndex((entry) => entry.id === independent.id && entry.status === "done") < run.results.findIndex((entry) => entry.id === a.id && entry.status === "done"), "independent work continued while A was recovering");
  assert.ok(after.tasks[b.id].pip_repair, "changed verifier assumptions repaired by Pip without chat");
  assert.ok(after.tasks[a.id].pip_repair, "conflicting stage ownership repaired by Pip without chat");
  assert.ok(fs.existsSync(path.join(after.tasks[b.id].workspace, "node_modules/fixture-local/package.json")), "runtime provisioned the locked local package offline");
  assert.equal(after.tasks[b.id].integration_inputs.status, "composed");
  assert.ok(after.tasks[b.id].input_revisions[a.id]);
  const delivery = readOvernightRun(root).delivery;
  assert.equal(delivery.ready, true); assert.equal(delivery.browser, true);
  assert.equal(git(["rev-parse", "HEAD"]), main, "active branch untouched");
  assert.match(git(["show", `${delivery.branch}:client.html`]), /id="filter"/);
  assert.match(git(["show", `${delivery.branch}:client.html`]), /id="old"/);
  assert.equal(git(["show", `${delivery.branch}:independent.txt`]), "independent output preserved");
  assert.equal(readOvernightRun(root).status, "completed");
  fs.rmSync(path.join(root, ".trust/manager/handoffs", `${a.id}.json`));
  const restartedHandoff = await executeLaunchQueue(root, { confirm: true, maxSessions: 8, maxMinutes: 2, onProgress: () => {} });
  assert.equal(restartedHandoff.status, "completed"); assert.equal(restartedHandoff.budget.sessions, 0, "handoff restart did not relaunch completed providers");
  assert.equal(listDeliveryPackets(root).filter((packet) => packet.integrated).length, 1, "delivery replay is idempotent in existing packet storage");
  Object.assign(after, loadState(root));
  console.log("PASS: stale workspace, missing catalog, verifier repair, overlapping edits, preserved predecessor journey and verified delivery branch without chat");

  // Replay the preparation journal after an interrupted handoff.
  const c = { id: "T-REPLAY", status: "assigned", workspace: ensureWorkspace(root, {}, { id: "T-REPLAY", title: "Replay" }).dir, plan_depends_on: [a.id] };
  const journal = path.join(root, ".trust/manager/handoffs/T-REPLAY.preparation.json");
  assert.equal(prepareInputs(root, c, after.tasks).ready, true);
  fs.writeFileSync(journal, JSON.stringify({ version: 1, status: "preparing" }));
  assert.equal(prepareInputs(root, c, after.tasks).ready, true);
  assert.equal(JSON.parse(fs.readFileSync(journal)).status, "prepared");
  assert.equal(fs.readFileSync(path.join(c.workspace, "catalog.json"), "utf8"), '["Apple","Pear"]');
  const record = readHandoff(root, after.tasks[a.id]);
  const blob = path.join(root, ".trust/manager/handoffs/blobs", record.output.files["catalog.json"]);
  const original = fs.readFileSync(blob); fs.writeFileSync(blob, "corrupt");
  assert.throws(() => readHandoff(root, after.tasks[a.id]), /corrupt/); fs.writeFileSync(blob, original);

  // Contract approval rejects cycles and downstream ownership before a session.
  assert.throws(() => validateContracts({ a: { id: "a", depends_on: ["b"] }, b: { id: "b", depends_on: ["a"] } }), /cycle/);
  assert.throws(() => validateContracts({ a: { id: "a", check_owners: { check: "b" } }, b: { id: "b", depends_on: ["a"] } }), /downstream/);
  assert.throws(() => repairContract(root, a.id, {}, { objective: a.objective, budgetApproved: true, evidence: "test" }), /unused repair allowance/);
  const contractState = loadState(root); const contractTask = createTask(contractState, { title: "Immutable acceptance" });
  contractTask.objective = "Preserve acceptance"; contractTask.completion_checks = ["immutable check"]; saveState(root, contractState);
  assert.throws(() => repairContract(root, contractTask.id, { completion_checks: [] }, { objective: contractTask.objective, budgetApproved: true, evidence: "test" }), /weaken/);
  let ownerState = loadState(root); const ownerTask = ownerState.tasks[contractTask.id]; ownerTask.status = "blocked"; ownerTask.assigned_worker = "rowan";
  recordBlocker(ownerTask, { cause: "owner-access", reason: "owner credentials required", recovery_owner: "owner" }); saveState(root, ownerState);
  const ownerRun = await executeLaunchQueue(root, { confirm: true, taskIds: [ownerTask.id], onProgress: () => {} });
  assert.equal(ownerRun.status, "owner-blocked"); assert.equal(ownerRun.budget.sessions, 0); assert.match(ownerRun.reason, /owner credentials/);
  const revisionState = loadState(root);
  const repairSource = createTask(revisionState, { title: "Repair source" }); repairSource.objective = "Keep approved behavior"; repairSource.completion_checks = ["approved behavior"];
  const settledConsumer = createTask(revisionState, { title: "Revalidate completed consumer" }); settledConsumer.status = "done"; settledConsumer.plan_depends_on = [repairSource.id]; settledConsumer.evidence = [{ kind: "check", result: "pass", packet_revision: 1 }]; settledConsumer.execution_budget = { used: 2, max_sessions: 4 }; saveState(root, revisionState);
  repairContract(root, repairSource.id, { check_owners: { "approved behavior": repairSource.id } }, { objective: repairSource.objective, budgetApproved: true, evidence: "Corrected the stage ownership using observed contract evidence" });
  const invalidated = loadState(root).tasks[settledConsumer.id];
  assert.equal(invalidated.status, "assigned", "completed consumers re-enter the queue when their input evidence is invalidated"); assert.equal(invalidated.evidence[0].invalidated, true); assert.equal(invalidated.execution_budget.used, 2, "contract revisions cannot reset consumed execution allowances");
  assert.throws(() => addEvidence(after, a.id, { kind: "check", check: a.completion_checks[0], result: "pass", coverage: "partial" }, "beacon"), /partial/);
  const integrated = after.tasks[b.id];
  integrated.evidence = integrated.evidence.filter((e) => e.kind !== "browser-journey");
  assert.equal(deliveryGate(root, Object.values(after.tasks), integrated).ready, false, "partial suite cannot imply a complete browser journey");

  // Two distinct remedies persist across reload and cannot reset on recurrence.
  const recoveryState = loadState(root); const r = recoveryState.tasks[a.id];
  recordBlocker(r, { cause: "catalog", reason: "catalog still unavailable", evidence: ["ENOENT catalog.json"] }); saveState(root, recoveryState);
  for (const action of ["restore-verified-output", "rebuild-local-catalog"]) {
    const result = await repairBlocker(root, a.id, { action, remedy: () => ({ observed: action }), preflight: () => ({ ready: false, reason: "catalog still unavailable" }) });
    assert.equal(result.recovered, false);
  }
  let reloaded = loadState(root); recordBlocker(reloaded.tasks[a.id], { cause: "catalog", reason: "catalog still unavailable" }); saveState(root, reloaded);
  assert.equal((await repairBlocker(root, a.id, { action: "third", remedy: () => assert.fail("third remedy ran"), preflight: () => ({ ready: true }) })).kind, "exhausted");
  const exhaustedState = loadState(root); exhaustedState.tasks[a.id].status = "blocked"; saveState(root, exhaustedState);
  const exhaustedRun = await executeLaunchQueue(root, { confirm: true, taskIds: [a.id], onProgress: () => {} });
  assert.equal(exhaustedRun.status, "exhausted"); assert.equal(exhaustedRun.budget.sessions, 0, "a new confirmed run cannot reset repair exhaustion");
  queueAdd(root, a.id);
  assert.equal(queueInspect(root).tasks.find((task) => task.id === a.id).attempts_remaining, 0);
  reloaded = loadState(root); recordBlocker(reloaded.tasks[a.id], { cause: "credentials", reason: "owner credentials required", recovery_owner: "owner" }); saveState(root, reloaded);
  assert.equal((await repairBlocker(root, a.id, { action: "escalate", remedy: () => assert.fail("owner blocker retried") })).kind, "owner-blocked");
  // A process died after its remedy, before persisting the preflight result.
  reloaded = loadState(root); const interruptedTask = reloaded.tasks[a.id];
  const pendingRepair = recordBlocker(interruptedTask, { cause: "restart", reason: "remedy finished before restart" });
  pendingRepair.attempts.push({ action: "restore-input", status: "repairing" }); pendingRepair.status = "repairing";
  saveState(root, reloaded);
  const resumed = await repairBlocker(root, a.id, { action: "restore-input", remedy: () => assert.fail("interrupted remedy repeated"), preflight: () => ({ ready: true }) });
  assert.equal(resumed.recovered, true); assert.equal(resumed.resumed, true);
  assert.equal(loadState(root).tasks[a.id].recovery.attempts.length, 1, "restart did not replenish or consume an extra attempt");

  // No package network: offline cache failures are precise owner capabilities,
  // not repeated paid launches or credential/network escalation.
  const dep = { id: "T-DEPS", workspace: c.workspace, dispatch_contract: {} };
  fs.writeFileSync(path.join(c.workspace, "package.json"), JSON.stringify({ dependencies: { "not-in-local-cache": "1.0.0" } }));
  fs.rmSync(path.join(c.workspace, "package-lock.json"));
  let result = dispatchPreflight(root, dep, {}); assert.equal(result.cause, "locked-dependencies");
  fs.writeFileSync(path.join(c.workspace, "package-lock.json"), '{"lockfileVersion":3}');
  let calls = 0;
  result = dispatchPreflight(root, dep, {}, { provisionLocal: true, execute: (command, args) => { calls++; assert.match(args.join(" "), /--offline/); assert.match(args.join(" "), /--ignore-scripts/); return { status: 1, stderr: "ENOTCACHED: network unavailable" }; } });
  assert.equal(calls, 1); assert.equal(result.recovery_owner, "owner"); assert.match(result.reason, /local cache; network is not authorized/);
  result = dispatchPreflight(root, dep, {}, { providerReady: false, execute: () => assert.fail("unavailable provider launched command") });
  assert.equal(result.cause, "provider-unavailable");

  // A restart during preparation/recovery is safe to resume; an in-flight
  // provider remains explicitly excluded because its side effects are unknown.
  const runFile = path.join(root, ".trust/manager/overnight/run.json");
  for (const phase of ["preparation", "handoff", "recovery"]) {
    fs.writeFileSync(runFile, JSON.stringify({ status: "running", runnerPid: 4000000000, taskOrder: [a.id, b.id], cursor: 0, currentTaskId: a.id, phase }));
    assert.deepEqual(reconcileOvernightRun(root).resumableTaskIds, [a.id, b.id]);
  }
  console.log("PASS: restart replay, hash tampering, contract ownership/cycles, evidence completeness, persistent repair exhaustion and owner-only capabilities");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
