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
  if (["local-dependencies", "local-dependencies-unavailable", "locked-dependencies"].includes(blocker?.cause)) add(blocker.cause, clean(blocker.reason), blocker.cause === "local-dependencies" ? "Check the workspace dependency receipt and workspaces.provisionLocal. Use the runtime's offline dependency preparation and recovery before starting another paid worker. It runs the repository's own package manager against its lockfile (npm ci, yarn/pnpm/bun install — always offline and frozen, scripts skipped) and cannot claim completion checks passed." : "Inspect the exact lockfile/cache failure. Preserve the lockfile and dependency versions; report the missing package or authorization instead of retrying a model session.", blocker.recovery_owner || "mira");
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

function suggestedModel(reason) {
  const match = String(reason || "").match(/(?:for a Codex ChatGPT sign-in:\s*)([A-Za-z0-9._-]+)/i)
    || String(reason || "").match(/\b(gpt-[A-Za-z0-9._-]+)\b/i);
  return match ? match[1] : null;
}

const PINNED_INSTALL = {
  codex: { package: "@openai/codex@0.169.0", command: "npm install --global @openai/codex@0.169.0" },
  claude: { package: "@anthropic-ai/claude-code@2.1.326", command: "npm install --global @anthropic-ai/claude-code@2.1.326" },
};

export function providerFailureGuidance(failure, context = {}) {
  const reason = clean(failure?.reason || "The provider failed before the task could advance.");
  const kind = failure?.kind || "provider-unavailable";
  const provider = context.provider || null;
  const nextActions = [];
  if (kind === "provider-model-unavailable") {
    const action = { kind: "provider-model", label: "Use a supported model", instruction: reason };
    const model = suggestedModel(reason) || context.model;
    if (model) action.model = model;
    if (provider) action.provider = provider;
    nextActions.push(action);
  }
  if (PINNED_INSTALL[provider]) {
    nextActions.push({ kind: "provider-install", label: "Update provider CLI", instruction: `Run the pinned ${provider} CLI installer, or choose a model it supports, then inspect the task again.`, provider, command: PINNED_INSTALL[provider].command });
  }
  return {
    detail: reason,
    next_actions: nextActions,
    evidence: [{ kind: "provider-failure", cause: kind, detail: reason, provider: context.provider || null, model: context.model || null }],
  };
}

export function packageFailureGuidance(reason, workspace = null) {
  const detail = clean(reason || "Locked dependencies are not prepared in the task workspace.");
  const managers = [
    { lock: "package-lock.json", command: "npm ci --offline --ignore-scripts --no-audit --no-fund" },
    { lock: "yarn.lock", command: "yarn install --frozen-lockfile --ignore-scripts" },
    { lock: "pnpm-lock.yaml", command: "pnpm install --frozen-lockfile --ignore-scripts" },
    { lock: "bun.lockb", command: "bun install --frozen-lockfile --offline --ignore-scripts" },
    { lock: "bun.lock", command: "bun install --frozen-lockfile --offline --ignore-scripts" },
  ];
  let selected = managers[0];
  if (workspace) for (const manager of managers) if (fs.existsSync(path.join(workspace, manager.lock))) { selected = manager; break; }
  return {
    detail,
    next_actions: [{ kind: "package-install", label: "Install / repair dependencies", instruction: `Run ${selected.command} in the task workspace. It uses only the local lockfile and cache; network and lifecycle scripts are not authorized.`, command: selected.command, workspace: workspace || null }],
    evidence: [{ kind: "package-failure", detail }],
  };
}

function taskSessionRecords(root, taskId) {
  if (!/^T-\d+$/.test(taskId)) return [];
  const project = fs.realpathSync(root);
  const directory = path.join(project, ".trust", "manager", "overnight", taskId);
  if (!fs.existsSync(directory)) return [];
  const canonical = fs.realpathSync(directory);
  if (!canonical.startsWith(project + path.sep)) return [];
  return fs.readdirSync(directory).filter((name) => /^session-[\w.-]+\.json$/.test(name)).map((name) => ({ name, file: path.join(directory, name), stat: fs.lstatSync(path.join(directory, name)) }))
    .filter(({ stat }) => stat.isFile() && !stat.isSymbolicLink()).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || b.name.localeCompare(a.name)).flatMap(({ name, file }) => {
      try { return [{ name, file, record: JSON.parse(fs.readFileSync(file, "utf8")) }]; } catch { return []; }
    });
}

// Turn the facts already written by the worker into a durable diagnosis. This
// never trusts worker-supplied paths and redacts secrets before persisting.
export function workerStallFailure(root, taskId, log = "", status = null) {
  const session = taskSessionRecords(root, taskId)[0];
  if (session?.record?.providerFailure) {
    const guidance = providerFailureGuidance(session.record.providerFailure, { provider: session.record.provider || null, model: session.record.model || null });
    const logFile = path.join(path.dirname(session.file), session.name.replace(/\.json$/, ".log"));
    return {
      cause: session.record.providerFailure.kind || "provider-unavailable",
      identity: `${session.record.providerFailure.kind || "provider-unavailable"}:${session.record.model || ""}`,
      reason: guidance.detail,
      recovery_owner: "owner",
      detail: guidance.detail,
      next_actions: guidance.next_actions,
      evidence: [...guidance.evidence, { kind: "session", name: session.name, status_before: clean(session.record.statusBefore), status_after: clean(session.record.statusAfter) }],
      log_path: fs.existsSync(logFile) ? path.relative(root, logFile) : null,
      session_id: session.name.replace(/\.json$/, ""),
    };
  }
  const denial = String(log || "").split(/\r?\n/).find((line) => /no approval surface|denied by the session sandbox|auto-denied/i.test(line));
  if (denial) {
    const detail = clean(`The provider session completed, but its commands were denied (${denial.trim()}). No ATL transition, evidence entry, or check could be recorded, so ${taskId} stayed ${status || "assigned"}.`);
    return {
      cause: "runner-tool-policy",
      identity: "runner-tool-policy",
      reason: detail,
      recovery_owner: "owner",
      detail,
      next_actions: [
        { kind: "inspect-log", label: "Inspect the worker log", instruction: "Open the bounded worker log tail, confirm which commands were denied, and correct the provider workspace or approval policy before retrying." },
        { kind: "unblock-review", label: "Review and unblock manually", instruction: "Validate the workspace handoff packet and completion checks, then use Unblock task as the owner. Unblocking does not start a provider." },
      ],
      evidence: [{ kind: "denied-command", detail: clean(denial.trim()) }],
      log_path: taskLogTails(root, taskId)[0] ? `.trust/manager/overnight/${taskId}` : null,
      session_id: null,
    };
  }
  return null;
}

// One read model for browser, terminal and CLI surfaces. Persisted detail wins;
// legacy blockers such as T-090 are enriched from bounded session records.
export function taskBlockerDetail(root, task) {
  const blocker = task?.blocker || {};
  const reason = clean(blocker.reason || task?.waiting_reason || "");
  if (blocker.detail || (blocker.next_actions || []).length) {
    return { reason, detail: clean(blocker.detail || ""), next_actions: blocker.next_actions || [], evidence: blocker.evidence || [], log_path: blocker.log_path || null, session_id: blocker.session_id || null, source: "blocker" };
  }
  const derived = workerStallFailure(root, task?.id || "", taskLogTails(root, task?.id || "")[0]?.tail || "", task?.status);
  if (derived) return { reason, detail: derived.detail, next_actions: derived.next_actions, evidence: derived.evidence, log_path: derived.log_path, session_id: derived.session_id, source: "session-log" };
  if (/^(local-dependencies|local-dependencies-unavailable|locked-dependencies)$/.test(blocker.cause || "")) {
    const guidance = packageFailureGuidance(reason, task?.workspace || null);
    return { reason, detail: guidance.detail, next_actions: guidance.next_actions, evidence: guidance.evidence, log_path: null, session_id: null, source: "blocker-cause" };
  }
  return { reason, detail: "", next_actions: [], evidence: blocker.evidence || [], log_path: null, session_id: null, source: "none" };
}

// One text projection for the CLI, command console and terminal dashboard. It
// keeps the reason and every recorded next action; exact commands and routes
// are shown verbatim so an owner can act without guessing.
export function formatBlockerDiagnosis(diagnosis = {}, { maxActions = Number.POSITIVE_INFINITY } = {}) {
  const lines = [];
  if (diagnosis.detail) lines.push(`What happened: ${diagnosis.detail}`);
  const actions = Array.isArray(diagnosis.next_actions) ? diagnosis.next_actions : [];
  const shown = actions.slice(0, maxActions);
  for (const action of shown) {
    const exact = action.command
      ? ` Exact command: ${action.command}`
      : action.model
        ? ` Exact route: ${action.provider || "provider"}/${action.model}`
        : "";
    lines.push(`Next · ${action.label || "Inspect"}: ${action.instruction || "Inspect the recorded evidence before retrying."}${exact}`);
  }
  if (actions.length > shown.length) lines.push(`${actions.length - shown.length} more recorded action(s) — see atl why <task>.`);
  if (diagnosis.log_path) lines.push(`Log: ${diagnosis.log_path}`);
  if (diagnosis.session_id) lines.push(`Session: ${diagnosis.session_id}`);
  return lines;
}

export function formatHandoffActions(actions = [], { maxActions = Number.POSITIVE_INFINITY } = {}) {
  const lines = [];
  const shown = actions.slice(0, maxActions);
  for (const item of shown) {
    lines.push(`Handoff ${item.task || item.id || "?"} [${item.status || "unknown"}/${item.handoff || "unavailable"}]: ${item.reason || "No reason was recorded."}`);
    if (item.workspaceAvailable === false) lines.push("Workspace: recorded workspace is unavailable; inspect it before relying on this handoff.");
    for (const action of item.next_actions || []) lines.push(`Next · ${action.label || "Inspect"}: ${action.instruction}`);
  }
  if (actions.length > shown.length) lines.push(`${actions.length - shown.length} more handoff(s) — see atl why <task>.`);
  return lines;
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
