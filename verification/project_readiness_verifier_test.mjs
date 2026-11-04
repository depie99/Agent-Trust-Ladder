import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyState, createTask, saveState } from "../runtime/lib/state.mjs";
import { dispatchPreflight } from "../runtime/lib/dispatch-preflight.mjs";
import {
  checkProjectReadiness,
  cleanupOwned,
  runProjectVerifier,
} from "../skills/atl/scripts/project-verifier.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(project, "verification", "fixtures", "project-verifier");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-verifier-manager-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atl-verifier-project-"));
const write = (dir, name, value) => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
const readManifest = () => JSON.parse(fs.readFileSync(path.join(workspace, ".atl-verifier.json"), "utf8"));

try {
  write(workspace, "src/value.txt", "broken\n");
  write(workspace, "verification/accept.mjs", fs.readFileSync(path.join(fixture, "accept.mjs")));
  write(workspace, "verification/readback.mjs", fs.readFileSync(path.join(fixture, "readback.mjs")));
  write(workspace, ".atl-verifier.json", fs.readFileSync(path.join(fixture, ".atl-verifier.json")));

  const manifest = readManifest();
  const brokenReadiness = checkProjectReadiness(manifest, workspace);
  assert.equal(brokenReadiness.ready, true, "an expected red acceptance behavior is not a baseline failure");
  const broken = runProjectVerifier(manifest, workspace);
  assert.equal(broken.result, "fail");
  assert.equal(broken.evidence.checks[0].result, "fail");
  assert.ok(fs.existsSync(path.join(workspace, ".atl-evidence", "project-verifier.json")));
  assert.equal(broken.evidence.checks[0].observation.command[0], "node");

  write(workspace, "src/value.txt", "ok\n");
  const fixed = runProjectVerifier(manifest, workspace);
  assert.equal(fixed.result, "pass");
  assert.equal(fixed.evidence.checks[0].readback.exit_code, 0);
  assert.match(fixed.evidence.content.revision, /^[a-f0-9]{64}$/);
  assert.ok(fixed.evidence.checks[0].artifact_paths === undefined);

  const state = emptyState();
  const task = createTask(state, { title: "Project readiness" });
  task.workspace = workspace;
  task.objective = "Repair the fixture behavior";
  task.completion_checks = ["value is fixed and persisted"];
  saveState(root, state);
  const runtimeReady = dispatchPreflight(root, task, state.tasks);
  assert.equal(runtimeReady.ready, true);
  assert.equal(task.dispatch_preflight.verifier.id, "fixture-value");

  const missingTool = structuredClone(manifest);
  missingTool.tools = ["atl-tool-that-does-not-exist"];
  const missingToolPortable = checkProjectReadiness(missingTool, workspace);
  assert.equal(missingToolPortable.cause, "tool-unavailable");

  const missingAuth = structuredClone(manifest);
  missingAuth.auth = { environment: ["ATL_MISSING_FIXTURE_AUTH"] };
  const missingAuthPortable = checkProjectReadiness(missingAuth, workspace);
  write(workspace, ".atl-verifier.json", `${JSON.stringify(missingAuth, null, 2)}\n`);
  const missingAuthRuntime = dispatchPreflight(root, task, state.tasks);
  assert.equal(missingAuthPortable.cause, "authorization-unavailable");
  assert.equal(missingAuthRuntime.cause, missingAuthPortable.cause);
  assert.equal(missingAuthRuntime.reason, missingAuthPortable.reason);
  assert.ok(!missingAuthRuntime.reason.includes("ATL_MISSING_FIXTURE_AUTH="), "credential values must never appear in readiness output");

  write(workspace, "package.json", "{}\n");
  const missingLock = structuredClone(manifest);
  missingLock.requiresLockfile = true;
  assert.equal(checkProjectReadiness(missingLock, workspace).cause, "locked-dependencies");

  const baselineFailure = structuredClone(manifest);
  baselineFailure.baseline = { commands: [[process.execPath, "-e", "process.exit(7)"]] };
  assert.equal(checkProjectReadiness(baselineFailure, workspace).cause, "baseline-failure");

  const missingCapability = structuredClone(manifest);
  missingCapability.capabilities = { visual_observation: true };
  assert.equal(checkProjectReadiness(missingCapability, workspace, { capabilities: {} }).cause, "capability-unavailable");

  const owned = path.join(workspace, ".atl-evidence", "owned");
  const unrelated = path.join(workspace, "unrelated-user-file.txt");
  fs.mkdirSync(owned, { recursive: true });
  write(workspace, ".atl-evidence/owned/temp.txt", "temporary\n");
  write(workspace, "unrelated-user-file.txt", "keep\n");
  assert.deepEqual(cleanupOwned(workspace, [".atl-evidence/owned"]), [".atl-evidence/owned"]);
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.readFileSync(unrelated, "utf8"), "keep\n");
  assert.throws(() => cleanupOwned(workspace, [".."]), /unsafe project path/);

  const generated = path.join(project, "skills", "atl-verify");
  assert.ok(fs.existsSync(path.join(generated, "scripts", "project-verifier.mjs")), "generated mode skill must bundle the project verifier helper");
  assert.ok(fs.existsSync(path.join(generated, "references", "project-verifier.md")), "generated mode skill must bundle the project verifier reference");

  console.log("PASS: project readiness separates baseline from acceptance, verifies broken/fixed behavior, classifies blockers and cleans only owned data in runtime and portable paths");
} finally {
  for (const dir of [root, workspace]) fs.rmSync(dir, { recursive: true, force: true });
}
