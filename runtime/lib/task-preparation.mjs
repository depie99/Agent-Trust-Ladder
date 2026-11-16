import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readMyTasksStore } from "./my-tasks.mjs";
import { resolveReviewRepositories } from "./my-tasks-reviews.mjs";
import { loadState, saveState } from "./state.mjs";
import { planDraftIndex } from "./plan-studio.mjs";
import { importCandidates } from "./composer.mjs";

// Spec 022 — task preparation: a persistent, task-linked record between the
// read-only Azure My Tasks store and Plan Studio. One record per work item
// holds the understood outcome, the requested behavior, acceptance examples,
// grouped questions (owner decisions vs. investigation) and bounded discovery
// runs. Derived statuses separate preparation from the existing review and
// approval gates; generation from a prepared request unlocks only when the
// record is "ready" and its source revision is still current. Azure is never
// written.

export const PREP_SCHEMA_VERSION = 1;
const home = (root) => path.join(root, ".trust", "manager", "my-tasks", "preparations");
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const nowIso = () => new Date().toISOString();

export class PrepConflictError extends Error {
  constructor(message) { super(message); this.statusCode = 409; }
}

const fileFor = (root, key) => path.join(home(root), `${hash(String(key))}.json`);

export function readPreparation(root, key) {
  try { return JSON.parse(fs.readFileSync(fileFor(root, key), "utf8")); } catch { return null; }
}

export function writePreparation(root, record, { expectedRevision = null } = {}) {
  fs.mkdirSync(home(root), { recursive: true });
  const persisted = readPreparation(root, record.key);
  if (expectedRevision != null && (persisted ? Number(persisted.revision) : 0) !== Number(expectedRevision)) {
    throw new PrepConflictError("preparation changed while you were editing — reload and re-apply the edit");
  }
  const next = { ...record, schema: PREP_SCHEMA_VERSION, revision: Number(record.revision || 0) + 1, updated_at: nowIso() };
  const file = fileFor(root, record.key);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return next;
}

function emptyRecord(key, item, context = {}) {
  const description = String(item.description_text || "");
  const review = context.review?.result ? context.review : null;
  return {
    schema: PREP_SCHEMA_VERSION,
    key,
    source_revision: item.rev == null ? null : String(item.rev),
    captured_at: nowIso(),
    updated_at: nowIso(),
    revision: 0, // writePreparation bumps to 1 on seed
    brief: {
      // Seeded from saved source content only, so the preview renders before
      // any provider call and stays readable when a provider fails.
      outcome: description.split("\n").find((line) => line.trim()) || "",
      existing_behavior: "",
      requested_behavior: "",
      scope: "",
      acceptance_examples: String(item.acceptance_criteria || "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 20),
      // The brief revision moves only when brief CONTENT changes, so discovery
      // runs can be marked stale without counting unrelated record writes.
      revision: 1,
      // A short review is reused as intake context; its coverage limitation is
      // kept so a task-only review is never mistaken for code evidence.
      evidence: (review?.evidence || []).map((entry) => ({ repository_id: entry.repository_id, path: entry.path, line: entry.line, end_line: entry.end_line, excerpt: entry.excerpt })),
      evidence_limitation: review ? (review.coverage === "code" ? null : "The short review ran without code evidence (task-only coverage).") : null,
      evidence_from: review ? { generated_at: review.generated_at || null, coverage: review.coverage || null } : null,
    },
    repositories: [...new Set((context.repositories || []).filter(Boolean))],
    questions: [],
    investigation_runs: [],
    next_action: "",
    handoff: null,
    in_flight: null,
  };
}

// ---------- derived status (computed on read, never stored)

const briefComplete = (record) => Boolean(String(record?.brief?.outcome || "").trim() && String(record?.brief?.requested_behavior || "").trim());

export function derivePreparationStatus(record, item) {
  if (!item) return record ? "orphaned" : "unavailable";
  if (item.state_category === "complete") return "historical";
  if (!record) return "not_prepared";
  const open = (record.questions || []).filter((question) => !question.answer);
  if (open.some((question) => question.kind === "owner_decision")) return "needs_answer";
  if (open.length) return "needs_investigation";
  return briefComplete(record) ? "ready" : "needs_investigation";
}

export function defaultNextAction(status) {
  switch (status) {
    case "not_prepared": return "Open preparation and capture the understood outcome.";
    case "needs_investigation": return "Run bounded discovery in the linked repositories, or answer the open investigation questions.";
    case "needs_answer": return "Answer the questions marked as owner decisions.";
    case "ready": return "Hand off to Plan Studio.";
    case "historical": return "No action — historical work stays inventoried.";
    default: return "Task is no longer in the assigned store.";
  }
}

// ---------- mutations (each loads, mutates, writes with CAS)

function mutate(root, key, expectedRevision, fn) {
  const record = readPreparation(root, key);
  if (!record) throw new PrepConflictError("preparation record is missing — open the task in My Tasks to seed it first");
  fn(record);
  return writePreparation(root, record, { expectedRevision: expectedRevision == null ? record.revision : expectedRevision });
}

export function seedPreparation(root, key, item, context = {}) {
  const existing = readPreparation(root, key);
  if (existing) return existing;
  return writePreparation(root, emptyRecord(key, item, context));
}

const BRIEF_FIELDS = ["outcome", "existing_behavior", "requested_behavior", "scope"];
export function savePreparationBrief(root, key, patch = {}, { expectedRevision = null } = {}) {
  return mutate(root, key, expectedRevision, (record) => {
    let contentChanged = false;
    for (const field of BRIEF_FIELDS) if (patch[field] !== undefined) { record.brief[field] = String(patch[field]).slice(0, 4000); contentChanged = true; }
    if (patch.acceptance_examples !== undefined) {
      const lines = Array.isArray(patch.acceptance_examples) ? patch.acceptance_examples : String(patch.acceptance_examples).split("\n");
      record.brief.acceptance_examples = lines.map((line) => String(line).trim()).filter(Boolean).slice(0, 20);
      contentChanged = true;
    }
    if (patch.next_action !== undefined) record.next_action = String(patch.next_action).slice(0, 500);
    // A consequential brief edit invalidates earlier discovery: runs stay for
    // history but are marked as written against an earlier brief
    // (fresh-review-after-change, mirrored from plan-studio's persistArtifact).
    if (contentChanged) record.brief.revision = Number(record.brief.revision || 1) + 1;
  });
}

export function addPreparationQuestion(root, key, question = {}, { expectedRevision = null } = {}) {
  const text = String(question.question || "").trim();
  if (!text) throw new Error("a question needs text");
  const kind = question.kind === "investigation" ? "investigation" : "owner_decision";
  return mutate(root, key, expectedRevision, (record) => {
    record.questions.push({
      id: `q${record.questions.length + 1}`,
      kind,
      question: text.slice(0, 600),
      why: String(question.why || "").slice(0, 600),
      options: (Array.isArray(question.options) ? question.options : []).map((option) => String(option).trim().slice(0, 200)).filter(Boolean).slice(0, 6),
      answer: "",
      answered_at: null,
    });
  });
}

export function answerPreparationQuestion(root, key, questionId, answer, { expectedRevision = null } = {}) {
  const text = String(answer || "").trim();
  if (!text) throw new Error("an answer cannot be empty — remove the question instead");
  return mutate(root, key, expectedRevision, (record) => {
    const question = record.questions.find((entry) => entry.id === questionId);
    if (!question) throw new Error(`unknown question ${questionId}`);
    question.answer = text.slice(0, 2000);
    question.answered_at = nowIso();
  });
}

export function addManualInvestigation(root, key, notes, { expectedRevision = null } = {}) {
  const text = String(notes || "").trim();
  if (!text) throw new Error("manual investigation needs notes");
  return mutate(root, key, expectedRevision, (record) => {
    record.investigation_runs.push({ id: `run${record.investigation_runs.length + 1}`, at: nowIso(), kind: "manual", notes: text.slice(0, 6000), brief_revision: Number(record.brief?.revision || 1) });
  });
}

export function beginDiscoveryRun(root, key, { expectedRevision = null } = {}) {
  const runId = `run${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  mutate(root, key, expectedRevision, (record) => {
    if (record.in_flight) throw new PrepConflictError("a discovery run is already in flight for this task — wait for it to finish");
    record.in_flight = { run_id: runId, since: nowIso() };
  });
  return runId;
}

// A failed discovery keeps the run with its error: the record content is never
// blanked by provider failure, matching the recovery-draft rule in Plan Studio.
export function finishDiscoveryRun(root, key, runId, outcome = {}) {
  const record = readPreparation(root, key);
  if (!record || record.in_flight?.run_id !== runId) return readPreparation(root, key);
  if (outcome.error) {
    record.investigation_runs.push({ id: runId, at: nowIso(), kind: "discovery", error: String(outcome.error).slice(0, 600), brief_revision: Number(record.brief?.revision || 1) });
  } else {
    const validated = validateDiscoveryOutput(outcome.output);
    record.investigation_runs.push({
      id: runId, at: nowIso(), kind: "discovery",
      provider: outcome.provider || null, model: outcome.model || null,
      code_locations: validated.code_locations, findings: validated.findings,
      brief_revision: Number(record.brief?.revision || 1),
    });
    for (const question of validated.questions) {
      record.questions.push({ id: `q${record.questions.length + 1}`, kind: question.kind, question: question.question, why: question.why, options: question.options, answer: "", answered_at: null, from_run: runId });
    }
  }
  record.in_flight = null;
  return writePreparation(root, record);
}

// ---------- bounded discovery (provider output contract, fail-closed)

// Provider text arrives fenced/annotated; extract the first JSON object.
export function parseDiscoveryJson(text) {
  const raw = String(text || "").replace(/```(?:json)?/gi, "");
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("Discovery response contained no JSON object.");
  let parsed = null;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    // Scan for the matching closing brace instead of trusting the tail.
    let depth = 0;
    for (let index = start; index < raw.length; index += 1) {
      if (raw[index] === "{") depth += 1;
      if (raw[index] === "}") { depth -= 1; if (!depth) { parsed = JSON.parse(raw.slice(start, index + 1)); break; } }
    }
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Discovery response was not parseable JSON.");
  return parsed;
}

export function validateDiscoveryOutput(output) {
  if (!output || typeof output !== "object") throw new Error("Discovery did not return a JSON object.");
  const code_locations = (Array.isArray(output.code_locations) ? output.code_locations : []).slice(0, 8).map((location) => ({
    repository_id: String(location?.repository_id || "").trim(),
    path: String(location?.path || "").trim(),
    line: Number.isSafeInteger(Number(location?.line)) && Number(location.line) > 0 ? Number(location.line) : null,
    note: String(location?.note || "").slice(0, 300),
  })).filter((location) => location.repository_id && location.path);
  const findings = (Array.isArray(output.findings) ? output.findings : []).slice(0, 5).map((entry) => String(entry || "").trim().slice(0, 500)).filter(Boolean);
  const questions = (Array.isArray(output.questions) ? output.questions : []).slice(0, 4).map((question) => ({
    kind: question?.kind === "owner_decision" ? "owner_decision" : "investigation",
    question: String(question?.question || "").trim().slice(0, 600),
    why: String(question?.why || "").trim().slice(0, 600),
    options: (Array.isArray(question?.options) ? question.options : []).slice(0, 4).map((option) => String(option).trim().slice(0, 200)).filter(Boolean),
  })).filter((question) => question.question);
  if (!code_locations.length && !findings.length) throw new Error("Discovery returned neither code locations nor findings.");
  return { code_locations, findings, questions };
}

export function buildDiscoveryPrompt(item, record, repositories = []) {
  const brief = record?.brief || {};
  const open = (record?.questions || []).filter((question) => !question.answer);
  return [
    "You are doing a bounded code-discovery pass for one Azure DevOps work item.",
    "Report where the relevant behavior lives. Read-only: you propose locations, you never change code.",
    "",
    `Title: ${item.title}`,
    `Project: ${item.project} · Type: ${item.type} · State: ${item.state}`,
    brief.outcome ? `Understood outcome: ${brief.outcome}` : "Understood outcome: not captured yet.",
    brief.existing_behavior ? `Existing behavior: ${brief.existing_behavior}` : "",
    brief.requested_behavior ? `Requested behavior: ${brief.requested_behavior}` : "",
    brief.scope ? `Scope: ${brief.scope}` : "",
    (brief.acceptance_examples || []).length ? `Acceptance examples:\n- ${brief.acceptance_examples.join("\n- ")}` : "",
    "",
    `Linked repositories: ${repositories.map((repo) => `${repo.name} (${repo.id})`).join(", ") || "none registered"}`,
    open.length ? `Open questions already recorded:\n- ${open.map((question) => `[${question.kind}] ${question.question}`).join("\n- ")}` : "",
    "",
    "Answer with JSON only: {\"code_locations\":[{\"repository_id\",\"path\",\"line\",\"note\"}] (max 8), \"findings\":[strings] (max 5), \"questions\":[{\"kind\":\"owner_decision\"|\"investigation\",\"question\",\"why\",\"options\":[strings]}] (max 4)}.",
    "owner_decision questions are product choices only the requester can make; investigation questions are answerable by reading code or asking the team.",
  ].filter((line) => line !== undefined).join("\n");
}

// ---------- handoff into Plan Studio (idempotent, Azure stays read-only)

// Same construction as skills/atl azure-intake so a later Azure intake sync
// dedupes against the handoff import instead of creating a second request.
function azureIntakeKey(item, azureCfg) {
  const organization = new URL(String(azureCfg?.org_url || item.connection));
  return `azure:${organization.href.replace(/\/$/, "")}:${item.project}:${item.id}:${item.rev ?? 0}`;
}

export function candidateFromPreparation(item, record, azureCfg = {}) {
  const brief = record?.brief || {};
  const lines = [];
  if (brief.outcome) lines.push(`Understood outcome: ${brief.outcome}`);
  if (brief.existing_behavior) lines.push(`Existing behavior: ${brief.existing_behavior}`);
  if (brief.requested_behavior) lines.push(`Requested behavior: ${brief.requested_behavior}`);
  if (brief.scope) lines.push(`Scope: ${brief.scope}`);
  const organization = new URL(String(azureCfg?.org_url || item.connection));
  const base = `${organization.href.replace(/\/$/, "")}/${encodeURIComponent(item.project)}`;
  return {
    title: item.title,
    objective_hint: (lines.join("\n") || String(item.description_text || item.title)).slice(0, 4000),
    completion_checks: (brief.acceptance_examples || []).slice(0, 10),
    priority: item.priority != null && item.priority <= 2 ? "high" : "normal",
    risk: "normal",
    labels: [item.type, item.state].filter(Boolean),
    source: {
      type: "azure",
      url: `${base}/_workitems/edit/${item.id}`,
      thread: item.url,
      project: item.project,
      remote_id: item.id,
      revision: item.rev == null ? null : String(item.rev),
      excerpt: String(item.description_text || item.title).slice(0, 300),
    },
    resources: [],
    intake_key: azureIntakeKey(item, azureCfg),
  };
}

export function handoffPreparation(root, key, { azureCfg = {}, repositoryIds = null } = {}) {
  const record = readPreparation(root, key);
  if (!record) { const error = new Error("open the preparation tab and save a brief before handing off"); error.statusCode = 409; throw error; }
  const item = Object.values(readMyTasksStore(root).records || {}).find((entry) => entry.key === key);
  if (!item) { const error = new Error("Task is no longer assigned."); error.statusCode = 404; throw error; }
  const state = loadState(root);
  // Duplicate handoffs reuse the same request: match by Azure remote id, never
  // by title, so a renamed work item still finds its request.
  let task = Object.values(state.tasks || {}).find((entry) => entry.source?.type === "azure" && String(entry.source?.remote_id ?? "") === String(item.id));
  let created = false;
  if (!task) {
    const candidate = candidateFromPreparation(item, record, azureCfg);
    const targets = (repositoryIds || record.repositories || []).filter(Boolean);
    const result = importCandidates(root, state, [candidate], { repositoryIds: targets.length ? targets : null });
    created = true;
    task = result.created[0]?.task || Object.values(state.tasks || {}).find((entry) => entry.intake_key === candidate.intake_key);
    if (!task) throw new Error("the handoff import did not create a request");
  }
  // Repository assignment stays locked once planning or execution began; an
  // unplanned request gets the union of its existing and prepared bindings.
  if (!task.plan_draft_id && !task.plan_queue_id) {
    const ids = [...new Set([...(Array.isArray(task.repository_ids) ? task.repository_ids : []), ...(repositoryIds || record.repositories || [])])].filter(Boolean);
    if (ids.length) {
      task.repository_ids = ids;
      task.repository_id = ids[0];
    }
  }
  task.prep_key = key;
  task.prep_revision = record.revision;
  task.prep_handed_at = nowIso();
  saveState(root, state);
  return { task_id: task.id, created, prep_revision: record.revision, intake_key: task.intake_key || null, repository_ids: task.repository_ids || [] };
}

// ---------- Plan Studio generation gate

// Called by /api/plan/generate when the source request carries a preparation
// linkage. Returns the guard info for un-prepared requests; throws 409 with a
// per-item recovery list while consequential questions are open or the Azure
// revision drifted after preparation.
export function assertPreparationReady(root, sourceTaskId) {
  if (!sourceTaskId) return null;
  const state = loadState(root);
  const task = state.tasks?.[sourceTaskId];
  if (!task?.prep_key) return null;
  const item = Object.values(readMyTasksStore(root).records || {}).find((entry) => entry.key === task.prep_key);
  const record = readPreparation(root, task.prep_key);
  const status = derivePreparationStatus(record, item);
  if (status !== "ready") {
    const reasons = [];
    if (!record) reasons.push("the preparation record is missing — open the preparation tab in My Tasks and save the brief");
    else if (!item) reasons.push("the task is no longer in the assigned store — reopen preparation from the current task list");
    else {
      const open = (record.questions || []).filter((question) => !question.answer);
      for (const question of open.filter((entry) => entry.kind === "owner_decision")) reasons.push(`question ${question.id} needs an owner decision: ${question.question}`);
      for (const question of open.filter((entry) => entry.kind === "investigation")) reasons.push(`question ${question.id} is still under investigation: ${question.question}`);
      if (!String(record.brief?.outcome || "").trim()) reasons.push("the brief is missing the understood outcome");
      if (!String(record.brief?.requested_behavior || "").trim()) reasons.push("the brief is missing the requested behavior");
    }
    const error = new Error(`Planning is locked until preparation is ready (${reasons.join("; ")}).`);
    error.statusCode = 409;
    error.preparation = { status, reasons };
    throw error;
  }
  if (item && String(record.source_revision ?? "") !== String(item.rev ?? "")) {
    const error = new Error(`The Azure task changed since preparation (revision ${record.source_revision ?? "?"} → ${item.rev ?? "?"}). Reopen the preparation tab, refresh the brief, and hand off again.`);
    error.statusCode = 409;
    error.preparation = { status, stale_revision: { prepared: record.source_revision, current: String(item.rev ?? "") } };
    throw error;
  }
  return { key: task.prep_key, revision: record.revision, task_id: task.id };
}

// ---------- views

// One-read context factory for inventory seeding: the review book and the
// repository bindings are read once, then consulted per item.
export function preparationSeedContext(root) {
  const myTasksHome = path.join(root, ".trust", "manager", "my-tasks");
  let book = { entries: {} };
  try { book = JSON.parse(fs.readFileSync(path.join(myTasksHome, "reviews.json"), "utf8")); } catch { /* reviews optional */ }
  const reviewByKey = new Map();
  for (const entry of Object.values(book.entries || {})) {
    if (!entry?.key) continue;
    const existing = reviewByKey.get(entry.key);
    // ensure() also writes queued/stale slot placeholders that carry no
    // content; prefer the entry that actually holds a generated review.
    if (!existing || (!existing.result && entry.result)) reviewByKey.set(entry.key, entry);
  }
  let bindings = { rules: [], items: {} };
  try { bindings = JSON.parse(fs.readFileSync(path.join(myTasksHome, "repository-bindings.json"), "utf8")); } catch { /* bindings optional */ }
  let imported = [];
  try { imported = Object.values(loadState(root).tasks || {}); } catch { /* state optional */ }
  return (item) => ({
    review: reviewByKey.get(item.key) || null,
    repositories: resolveReviewRepositories(item, bindings, imported),
  });
}

function linkedRequestFor(root, item, drafts) {
  let task = null;
  try {
    const state = loadState(root);
    task = Object.values(state.tasks || {}).find((entry) => entry.source?.type === "azure" && String(entry.source?.remote_id ?? "") === String(item.id)) || null;
  } catch { /* unreadable state: no linkage shown, never a crash */ }
  if (!task) return null;
  const plans = (drafts || []).filter((draft) => draft.source_task_id === task.id).map((draft) => ({ id: draft.id, title: draft.title, stage: draft.stage, review: draft.review, approved: Boolean(draft.approved), queue_id: draft.queue_id || null }));
  return {
    task_id: task.id,
    title: task.title,
    plan_review_required: Boolean(task.plan_review_required),
    archived: Boolean(task.archived_at),
    prep_key: task.prep_key || null,
    prep_revision: task.prep_revision ?? null,
    repositories: Array.isArray(task.repository_ids) ? task.repository_ids : task.repository_id ? [task.repository_id] : [],
    plans,
  };
}

export function preparationView(root, key, { drafts = null } = {}) {
  const store = readMyTasksStore(root);
  const item = Object.values(store.records || {}).find((entry) => entry.key === key) || null;
  const record = readPreparation(root, key);
  const status = derivePreparationStatus(record, item);
  return {
    key,
    item: item && {
      key: item.key, id: item.id, project: item.project, title: item.title, type: item.type, state: item.state,
      state_category: item.state_category, rev: item.rev, changed_at: item.changed_at, url: item.url,
      description_text: item.description_text, acceptance_criteria: item.acceptance_criteria,
      dependencies: item.dependencies || [],
    },
    record: record || null,
    status,
    next_action: (record?.next_action || "").trim() || defaultNextAction(status),
    freshness: item && record ? { fresh: String(record.source_revision ?? "") === String(item.rev ?? ""), prepared: record.source_revision, current: String(item.rev ?? "") } : null,
    runs_current: (record?.investigation_runs || []).map((run) => ({ ...run, current: Number(run.brief_revision || 0) === Number(record.brief?.revision || 1) })),
    linked_request: item ? linkedRequestFor(root, item, drafts) : null,
  };
}

// Inventory over every assigned work item: derived statuses, default next
// actions, and request/plan linkage. Seeding happens for active tasks only —
// historical work is inventoried without reopening it.
export function preparationInventory(root, { items = [], seed = false, seedContext = null } = {}) {
  let drafts = [];
  try { drafts = planDraftIndex(root); } catch { /* drafts are optional context */ }
  const rows = items.map((item) => {
    let record = readPreparation(root, item.key);
    const active = item.state_category !== "complete";
    if (!record && seed && active) {
      record = seedPreparation(root, item.key, item, seedContext ? seedContext(item) : {});
    }
    const status = derivePreparationStatus(record, item);
    const linked = linkedRequestFor(root, item, drafts);
    return {
      key: item.key, id: item.id, project: item.project, title: item.title, state: item.state,
      state_category: item.state_category, active, changed_at: item.changed_at || null,
      review_status: item.review_status || null,
      prep_status: status,
      open_questions: record ? (record.questions || []).filter((question) => !question.answer).length : 0,
      next_action: (record?.next_action || "").trim() || defaultNextAction(status),
      repositories: record?.repositories || linked?.repositories || [],
      linked_request: linked,
      updated_at: record?.updated_at || null,
    };
  });
  const counts = {};
  for (const row of rows) counts[row.prep_status] = (counts[row.prep_status] || 0) + 1;
  return { items: rows, counts, generated_at: nowIso() };
}
