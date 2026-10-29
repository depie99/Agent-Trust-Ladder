import fs from "node:fs";
import path from "node:path";

const clean = (value) => String(value || "").replace(/sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+/gi, "[redacted]");
export function latestTaskEvidence(task, kind, check = null) {
  return [...(task.evidence || [])].reverse().find((entry) => entry.kind === kind && (!check || entry.check === check) && !entry.invalidated && (entry.packet_revision || 1) === (task.packet_revision || 1)) || null;
}

// Diagnose recorded facts, not a provider's successful exit code. Each finding
// names the missing postcondition; input readiness alone cannot satisfy it.
export function taskRecoveryReport(task, tasks = {}) {
  const review = latestTaskEvidence(task, "review");
  const checks = (task.completion_checks || []).map((check) => ({ check, evidence: latestTaskEvidence(task, "check", check) }));
  const text = [task.last_checkpoint?.note, review?.result === "changes-requested" ? review.detail : "", ...(task.evidence || []).filter((entry) => entry.kind === "note" && !entry.invalidated && (entry.packet_revision || 1) === (task.packet_revision || 1)).slice(-3).map((entry) => entry.detail)].filter(Boolean).join("\n");
  const renderedChecks = checks.filter(({ check }) => /rendered|browser|screenshot/i.test(check));
  const renderedOpen = !renderedChecks.length || renderedChecks.some(({ evidence }) => evidence?.result !== "pass" || evidence.coverage === "partial");
  const issues = [];
  const add = (cause, reason, nextAction, owner) => issues.push({ cause, reason, next_action: nextAction, owner });
  const blocker = task.recovery?.status !== "resolved" ? task.blocker : null;
  if (["local-dependencies", "local-dependencies-unavailable", "locked-dependencies"].includes(blocker?.cause)) add(blocker.cause, clean(blocker.reason), blocker.cause === "local-dependencies" ? "Check the workspace dependency receipt and workspaces.provisionLocal. Use the runtime's offline dependency preparation and recovery before starting another paid worker. It runs npm ci --offline --ignore-scripts and cannot claim completion checks passed." : "Inspect the exact lockfile/cache failure. Preserve the lockfile and dependency versions; report the missing package or authorization instead of retrying a model session.", blocker.recovery_owner || "mira");
  if (checks.some(({ evidence }) => evidence?.result === "fail")) add("verification-failed", "A current completion check failed.", "Run the exact failed check and capture fresh evidence; a passing readiness preflight is not a repair.", "rowan");
  if (renderedOpen && /rendered|browser|screenshot/i.test(text) && /not observed|unobserved|missing|unavailable|no (?:fresh|valid)/i.test(text)) add("rendered-evidence", "Required rendered evidence is missing or was rejected.", "Start the isolated UI preview, inspect the actual required surface, and save UTF-8 DOM observations and screenshots in .atl-evidence. Keep the check pending until observed.", "rowan");
  if (renderedOpen && /state\.json|\/api\/snapshot/i.test(text) && /500|missing|unavailable|no .*state\.json/i.test(text)) add("preview-environment", "The prior preview could not load its task state.", "Use an isolated preview fixture with task-workspace assets; do not initialize or copy production manager state into the workspace.", "rowan");
  if (review?.result === "changes-requested") add("review-changes", clean(review.detail), "Address each current review finding. Compare task edits with verified predecessor inputs and justify inherited changes before returning to independent review.", "rowan");
  if (/ownership conflict|contract conflict|downstream.*owns|T-\d+ owns/i.test(text)) add("contract-ownership", "Task history reports a check ownership conflict; the report is not permission to remove acceptance checks.", "Compare the current source with verified predecessor files. Restore missing required behavior in this task workspace, run the failing check, and record the predecessor defect for review. Request Pip only if the task metadata itself prevents that bounded repair.", "rowan");
  if (task.recovery?.status === "exhausted") add("repair-exhausted", "The current blocker has exhausted automatic repair attempts.", "Investigate and repair the cause in Ask ATL, then request explicit recovery with the new evidence. Do not increase task sessions or reset repair history as a remedy.", "manager");
  return {
    version: 1, task_id: task.id, packet_revision: task.packet_revision || 1,
    checkpoint: clean(task.last_checkpoint?.note),
    checks: checks.map(({ check, evidence }) => ({ check: clean(check), result: evidence?.result || "pending", coverage: evidence?.coverage || null, code_revision: evidence?.code_revision || null })),
    issues,
    neighbors: Object.values(tasks).filter((peer) => peer.id !== task.id && ((peer.plan_depends_on || []).includes(task.id) || (task.plan_depends_on || []).includes(peer.id))).slice(0, 20).map((peer) => ({ id: peer.id, status: peer.status, objective: clean(peer.objective), checks: (peer.completion_checks || []).map(clean) })),
    retry_ready: false,
    next_action: issues[0]?.next_action || "Inspect the latest worker log and checkpoint before choosing a repair. Do not repeat an unchanged launch.",
  };
}

export function stalledTaskFailure(before, after) {
  const added = (after?.evidence || []).slice((before?.evidence || []).length);
  const report = taskRecoveryReport(after || before);
  if (!added.length && before?.last_checkpoint?.at === after?.last_checkpoint?.at) return null;
  const issues = report.issues.filter((issue) => issue.cause !== "repair-exhausted");
  if (!issues.length) return null;
  return { cause: "verification-required", identity: "verification-required", recovery_owner: "rowan", reason: issues.map((issue) => `${issue.cause}: ${issue.reason}`).join("\n"), evidence: issues };
}

// Never trust a log path supplied by a worker. Read only bounded regular-file
// tails from the manager-owned task log directory, excluding symlinks.
export function taskLogTails(root, taskId) {
  if (!/^T-\d+$/.test(taskId)) return [];
  const project = fs.realpathSync(root);
  const directory = path.join(project, ".trust", "manager", "overnight", taskId);
  if (!fs.existsSync(directory)) return [];
  const canonical = fs.realpathSync(directory);
  if (!canonical.startsWith(project + path.sep)) return [];
  return fs.readdirSync(directory).filter((name) => /^session-[\w.-]+\.log$/.test(name)).map((name) => ({ name, file: path.join(directory, name), stat: fs.lstatSync(path.join(directory, name)) })).filter(({ stat }) => stat.isFile() && !stat.isSymbolicLink()).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || b.name.localeCompare(a.name)).slice(0, 2).map(({ name, file, stat }) => {
    const bytes = Buffer.alloc(Math.min(stat.size, 6000));
    const fd = fs.openSync(file, "r");
    try { const read = fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length)); return { name, truncated: stat.size > bytes.length, tail: clean(bytes.subarray(0, read).toString("utf8")) }; }
    finally { fs.closeSync(fd); }
  });
}
