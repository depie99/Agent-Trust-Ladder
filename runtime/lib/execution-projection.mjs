import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadState } from "./state.mjs";
import { executionRecords } from "./execution-report.mjs";
import { listChangeReviews, readChangeReview } from "./change-review-store.mjs";
import { ChangeReviewError, compareSnapshots, fileDiff } from "./task-changes.mjs";

// The same pinned patch powers the reviewer and graph. Expansion pages only
// metadata; it neither captures new source nor invokes a provider.
export function readImpactChildren(root, task, { captureId, fileId = null, cursor = 0 } = {}) {
  if (!captureId) throw new ChangeReviewError("change_set_missing", "A pinned capture is required", 400);
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ChangeReviewError("invalid_cursor", "Cursor must be a non-negative integer", 400);
  const record = readChangeReview(root, task, captureId);
  const files = compareSnapshots(record.baseline, record.output);
  const size = 100;
  if (!fileId) {
    const nodes = files.slice(offset, offset + size).map((file) => ({ id: `file:${record.id}:${file.id}`, kind: "file", label: file.path, file_id: file.id, capture_id: record.id, hunks_loaded: false }));
    return { version: 1, capture_id: record.id, parent: { id: `capture:${record.id}`, kind: "capture", label: `Capture ${record.id.slice(0, 12)}` }, availability: "available", total: files.length, next_cursor: offset + size < files.length ? offset + size : null, nodes, edges: nodes.map((node) => ({ from: `capture:${record.id}`, to: node.id, provenance: "recorded", label: "captured change" })) };
  }
  const diff = fileDiff(root, record, fileId);
  if (!diff.complete) return { version: 1, capture_id: record.id, file_id: fileId, availability: diff.availability, message: diff.message || "Captured patch unavailable", total: null, next_cursor: null, nodes: [], edges: [] };
  const headers = [...(diff.patch || "").matchAll(/^@@[^\n]*/gm)];
  const nodes = headers.slice(offset, offset + size).map((match, index) => ({ id: `hunk:${record.id}:${fileId}:${match[0]}`, kind: "hunk", label: `${diff.file.path} · ${match[0]}`, file_id: fileId, capture_id: record.id, hunk_index: offset + index, header: match[0] }));
  return { version: 1, capture_id: record.id, file_id: fileId, parent: { id: `file:${record.id}:${fileId}`, kind: "file", label: diff.file.path }, availability: "available", total: headers.length, next_cursor: offset + size < headers.length ? offset + size : null, nodes, edges: nodes.map((node) => ({ from: `file:${record.id}:${fileId}`, to: node.id, provenance: "recorded", label: "patch hunk" })) };
}

// Read-only execution projection: joins what ATL already recorded (state
// events, execution ledger, overnight session summaries, captured change
// sets, evidence) by explicit identifiers. It invents no workflow: stages
// exist only when a recorded event, session role, or evidence kind maps to
// them, and missing links render as "Not recorded" downstream.
const LIMITS = Object.freeze({ eventsPerAttempt: 60, files: 200, checks: 100, evidencePerAttempt: 40 });

const PLANNING_ROLES = new Set(["planning", "planning-review", "planning-regenerate", "task-triage", "my-tasks-review"]);
const REVIEW_ROLES = new Set(["review", "semantic-reviewer", "reviewer"]);

const STAGE_DEFS = [
  { key: "intake", label: "Intake & triage" },
  { key: "preparation", label: "Repository preparation" },
  { key: "planning", label: "Specification & planning" },
  { key: "implementation", label: "Implementation" },
  { key: "review", label: "Review" },
  { key: "verification", label: "Verification" },
  { key: "integration", label: "Integration" },
];

const TRANSITION_EVENTS = /^(\S+) -> (\S+)$/;
const STAGE_BY_STATE = { new: "intake", triaged: "intake", assigned: "preparation", in_progress: "implementation", in_review: "review", verifying: "verification", done: "integration" };

function stageForRole(role) {
  if (PLANNING_ROLES.has(role)) return "planning";
  if (REVIEW_ROLES.has(role)) return "review";
  return "implementation";
}

function stageForEvent(name) {
  if (["task_created", "task_repository_assigned", "task_repository_changed", "intake_repository_changed", "task_provider_route_changed"].includes(name)) return "intake";
  if (name === "workspace") return "preparation";
  if (name === "packet-revised") return "planning";
  if (name === "worker_start" || name === "worker_exit") return "implementation";
  if (name === "integration-route") return "integration";
  // Run configuration, not execution work.
  if (name === "session_budget_increased" || name === "resource_route") return null;
  if (name.startsWith("evidence:")) return String(name).startsWith("evidence:review") ? "review" : "verification";
  const transition = name.match(TRANSITION_EVENTS);
  if (transition) return STAGE_BY_STATE[transition[2]] || null;
  return null;
}

function truncated(list, cap) {
  if (list.length <= cap) return { items: list, truncated: false };
  return { items: list.slice(0, cap), truncated: true };
}

function sessionOutcome(session) {
  if (session.timedOut) return "failed";
  if (session.exitCode === null || session.exitCode === undefined) return session.finishedAt ? "unknown" : "running";
  return session.exitCode === 0 ? "complete" : "failed";
}

function plainEvent(entry) {
  return { at: entry.at || null, actor: entry.actor || null, event: entry.event || null, detail: entry.detail || entry.note || null };
}

function attemptNodeId(stage, attempt) {
  const identity = attempt.session_id || createHash("sha256").update(JSON.stringify([stage, attempt.kind, attempt.started_at, attempt.actor, attempt.events?.[0] || attempt.evidence?.[0] || null])).digest("hex").slice(0, 24);
  return `attempt:${stage}:${identity}`;
}

export function buildExecutionProjection(root, taskId, options = {}) {
  const state = options.state || loadState(root);
  const task = state.tasks?.[taskId];
  if (!task) return { version: 1, capability: "task-execution-projection-v1", availability: "unknown_task", task_id: taskId, message: "No recorded task with this identifier." };

  const records = options.records !== undefined ? options.records : safeRecords(root);
  const sessions = records
    .filter((row) => row && (row.taskId === taskId || row.task_id === taskId))
    .slice()
    .sort((a, b) => String(a.startedAt || "").localeCompare(String(b.startedAt || "")));
  const sessionIds = new Set(sessions.map((session) => session.id).filter(Boolean));

  const events = (options.events !== undefined ? options.events : state.log || [])
    .map((entry, index) => ({ ...entry, _seq: index }))
    .filter((entry) => entry.task === taskId);
  const taskEvidence = Array.isArray(task.evidence) ? task.evidence : [];

  // Captures: changed paths stay grouped under their capture id; a stage
  // references a capture only when a recorded packet revision links them.
  let captures = options.revisions !== undefined ? options.revisions : safeList(root, task);
  let currentCaptureId = null;
  try { currentCaptureId = readChangeReview(root, task, null)?.id || null; } catch { currentCaptureId = null; }

  let files = options.files !== undefined ? options.files.slice() : [];
  let totalFiles = files.length;
  let fileCaptureId = null;
  const captureRecords = new Map();
  if (options.files === undefined) {
    try {
      const current = readChangeReview(root, task, options.captureId || null);
      if (current) {
        fileCaptureId = current.id;
        captureRecords.set(current.id, current);
        const allFiles = compareSnapshots(current.baseline, current.output);
        totalFiles = allFiles.length;
        const page = truncated(allFiles, LIMITS.files);
        files = page.items.map((file) => ({ id: file.id, path: file.path, kind: file.kind, capture_id: current.id }));
      }
    } catch { /* no baseline or unreadable record: files stay unlisted */ }
  }

  const stages = new Map(STAGE_DEFS.map((def) => [def.key, { key: def.key, label: def.label, attempts: [], event_count: 0, capture_ids: [] }]));
  const claimedSeqs = new Set();

  // 1. Session attempts: one ledger/overnight record each, joined with
  //    explicitly linked evidence (evidence.session_id) and log-tail events
  //    of the same stage fired inside the session's recorded window.
  for (const session of sessions) {
    const stageKey = stageForRole(String(session.role || ""));
    const stage = stages.get(stageKey);
    if (!stage) continue;
    const ownEvidence = taskEvidence.filter((entry) => entry.session_id && sessionIds.has(entry.session_id) && entry.session_id === session.id);
    const started = session.startedAt ? Date.parse(session.startedAt) : null;
    const finished = session.finishedAt ? Date.parse(session.finishedAt) : null;
    const inWindow = (entry) => {
      if (stageForEvent(String(entry.event || "")) !== stageKey) return false;
      const at = entry.at ? Date.parse(entry.at) : null;
      if (at == null || Number.isNaN(at) || started == null || Number.isNaN(started)) return false;
      return at >= started - 1500 && (finished == null || Number.isNaN(finished) || at <= finished + 1500);
    };
    const windowEvents = events.filter((entry) => inWindow(entry) && !claimedSeqs.has(entry._seq));
    for (const entry of windowEvents) claimedSeqs.add(entry._seq);
    const pageEvents = truncated(windowEvents, LIMITS.eventsPerAttempt);
    stage.attempts.push({
      kind: "session",
      attempt: stage.attempts.length + 1,
      actor: session.role || null,
      provider: session.provider || null,
      model: session.model || null,
      session_id: session.id || null,
      log_path: session.logPath || null,
      started_at: session.startedAt || null,
      ended_at: session.finishedAt || null,
      timed_out: Boolean(session.timedOut),
      exit_code: session.exitCode ?? null,
      status_before: session.statusBefore || null,
      status_after: session.statusAfter || null,
      packet_revision: session.packetRevision ?? null,
      checkpoint: session.checkpoint ? { note: session.checkpoint.note || null, summary: session.checkpoint.summary || session.checkpoint.note || null, at: session.checkpoint.at || session.finishedAt || null } : null,
      outcome: sessionOutcome(session),
      summary: session.failure ? String(session.failure.summary || session.failure.message || session.failure).slice(0, 400) : (session.checkpoint?.summary || session.checkpoint?.note || null),
      failure: session.failure ? { summary: String(session.failure.summary || session.failure.message || session.failure).slice(0, 400), next_action: session.failure.next_action || null } : null,
      tokens: session.tokens && session.tokens.total != null ? { total: session.tokens.total, source: session.usage_source || session.tokens.source || "unknown" } : null,
      events: pageEvents.items.map(plainEvent),
      events_truncated: pageEvents.truncated,
      evidence: truncated(ownEvidence, LIMITS.evidencePerAttempt).items.map((entry, index) => ({ id: `${session.id || "session"}:${index}`, kind: entry.kind, check: entry.check || null, result: entry.result || null, at: entry.at || null })),
      commands: taskEvidence
        .filter((entry) => entry.session_id === session.id && entry.command)
        .map((entry) => ({ command: entry.command, at: entry.at || null, exit_code: entry.exit_code ?? null, result: entry.result || null })),
    });
    stage.event_count += windowEvents.length;
  }

  // 2. Remaining recorded events collapse per stage: consecutive events of
  //    the same name become one compact run (first + last kept).
  const grouped = new Map();
  for (const entry of events) {
    if (claimedSeqs.has(entry._seq)) continue;
    const stageKey = stageForEvent(String(entry.event || ""));
    if (!stageKey) continue;
    const list = grouped.get(stageKey) || [];
    list.push(entry);
    grouped.set(stageKey, list);
  }
  for (const [stageKey, entries] of grouped) {
    const runs = [];
    for (const entry of entries) {
      const last = runs.at(-1);
      if (last && last.name === entry.event) last.items.push(entry);
      else runs.push({ name: entry.event, items: [entry] });
    }
    const compact = runs.flatMap((run) => (run.items.length > 3
      ? [{ ...run.items[0], detail: `${run.items.length}× ${run.name}${run.items[0].detail || run.items[0].note ? ` — ${run.items[0].detail || run.items[0].note}` : ""}` }, run.items.at(-1)]
      : run.items));
    const stage = stages.get(stageKey);
    const page = truncated(compact, LIMITS.eventsPerAttempt);
    stage.attempts.push({
      kind: "events",
      attempt: stage.attempts.length + 1,
      actor: page.items[0]?.actor || null,
      started_at: page.items[0]?.at || null,
      ended_at: page.items.at(-1)?.at || null,
      outcome: null,
      summary: page.items[0]?.detail || page.items[0]?.note || page.items[0]?.event || null,
      events: page.items.map(plainEvent),
      events_truncated: page.truncated,
      evidence: [],
      session_id: null,
      commands: [],
    });
    stage.event_count += entries.length;
  }

  // 3. Evidence without a session link lands on its kind's stage; if that
  //    stage has no attempts yet, it gets a recorded-evidence attempt.
  const unlinked = taskEvidence.filter((entry) => !entry.session_id || !sessionIds.has(entry.session_id));
  for (const entry of unlinked) {
    const stageKey = String(entry.kind || "").startsWith("review") ? "review" : "verification";
    const stage = stages.get(stageKey);
    if (!stage) continue;
    if (!stage.attempts.length) {
      stage.attempts.push({ kind: "events", attempt: 1, actor: null, started_at: entry.at || null, ended_at: entry.at || null, outcome: null, summary: null, events: [], events_truncated: false, evidence: [], session_id: null, commands: [] });
    }
    const bucket = stage.attempts.at(-1);
    if (bucket.evidence.length < LIMITS.evidencePerAttempt) {
      bucket.evidence.push({ id: `task:${bucket.evidence.length}`, kind: entry.kind, check: entry.check || null, result: entry.result || null, at: entry.at || null, command: entry.command || null, exit_code: entry.exit_code ?? null, coverage: entry.coverage || null });
    }
  }

  // 4. Capture-to-stage links are explicit only: same recorded packet
  //    revision as a session in that stage.
  const byPacket = new Map();
  for (const session of sessions) if (session.packetRevision != null) byPacket.set(session.packetRevision, session);
  for (const capture of captures) {
    const session = byPacket.get(capture.packet_revision);
    if (!session) continue;
    const stage = stages.get(stageForRole(String(session.role || "")));
    if (stage && !stage.capture_ids.includes(capture.id)) stage.capture_ids.push(capture.id);
  }

  const stageList = [...stages.values()].filter((stage) => stage.attempts.length > 0 || stage.capture_ids.length > 0);
  const checks = (() => {
    const rows = taskEvidence.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === "check" && entry.check).sort((a, b) => String(a.entry.at || "").localeCompare(String(b.entry.at || "")) || a.index - b.index);
    const page = truncated(rows, LIMITS.checks);
    return { items: page.items.map(({ entry, index }) => ({ id: `check-${createHash("sha256").update(JSON.stringify([index, entry.kind, entry.check, entry.at, entry.session_id, entry.command, entry.result])).digest("hex").slice(0, 20)}`, check: entry.check, result: entry.result || null, at: entry.at || null, coverage: entry.coverage || null, command: entry.command || null, actor: entry.actor || null, session_id: entry.session_id || null })), truncated: page.truncated };
  })();

  const runningSession = sessions.find((session) => !session.finishedAt) || null;
  return {
    version: 1,
    capability: "task-execution-projection-v1",
    availability: "available",
    task_id: taskId,
    status: task.status || null,
    generated_at: new Date().toISOString(),
    planned: sessions.length === 0 && ["new", "triaged", "assigned"].includes(task.status),
    unrun: sessions.length === 0,
    running: Boolean(runningSession),
    repository: {
      id: task.repository_id || null,
      name: task.repository_name || null,
      repositories: Array.isArray(task.repository_ids) ? task.repository_ids : (task.repository_id ? [task.repository_id] : []),
      workspace: task.workspace || null,
      workspace_recorded: Boolean(task.workspace),
    },
    stages: stageList,
    captures: captures.slice(0, 20).map((capture) => ({ ...capture, current: capture.id === currentCaptureId })),
    current_capture_id: currentCaptureId,
    files,
    checks,
    graph: (() => {
      const nodes = [{ id: `task:${taskId}`, kind: "objective", label: task.objective_hint || task.objective || task.title || taskId, capture_id: null }];
      const edges = [];
      let hunkFilesProcessed = 0, hunkCount = 0, hunksTruncated = false;
      for (const stage of stageList) for (const attempt of stage.attempts) {
        const id = attemptNodeId(stage.key, attempt);
        nodes.push({ id, kind: "attempt", label: `${stage.label} · ${attempt.actor || "recorded events"} · ${attempt.outcome || "recorded"}`, stage: stage.key, attempt: attempt.attempt, at: attempt.started_at || attempt.ended_at || null, session_id: attempt.session_id || null });
        edges.push({ from: `task:${taskId}`, to: id, provenance: "recorded", label: "task execution" });
      }
      const graphCaptures = captures.slice(0, 20);
      if (fileCaptureId && !graphCaptures.some((capture) => capture.id === fileCaptureId)) graphCaptures.push({ id: fileCaptureId });
      for (const capture of graphCaptures) nodes.push({ id: `capture:${capture.id}`, kind: "capture", label: `Capture ${capture.id.slice(0, 8)} · ${capture.id === currentCaptureId ? "current" : "historical"}`, capture_id: capture.id, files_next_cursor: capture.id === fileCaptureId ? (totalFiles > files.length ? files.length : null) : 0 });
      for (const file of files) {
        const id = `file:${file.capture_id}:${file.id}`;
        const fileNode = { id, kind: "file", label: file.path, file_id: file.id, capture_id: file.capture_id, hunks_loaded: false };
        nodes.push(fileNode);
        if (file.capture_id) {
          edges.push({ from: `capture:${file.capture_id}`, to: id, provenance: "recorded", label: "captured change" });
          const linkedStage = stageList.find((stage) => stage.capture_ids.includes(file.capture_id));
          const linkedAttempt = linkedStage?.attempts.find((attempt) => attempt.session_id);
          if (linkedAttempt) edges.push({ from: attemptNodeId(linkedStage.key, linkedAttempt), to: id, provenance: "inferred", label: "same packet revision" });
          const capture = captureRecords.get(file.capture_id);
          if (capture && hunkFilesProcessed < 24 && hunkCount < 250) {
            hunkFilesProcessed++;
            const diff = fileDiff(root, capture, file.id, { milliseconds: 100 });
            const patch = diff.patch || "";
            if (diff.availability !== "available" || diff.truncated) hunksTruncated = true;
            const headers = [...patch.matchAll(/^@@[^\n]*/gm)];
            const remainingHunks = 250 - hunkCount;
            fileNode.hunks_loaded = diff.complete && headers.length <= remainingHunks;
            fileNode.hunks_next_cursor = diff.complete && headers.length > remainingHunks ? remainingHunks : null;
            fileNode.hunks_availability = diff.availability;
            if (headers.length > remainingHunks) hunksTruncated = true;
            headers.slice(0, remainingHunks).forEach((match, index) => {
              const hunkId = `hunk:${file.capture_id}:${file.id}:${match[0]}`;
              nodes.push({ id: hunkId, kind: "hunk", label: `${file.path} · ${match[0]}`, file_id: file.id, capture_id: file.capture_id, hunk_index: index, header: match[0] });
              edges.push({ from: id, to: hunkId, provenance: "recorded", label: "patch hunk" });
              hunkCount++;
            });
          } else if (capture) hunksTruncated = true;
        }
      }
      for (const check of checks.items) {
        const id = `check:${check.id}`;
        nodes.push({ id, kind: "check", label: `${check.check} · ${check.result || "unknown"}`, check_id: check.id, check: check.check, result: check.result, at: check.at, coverage: check.coverage, command: check.command, actor: check.actor, session_id: check.session_id });
        const attempt = stageList.flatMap((stage) => stage.attempts.map((item) => ({ stage, item }))).find(({ item }) => check.session_id && item.session_id === check.session_id);
        if (attempt) edges.push({ from: attemptNodeId(attempt.stage.key, attempt.item), to: id, provenance: "recorded", label: "session-linked evidence" });
      }
      if (files.length * checks.items.length > 200) {
        const coverageId = `coverage:${taskId}`;
        nodes.push({ id: coverageId, kind: "coverage", label: "Per-file verification not recorded" });
        for (const file of files) edges.push({ from: `file:${file.capture_id}:${file.id}`, to: coverageId, provenance: "unknown", label: "file coverage not recorded" });
        for (const check of checks.items) edges.push({ from: coverageId, to: `check:${check.id}`, provenance: "unknown", label: "task-level check" });
      } else for (const file of files) for (const check of checks.items) edges.push({ from: `file:${file.capture_id}:${file.id}`, to: `check:${check.id}`, provenance: "unknown", label: "file coverage not recorded" });
      nodes.push({ id: `outcome:${taskId}`, kind: "outcome", label: `Task outcome · ${task.status || "unknown"}` });
      edges.push({ from: `task:${taskId}`, to: `outcome:${taskId}`, provenance: "recorded", label: "recorded status" });
      return { version: 1, nodes, edges, hunk_files_processed: hunkFilesProcessed, hunks_truncated: hunksTruncated, total_files: totalFiles, files_truncated: totalFiles > files.length };
    })(),
    counts: { sessions: sessions.length, events: events.length, captures: captures.length, evidence: taskEvidence.length, files: files.length },
  };
}

function safeRecords(root) {
  try { return executionRecords(root); } catch { return []; }
}
function safeList(root, task) {
  try { return listChangeReviews(root, task); } catch { return []; }
}

export function readExecutionProjection(root, taskId) {
  return buildExecutionProjection(root, taskId);
}

export function projectionFileExists(root, logPath) {
  if (!logPath) return false;
  try { return fs.existsSync(path.isAbsolute(logPath) ? logPath : path.join(root, logPath)); } catch { return false; }
}
