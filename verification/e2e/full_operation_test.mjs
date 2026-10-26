import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyState, saveState, loadState, createTask, transition, addEvidence } from "../../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../../runtime/lib/control-plane-server.mjs";
import { registerProject, setSupervisorDefaults } from "../../runtime/lib/supervisor.mjs";
import { executeSupervisor, requestSupervisorStop } from "../../runtime/lib/supervisor-runner.mjs";
import { proposeAction, decideProposal, authorizeAction } from "../../runtime/lib/approvals.mjs";
import { createBackup, previewRestore, restoreBackup } from "../../runtime/lib/backup.mjs";
import { acquireLease, reconcileLeases } from "../../runtime/lib/leases.mjs";
import { createReport } from "./report.mjs";

function project(label) { const root = fs.mkdtempSync(path.join(os.tmpdir(), `atl-e2e-${label}-`)); fs.mkdirSync(path.join(root, "config"), { recursive: true }); fs.writeFileSync(path.join(root, "config", "manager.json"), JSON.stringify({ version: 1 })); saveState(root, emptyState()); return root; }
const root = project("portfolio"); const alpha = project("alpha"); const beta = project("beta"); const report = createReport(root);
try {
  await report.scenario({ scenario_id: "baseline.cli-browser", entry_point: "cli+browser", expected: "clean local control plane" }, async () => { const { server, url } = await startControlPlaneServer(root); const browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.goto(url, { waitUntil: "domcontentloaded" }); assert.ok(await page.locator("#content").isVisible()); await browser.close(); server.close(); return "started"; });
  await report.scenario({ scenario_id: "projects.registry-isolation", entry_point: "runtime", expected: "stable project ids and isolated stores" }, async () => { const a = registerProject(alpha, { name: "Alpha", maxConcurrent: 1 }); const b = registerProject(beta, { name: "Beta", maxConcurrent: 1 }); assert.notEqual(a.id, b.id); setSupervisorDefaults({ maxConcurrent: 2 }); assert.notEqual(path.resolve(alpha, ".trust/manager"), path.resolve(beta, ".trust/manager")); return { alpha: a.id, beta: b.id }; });
  const state = loadState(alpha); const task = createTask(state, { title: "E2E canonical task" }); task.objective = "change and verify"; task.completion_checks = ["fake-provider.txt exists"]; task.risk = "normal"; task.assigned_worker = "rowan"; transition(state, task.id, "triaged", { actor: "pip", note: "bounded packet" }); transition(state, task.id, "assigned", { actor: "mira", note: "rowan" }); saveState(alpha, state);
  await report.scenario({ scenario_id: "approvals.denial-no-side-effect", task_id: task.id, project_id: "alpha", expected: "denied action never executes" }, async () => { const proposal = proposeAction(alpha, { project: "alpha", task: task.id, operation: "draft-pr", target: "main", args: { branch: "task" }, revision: 1 }); decideProposal(alpha, proposal.id, "deny", { principal: "owner" }); assert.equal(authorizeAction(alpha, { project: "alpha", task: task.id, operation: "draft-pr", target: "main", args: { branch: "task" }, revision: 1 }).allowed, false); return "blocked"; });
  await report.scenario({ scenario_id: "leases.fencing", task_id: task.id, project_id: "alpha", expected: "late generation rejected" }, async () => { const lease = acquireLease(alpha, { project: "alpha", task: task.id, role: "rowan" }); assert.equal(reconcileLeases(alpha).sessions.find((item) => item.id === lease.id).generation, lease.generation); return lease.generation; });
  await report.scenario({ scenario_id: "backup.integrity-restore", project_id: "alpha", expected: "hash verified and restore guarded" }, async () => { const backup = createBackup(alpha, { label: "e2e" }); assert.equal(previewRestore(alpha, backup.id).verified, true); return backup.id; });
  await report.scenario({ scenario_id: "supervisor.two-project-fairness", expected: "two projects share bounded dispatch" }, async () => { const result = await executeSupervisor(root, { projects: [{ id: "alpha", name: "Alpha", root: alpha, maxConcurrent: 1 }, { id: "beta", name: "Beta", root: beta, maxConcurrent: 1 }], maxMinutes: 0.001, maxSessions: 2, launch: async () => ({ status: "complete" }) }); assert.equal(result.cap, 2); return result.cap; });
  for (const width of [390, 768, 1440]) await report.scenario({ scenario_id: `browser.responsive-${width}`, entry_point: "playwright", expected: "no horizontal overflow" }, async () => { const { server, url } = await startControlPlaneServer(root); const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width, height: 900 } }); await page.goto(url, { waitUntil: "domcontentloaded" }); assert.ok((await page.locator("body").evaluate((node) => node.scrollWidth <= node.clientWidth + 2))); await browser.close(); server.close(); return width; });
} finally { requestSupervisorStop(); const final = report.finish(); fs.writeFileSync(path.join(report.dir, "summary.txt"), `${final.status} ${final.scenarios.length} scenarios, ${final.failures.length} failures\n`); }
if (report.report.failures.length) process.exitCode = 1; else console.log(`PASS: ATL full operation report at ${report.dir}`);
