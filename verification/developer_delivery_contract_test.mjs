import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emptyState, createTask, saveState, addEvidence } from "../runtime/lib/state.mjs";
import { snapshot } from "../runtime/lib/handoffs.mjs";
import { taskDeliveryReceipt, createDeliveryPacket, approveDraftPr } from "../runtime/lib/delivery.mjs";
import {
  buildDeliveryReceipt,
  evaluateDeliveryReceipt,
} from "../skills/atl/scripts/developer-delivery.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-delivery-contract-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atl-delivery-workspace-"));
const installed = fs.mkdtempSync(path.join(os.tmpdir(), "atl-delivery-installed-"));
const write = (dir, name, value) => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};

try {
  execFileSync("git", ["init", "-q"], { cwd: workspace, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: workspace });
  write(workspace, "src/app.js", "export const value = 1;\n");

  const state = emptyState();
  const task = createTask(state, { title: "Content-bound delivery" });
  task.workspace = workspace;
  task.objective = "Return one verified change";
  task.completion_checks = ["the behavior is observed"];
  task.packet_revision = 1;
  saveState(root, state);

  const original = snapshot(root, workspace);
  const loaded = { ...state, tasks: { [task.id]: task } };
  addEvidence(loaded, task.id, {
    kind: "review",
    result: "approve",
    detail: "Independent review of the final source",
    code_revision: original.revision,
  }, "sage");
  addEvidence(loaded, task.id, {
    kind: "check",
    check: "the behavior is observed",
    result: "pass",
    coverage: "complete",
    detail: "Observed the expected behavior",
    code_revision: original.revision,
    command: "node verification/behavior.mjs",
    exit_code: 0,
  }, "beacon");
  saveState(root, loaded);

  const portable = buildDeliveryReceipt({
    task: { id: task.id, source: { system: "azure-boards", id: "42", revision: 7 } },
    content: { files: original.files, modes: original.modes },
    checks: [{
      id: "the behavior is observed",
      result: "pass",
      coverage: "complete",
      content_revision: original.revision,
      command: "node verification/behavior.mjs",
      verified_by: "beacon",
    }],
    review: { result: "approve", content_revision: original.revision, reviewer: "sage", independent: true },
    host: { capabilities: { execution: true, independent_review: true, visual_observation: false, budget_enforcement: false } },
    usage: { coverage: "unknown" },
    claimed_verdict: "verified-local",
  });
  const portableVerdict = evaluateDeliveryReceipt(portable);
  const runtime = taskDeliveryReceipt(root, task.id);
  assert.equal(portableVerdict.status, "verified-local");
  assert.equal(runtime.verdict.status, portableVerdict.status);
  assert.equal(runtime.receipt.content.revision, portable.content.revision);

  const forged = structuredClone(portable);
  forged.checks[0].coverage = "partial";
  forged.claimed_verdict = "verified-local";
  assert.equal(evaluateDeliveryReceipt(forged).status, "incomplete", "a claimed pass cannot replace complete evidence");

  const missingReview = structuredClone(portable);
  missingReview.review = null;
  assert.equal(evaluateDeliveryReceipt(missingReview).status, "review-required");

  const blocked = structuredClone(portable);
  blocked.findings.push({ id: "F-1", severity: "major", status: "open", blocking: true });
  assert.equal(evaluateDeliveryReceipt(blocked).status, "blocked");

  write(workspace, "notes/untracked.txt", "dirty content\n");
  const changed = snapshot(root, workspace);
  assert.notEqual(changed.revision, original.revision);
  assert.equal(evaluateDeliveryReceipt(portable, { observedContentRevision: changed.revision }).status, "incomplete", "dirty or untracked changes must stale the receipt");

  const packetFile = path.join(root, ".trust", "manager", "delivery-packets.json");
  write(root, ".trust/manager/delivery-packets.json", `${JSON.stringify({
    version: 1,
    packets: [{ id: "DP-forged", task_id: task.id, code_revision: forged.content.revision, receipt: forged }],
    approvals: [],
  }, null, 2)}\n`);
  assert.throws(() => approveDraftPr(root, "DP-forged", { title: "forged" }), /verified-local/);
  assert.ok(fs.existsSync(packetFile));

  const missingState = emptyState();
  const missingTask = createTask(missingState, { title: "Missing evidence" });
  missingTask.workspace = workspace;
  missingTask.completion_checks = ["missing check"];
  saveState(root, missingState);
  assert.throws(() => createDeliveryPacket(root, missingTask.id, { receipt: portable }), /verified-local/);

  const generated = path.join(project, "skills", "atl-implement");
  const installedSkill = path.join(installed, ".agents", "skills", "atl-implement");
  fs.cpSync(generated, installedSkill, { recursive: true });
  const installedHelper = path.join(installedSkill, "scripts", "developer-delivery.mjs");
  assert.ok(fs.existsSync(installedHelper), "generated mode skill must bundle the delivery helper");
  assert.ok(fs.existsSync(path.join(installedSkill, "references", "developer-delivery.md")), "generated mode skill must bundle the delivery reference");
  write(installed, "receipt.json", `${JSON.stringify(portable, null, 2)}\n`);
  const cli = execFileSync(process.execPath, [installedHelper, "validate", "receipt.json"], { cwd: installed, encoding: "utf8" });
  assert.equal(JSON.parse(cli).status, "verified-local");
  assert.equal(fs.existsSync(path.join(installed, ".trust")), false, "portable validation must not require Control Plane state");

  console.log("PASS: runtime and portable delivery verdicts agree; stale content, forged evidence, missing review and bundled installation are covered");
} finally {
  for (const dir of [root, workspace, installed]) fs.rmSync(dir, { recursive: true, force: true });
}
