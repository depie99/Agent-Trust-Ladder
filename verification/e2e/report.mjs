import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createReport(root) {
  const dir = path.join(root, ".trust", "e2e-report"); fs.mkdirSync(dir, { recursive: true });
  const report = { version: 1, run_id: crypto.randomUUID(), started_at: new Date().toISOString(), scenarios: [], failures: [], artifacts: [], finished_at: null };
  const write = () => fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  write();
  return { report, dir, scenario(input, fn) { const started = Date.now(); const row = { scenario_id: input.scenario_id, starting_state: input.starting_state || "clean", entry_point: input.entry_point || "runtime", actor: input.actor || "owner", request_id: input.request_id || crypto.randomUUID(), task_id: input.task_id || null, project_id: input.project_id || null, packet_revision: input.packet_revision || null, code_revision: input.code_revision || null, expected: input.expected, rollback: input.rollback || "remove temporary fixture", status: "running", started_at: new Date().toISOString() }; return Promise.resolve().then(fn).then((observed) => { row.status = "pass"; row.observed = observed ?? true; row.duration_ms = Date.now() - started; report.scenarios.push(row); write(); return row; }).catch((error) => { row.status = "fail"; row.observed = error.message; row.error = { name: error.name, stack: error.stack }; row.duration_ms = Date.now() - started; report.scenarios.push(row); report.failures.push(row); write(); throw error; }); }, finish() { report.finished_at = new Date().toISOString(); report.status = report.failures.length ? "fail" : "pass"; write(); return report; } };
}
