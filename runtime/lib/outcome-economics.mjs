// Control Plane surface: identical decisions to the portable helper, with a
// thin adapter that maps recorded execution rows onto the shared contract.
export * from "../../skills/atl/scripts/outcome-economics.mjs";
import { executionRecords } from "./execution-report.mjs";
import { economicsReport, loadLedger } from "../../skills/atl/scripts/outcome-economics.mjs";

function attemptFromExecution(row) {
  const failed = row.exitCode !== 0 || row.timedOut || Boolean(row.failure);
  const status = failed ? "failed" : row.statusAfter === "done" ? "completed" : "running";
  return {
    attempt_id: row.id,
    task_id: row.taskId,
    status,
    accepted: status === "completed" && row.statusAfter === "done",
    tokens: row.tokens,
    wrapped: false,
    external: true,
    manual_intervention: false,
  };
}

export function outcomeReportFromRoot(root, { review = null } = {}) {
  const records = executionRecords(root).map(attemptFromExecution);
  return economicsReport({ ledger: loadLedger(root), records, expectedAttempts: records.length, review });
}

export { executionRecords };
