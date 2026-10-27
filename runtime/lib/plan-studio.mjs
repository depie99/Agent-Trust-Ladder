import fs from "node:fs";
import path from "node:path";
import { paths, loadState } from "./state.mjs";
import { createTaskInWorkspace } from "./task-workspace.mjs";
import { queueAdd, queueCreate, loadQueue, loadQueueBook, saveQueue } from "./queue.mjs";
import { usageGate } from "./usage.mjs";
import { validateContracts } from "./queue-recovery.mjs";

export const PLAN_STAGES = Object.freeze(["intent", "frame", "specify", "route", "plan", "review", "approved"]);
export const PLAN_SCHEMA_VERSION = 1;

function slug(value) {
  return String(value || "intent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "intent";
}

function titleOf(intent) {
  const first = String(intent || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "Untitled ATL task";
  return first.replace(/^#+\s*/, "").slice(0, 120);
}

export function frameIntent(intent, { constraints = [], risks = [], skills = [] } = {}) {
  const text = String(intent || "").trim();
  if (!text) throw new Error("Plan Studio needs an intent");
  return {
    schema: PLAN_SCHEMA_VERSION,
    stage: "frame",
    title: titleOf(text),
    objective: text,
    constraints: [...constraints],
    risks: [...risks],
    completion_checks: ["The requested behavior is observable in a real verification command."],
    acceptance_examples: [{ given: "the bounded task is implemented", when: "the verifier runs", then: "the requested outcome is observed" }],
    selected_skills: [...skills],
    proposed_worker: "pip",
    skill_route: skills.map((skill) => ({ skill, reason: "selected by the manager or ATL route" })),
    implementation_steps: [],
    verifier_commands: [],
    generated_by: "atl-deterministic-frame",
  };
}

export function generateLocalPlan(intent) {
  const frame = frameIntent(intent, { skills: ["atl-frame", "atl-specify", "atl-plan", "atl-implement", "atl-verify"] });
  const goalContext = frame.objective;
  return {
    ...frame,
    stage: "plan",
    constraints: ["Preserve existing project behavior outside the approved scope", "Keep execution behind an explicit owner confirmation"],
    risks: ["State, UI, and runtime behavior may drift unless verified together"],
    completion_checks: [
      "The requested behavior is observable from the real user-facing surface.",
      "Regression checks cover the changed state and interaction contracts.",
      "Failure and recovery behavior remain explicit and auditable.",
    ],
    acceptance_examples: [
      { given: "the requested change is implemented", when: "the owner reviews it against the original request", then: "the stated outcome and constraints can be demonstrated" },
      { given: "a relevant failure or edge case", when: "the change is exercised", then: "the result is checked against the agreed behavior" },
    ],
    proposed_worker: "rowan",
    implementation_steps: [
      { step: "Specify observable behavior and preserve the approved intent", files: ["project specification and affected contracts"], verify: "Review acceptance examples and scope boundaries" },
      { step: "Write or strengthen failing regression checks", files: ["verification/"], verify: "Run the focused tests and observe the intended failure before implementation" },
      { step: "Implement the smallest complete vertical slice", files: ["responsible runtime and UI modules"], verify: "Run the focused tests and inspect the real surface" },
      { step: "Verify recovery, adjacent behavior, and evidence", files: ["runtime evidence and task brief"], verify: "Run the project checks and record observed versus unobserved boundaries" },
    ],
    verifier_commands: ["Not determined: identify actual project-specific checks during review."],
    task_proposals: [
      { id: "p1", source: "local", title: "Specify observable behavior", objective: `Specify observable behavior and preserve the approved intent.\n\nOriginal request:\n${goalContext}`, completion_checks: ["Acceptance examples and scope boundaries are reviewed and recorded"], proposed_worker: "rowan", selected_skills: ["atl-specify"], depends_on: [], files: ["project specification and affected contracts"], verify: "Review acceptance examples and scope boundaries" },
      { id: "p2", source: "local", title: "Write failing regression checks", objective: `Write or strengthen failing regression checks.\n\nOriginal request:\n${goalContext}`, completion_checks: ["Focused tests exist and observed the intended failure before implementation"], proposed_worker: "pip", selected_skills: ["atl-verify"], depends_on: ["p1"], files: ["verification/"], verify: "Run the focused tests and observe the intended failure before implementation" },
      { id: "p3", source: "local", title: "Implement the vertical slice", objective: `Implement the smallest complete vertical slice.\n\nOriginal request:\n${goalContext}`, completion_checks: ["Focused tests pass and the real surface shows the behavior"], proposed_worker: "pip", selected_skills: ["atl-implement"], depends_on: ["p2"], files: ["responsible runtime and UI modules"], verify: "Run the focused tests and inspect the real surface" },
      { id: "p4", source: "local", title: "Verify recovery and evidence", objective: `Verify recovery, adjacent behavior, and evidence.\n\nOriginal request:\n${goalContext}`, completion_checks: ["Project checks pass and observed versus unobserved boundaries are recorded"], proposed_worker: "pip", selected_skills: ["atl-verify"], depends_on: ["p3"], files: ["runtime evidence and task brief"], verify: "Run the project checks and record observed versus unobserved boundaries" },
    ],
    planning_limitations: ["This is a generic planning template. No repository files, project commands, or request-specific acceptance criteria were inspected or verified."],
    generated_by: "atl-local-sdd-tdd-planner",
    generated_via: "local",
  };
}

export function listPlanDrafts(root) {
  const base = path.join(path.dirname(paths(root).state), "plan-studio");
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    try { return loadPlanDraft(root, entry.name); } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.saved_at || "").localeCompare(String(a.saved_at || "")));
}

// Model answers drift around the agreed schema in well-known ways. The
// recognizable variants (acceptance_criteria, scenario/context + action +
// expected/outcome, "Given X when Y then Z" prose, implementation_steps as
// plain strings or description/files-alias objects) are mapped onto the
// canonical shapes BEFORE validation. A shape that is still unrecognizable
// passes through untouched and the validator refuses it — the fidelity gate
// keeps its teeth.
export function normalizeModelArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return artifact;
  const result = { ...artifact };
  const pick = (object, keys) => {
    for (const key of keys) {
      const value = object?.[key];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return null;
  };
  const acceptanceSource = result.acceptance_examples ?? result.acceptance_criteria ?? result.acceptance ?? null;
  if (acceptanceSource != null) {
    const list = Array.isArray(acceptanceSource) ? acceptanceSource : [acceptanceSource];
    result.acceptance_examples = list.map((item) => {
      if (item == null) return item;
      if (typeof item === "string") {
        const prose = /given\s*[:\-]?\s*(.+?)\s*[,\s;]*when\s*[:\-]?\s*(.+?)\s*[,\s;]*then\s*[:\-]?\s*(.+)/i.exec(item);
        if (prose) return { given: prose[1].trim(), when: prose[2].trim(), then: prose[3].trim() };
        return item;
      }
      if (typeof item !== "object") return item;
      const given = pick(item, ["given", "given_when", "scenario", "context", "arrange"]);
      const when = pick(item, ["when", "action", "event", "condition"]);
      const then = pick(item, ["then", "expected", "outcome", "result", "assertion"]);
      if (given && when && then) return { given, when, then };
      return item;
    });
  }
  const stepsSource = result.implementation_steps ?? result.steps ?? null;
  if (stepsSource != null) {
    const list = Array.isArray(stepsSource) ? stepsSource : [stepsSource];
    result.implementation_steps = list.map((item) => {
      if (item == null) return item;
      if (typeof item === "string") {
        const step = item.trim();
        return step ? { step, files: [], verify: "" } : item;
      }
      if (typeof item !== "object") return item;
      const step = pick(item, ["step", "description", "action", "task", "detail", "title"]);
      if (!step) return item;
      const rawFiles = item.files ?? item.paths ?? item.touches ?? item.edits ?? [];
      const files = (Array.isArray(rawFiles) ? rawFiles : String(rawFiles).split(/[,;\n]/)).map((entry) => String(entry).trim()).filter(Boolean);
      const rawVerify = item.verify ?? item.verification ?? item.checks ?? item.check ?? item.evidence ?? "";
      const verify = Array.isArray(rawVerify) ? rawVerify.map((entry) => String(entry).trim()).filter(Boolean).join("; ") : String(rawVerify).trim();
      return { step, files, verify };
    });
  }
  return result;
}

export function validatePlanArtifact(artifact) {
  const required = ["title", "objective", "completion_checks", "acceptance_examples", "implementation_steps", "verifier_commands"];
  const missing = required.filter((key) => !artifact || artifact[key] == null || (Array.isArray(artifact[key]) && artifact[key].length === 0));
  if (missing.length) throw new Error(`Plan artifact missing: ${missing.join(", ")}`);
  if (![artifact.title, artifact.objective].every((value) => typeof value === "string" && value.trim())) throw new Error("title and objective must be non-empty strings");
  if (!Array.isArray(artifact.completion_checks) || !artifact.completion_checks.every((item) => typeof item === "string" && item.trim())) throw new Error("completion_checks must be non-empty strings");
  if (!Array.isArray(artifact.acceptance_examples) || !artifact.acceptance_examples.every((item) => item && [item.given, item.when, item.then].every((value) => typeof value === "string" && value.trim()))) throw new Error("acceptance_examples must contain given/when/then");
  // The gate demands a non-empty step description; files/verify are typed but
  // optional because the normalizer fills them ([]/"") for string-shaped
  // model steps — cards stay editable and the manager adds checks in review.
  if (!Array.isArray(artifact.implementation_steps) || !artifact.implementation_steps.every((item) => item && typeof item === "object" && typeof item.step === "string" && item.step.trim())) throw new Error("implementation_steps must contain non-empty step descriptions");
  if (!Array.isArray(artifact.verifier_commands) || !artifact.verifier_commands.length || !artifact.verifier_commands.every((command) => typeof command === "string" && command.trim())) throw new Error("verifier_commands must be non-empty strings");
  validateProposals(artifact);
  return true;
}

// Typed task proposals: one approvable card per canonical task. Drafts that
// predate the schema (or model output that only returned implementation
// steps) derive their cards 1:1 from implementation_steps, so approval always
// has an ordered, editable card list to work from.
export function normalizeProposals(artifact) {
  const explicit = Array.isArray(artifact?.task_proposals) && artifact.task_proposals.length ? artifact.task_proposals : null;
  const raw = explicit || (Array.isArray(artifact?.implementation_steps) ? artifact.implementation_steps : []).map((step, index) => ({
    id: `p${index + 1}`,
    title: step.step,
    objective: step.step,
    // Steps without a model-supplied verify fall back to the step text as
    // their completion definition — the proposal gate requires one check,
    // and the manager edits it during card review.
    completion_checks: [step.verify || step.step].filter(Boolean),
    proposed_worker: artifact?.proposed_worker || "pip",
    selected_skills: artifact?.selected_skills || [],
    depends_on: index > 0 ? [`p${index}`] : [],
    files: Array.isArray(step.files) ? step.files : [],
    verify: step.verify || "",
  }));
  return raw.map((proposal, index) => ({
    id: String(proposal.id || `p${index + 1}`),
    title: String(proposal.title || proposal.step || `Task ${index + 1}`).trim().slice(0, 240),
    objective: String(proposal.objective || proposal.title || proposal.step || "").trim(),
    completion_checks: (Array.isArray(proposal.completion_checks) ? proposal.completion_checks : [proposal.verify].filter(Boolean)).map((item) => String(item).trim()).filter(Boolean),
    proposed_worker: String(proposal.proposed_worker || artifact?.proposed_worker || "pip").trim() || "pip",
    selected_skills: (Array.isArray(proposal.selected_skills) ? proposal.selected_skills : []).map((item) => String(item).trim()).filter(Boolean),
    depends_on: (Array.isArray(proposal.depends_on) ? proposal.depends_on : []).map((item) => String(item).trim()).filter(Boolean),
    check_owners: proposal.check_owners || {},
    dispatch_contract: proposal.dispatch_contract || {},
    files: (Array.isArray(proposal.files) ? proposal.files : []).map((item) => String(item).trim()).filter(Boolean),
    verify: String(proposal.verify || "").trim(),
    revision: Number(proposal.revision) || 1,
    source: String(proposal.source || (explicit ? "model" : "local")),
    feedback: Array.isArray(proposal.feedback) ? proposal.feedback : [],
    revisions: Array.isArray(proposal.revisions) ? proposal.revisions : [],
    // The generated plan's original worker/skill choice. The Studio badges
    // fields still at their default and lets the manager snap back to it;
    // manager edits never touch this record, regeneration re-baselines it.
    // First seen without one → the current values ARE the baseline.
    defaults: {
      proposed_worker: String((proposal.defaults && proposal.defaults.proposed_worker) || proposal.proposed_worker || artifact?.proposed_worker || "pip").trim() || "pip",
      selected_skills: ((proposal.defaults && Array.isArray(proposal.defaults.selected_skills) ? proposal.defaults.selected_skills : null) || (Array.isArray(proposal.selected_skills) ? proposal.selected_skills : []))
        .map((item) => String(item).trim()).filter(Boolean),
    },
  }));
}

function validateProposals(artifact) {
  const explicit = Array.isArray(artifact?.task_proposals) && artifact.task_proposals.length;
  const proposals = normalizeProposals(artifact);
  if (explicit && !proposals.length) throw new Error("task_proposals must not be empty when present");
  const ids = new Set();
  for (const [index, proposal] of proposals.entries()) {
    if (!proposal.id || !proposal.title) throw new Error(`task proposal ${index + 1} needs an id and a title`);
    if (ids.has(proposal.id)) throw new Error(`task proposal ids must be unique (${proposal.id} repeats)`);
    ids.add(proposal.id);
    if (!proposal.completion_checks.length) throw new Error(`task proposal ${proposal.id} needs at least one completion check`);
    if (!proposal.objective) throw new Error(`task proposal ${proposal.id} needs an objective`);
  }
  for (const proposal of proposals) {
    for (const dep of proposal.depends_on) {
      if (dep === proposal.id) throw new Error(`task proposal ${proposal.id} cannot depend on itself`);
      if (!ids.has(dep)) throw new Error(`task proposal ${proposal.id} depends on unknown proposal ${dep}`);
    }
  }
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  function visit(proposal) {
    if (visiting.has(proposal.id)) throw new Error(`task proposal dependency cycle includes ${proposal.id}`);
    if (visited.has(proposal.id)) return;
    visiting.add(proposal.id);
    for (const dep of proposal.depends_on) visit(byId.get(dep));
    visiting.delete(proposal.id);
    visited.add(proposal.id);
    ordered.push(proposal);
  }
  for (const proposal of proposals) visit(proposal);
  return ordered;
}

function nextProposalId(proposals) {
  let max = 0;
  for (const proposal of proposals) {
    const match = /^p(\d+)$/.exec(proposal.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `p${max + 1}`;
}

function loadEditableDraft(root, draft) {
  const loaded = typeof draft === "string" ? loadPlanDraft(root, draft) : draft;
  if (loaded.stage === "approved") throw new Error("an approved draft is closed to card edits — create a new plan instead");
  return loaded;
}

function persistArtifact(root, loaded, artifact, envelopePatch = {}) {
  const file = path.join(loaded.dir, "artifact.json");
  const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
  envelope.artifact = artifact;
  envelope.saved_at = new Date().toISOString();
  for (const [key, value] of Object.entries(envelopePatch)) envelope[key] = value;
  fs.writeFileSync(file, JSON.stringify(envelope, null, 2) + "\n");
  return { ...loaded, artifact, saved_at: envelope.saved_at };
}

function cloneArtifact(loaded) {
  return JSON.parse(JSON.stringify(loaded.artifact || {}));
}

const ARRAY_FIELDS = new Set(["completion_checks", "selected_skills", "depends_on", "files"]);
const asArray = (field, value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    if (field === "completion_checks") return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    return value.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
  }
  throw new Error(`${field} must be a list`);
};

// Manager card edits are validated in full before anything is written, so a
// rejected edit always leaves the last valid draft on disk untouched. Field
// aliases match the CLI flags (worker/skills/checks/depends-on).
const FIELD_ALIASES = { worker: "proposed_worker", skills: "selected_skills", checks: "completion_checks", "depends-on": "depends_on" };
export function editProposal(root, draft, proposalId, patch = {}) {
  const loaded = loadEditableDraft(root, draft);
  const artifact = cloneArtifact(loaded);
  const proposals = normalizeProposals(artifact);
  const index = proposals.findIndex((proposal) => proposal.id === proposalId);
  if (index < 0) throw new Error(`task proposal ${proposalId} not found in draft ${loaded.id}`);
  const prior = proposals[index];
  const next = { ...prior };
  for (const [rawField, value] of Object.entries(patch || {})) {
    const field = FIELD_ALIASES[rawField] || rawField;
    if (value === undefined) continue;
    if (field === "title" || field === "objective" || field === "verify" || field === "proposed_worker") {
      const text = String(value).trim();
      if (!text && field !== "verify") throw new Error(`proposal ${field} must not be empty`);
      next[field] = field === "title" ? text.slice(0, 240) : text;
    } else if (ARRAY_FIELDS.has(field)) {
      next[field] = asArray(field, value);
    } else if (field !== "id" && field !== "revision" && field !== "source" && field !== "revisions" && field !== "feedback") {
      throw new Error(`unknown proposal field ${field}`);
    }
  }
  if (!next.title || !next.objective || !next.completion_checks.length) throw new Error(`proposal ${proposalId} still needs a title, objective, and at least one completion check`);
  const others = new Set(proposals.filter((proposal) => proposal.id !== proposalId).map((proposal) => proposal.id));
  for (const dep of next.depends_on) {
    if (dep === proposalId) throw new Error(`task proposal ${proposalId} cannot depend on itself`);
    if (!others.has(dep)) throw new Error(`task proposal ${proposalId} depends on unknown proposal ${dep}`);
  }
  next.revision = prior.revision + 1;
  next.source = "manager-edit";
  next.revisions = [...prior.revisions, { rev: prior.revision, at: new Date().toISOString(), source: prior.source, proposal: prior }];
  proposals[index] = next;
  artifact.task_proposals = proposals;
  return persistArtifact(root, loaded, artifact);
}

export function addProposal(root, draft, patch = {}) {
  const loaded = loadEditableDraft(root, draft);
  const artifact = cloneArtifact(loaded);
  const proposals = normalizeProposals(artifact);
  const id = nextProposalId(proposals);
  proposals.push({
    id,
    title: String(patch.title || "New task card").trim().slice(0, 240),
    objective: String(patch.objective || patch.title || "Describe the bounded outcome for this card.").trim(),
    completion_checks: asArray("completion_checks", patch.completion_checks ?? "The bounded outcome is observable in a real verification command."),
    proposed_worker: String(patch.proposed_worker || "pip").trim() || "pip",
    selected_skills: asArray("selected_skills", patch.selected_skills ?? []),
    depends_on: [],
    files: asArray("files", patch.files ?? []),
    verify: String(patch.verify || "").trim(),
    revision: 1,
    source: "manager-edit",
    feedback: [],
    revisions: [],
  });
  const created = proposals.at(-1);
  created.defaults = { proposed_worker: created.proposed_worker, selected_skills: [...created.selected_skills] };
  artifact.task_proposals = proposals;
  return persistArtifact(root, loaded, artifact);
}

export function removeProposal(root, draft, proposalId) {
  const loaded = loadEditableDraft(root, draft);
  const artifact = cloneArtifact(loaded);
  const proposals = normalizeProposals(artifact);
  const index = proposals.findIndex((proposal) => proposal.id === proposalId);
  if (index < 0) throw new Error(`task proposal ${proposalId} not found in draft ${loaded.id}`);
  if (proposals.length === 1) throw new Error("a plan needs at least one task card — edit it instead of removing the last one");
  proposals.splice(index, 1);
  for (const proposal of proposals) proposal.depends_on = proposal.depends_on.filter((dep) => dep !== proposalId);
  artifact.task_proposals = proposals;
  return persistArtifact(root, loaded, artifact);
}

export function reorderProposals(root, draft, proposalId, position) {
  const loaded = loadEditableDraft(root, draft);
  const artifact = cloneArtifact(loaded);
  const proposals = normalizeProposals(artifact);
  const index = proposals.findIndex((proposal) => proposal.id === proposalId);
  if (index < 0) throw new Error(`task proposal ${proposalId} not found in draft ${loaded.id}`);
  const [moved] = proposals.splice(index, 1);
  const target = Math.max(0, Math.min(proposals.length, Number(position) || 0));
  proposals.splice(target, 0, moved);
  artifact.task_proposals = proposals;
  return persistArtifact(root, loaded, artifact);
}

export function addProposalFeedback(root, draft, proposalId, text) {
  const prompt = String(text || "").trim();
  if (!prompt) throw new Error("card feedback needs a prompt");
  const loaded = loadEditableDraft(root, draft);
  const artifact = cloneArtifact(loaded);
  const proposals = normalizeProposals(artifact);
  const proposal = proposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error(`task proposal ${proposalId} not found in draft ${loaded.id}`);
  proposal.feedback = [...(proposal.feedback || []), { at: new Date().toISOString(), text: prompt }];
  artifact.task_proposals = proposals;
  return persistArtifact(root, loaded, artifact);
}

// One bounded model call regenerates ONE card. The prior version is kept in
// the card's revision history, every other card is untouched, and any failure
// (refused call, timeout, malformed JSON) leaves the draft exactly as it was.
export async function regenerateProposal(root, draft, proposalId, { invoke, confirm = false, budget = null, provider = null, model = null, role = "pip" } = {}) {
  if (!confirm) throw new Error("Plan Studio provider calls require explicit confirmation");
  if (typeof invoke !== "function") throw new Error("Plan Studio needs a provider invoke function");
  if (budget) {
    const gate = usageGate(budget);
    if (!gate.ok) throw new Error(`Plan Studio provider call refused: ${gate.reason}`);
  }
  const loaded = loadEditableDraft(root, draft);
  const artifact = cloneArtifact(loaded);
  const proposals = normalizeProposals(artifact);
  const index = proposals.findIndex((proposal) => proposal.id === proposalId);
  if (index < 0) throw new Error(`task proposal ${proposalId} not found in draft ${loaded.id}`);
  const prior = proposals[index];
  const request = {
    schema: PLAN_SCHEMA_VERSION,
    task: "Regenerate exactly one ATL task proposal using the manager feedback.",
    intent: loaded.intent,
    current_proposal: prior,
    feedback: prior.feedback || [],
    required: ["title", "objective", "completion_checks", "proposed_worker", "selected_skills", "depends_on", "files", "verify"],
    rule: "Return JSON only: a single proposal object. Never change other tasks. Do not claim checks passed or execute anything.",
  };
  const logPath = path.join(loaded.dir, "provider.log");
  const response = await invoke({ root, role, request, logPath });
  if (!response || response.code !== 0) throw new Error(`Plan provider failed (code ${response?.code ?? "unknown"})`);
  const text = String(response.text || response.output || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let returned;
  try { returned = JSON.parse(text); } catch { throw new Error("Plan provider did not return valid JSON"); }
  const body = returned && typeof returned === "object" && returned.proposal && typeof returned.proposal === "object" ? returned.proposal : returned;
  const next = {
    ...prior,
    title: String(body.title || prior.title).trim().slice(0, 240) || prior.title,
    objective: String(body.objective || prior.objective).trim(),
    completion_checks: asArray("completion_checks", body.completion_checks ?? body.verify ?? prior.completion_checks),
    proposed_worker: String(body.proposed_worker || prior.proposed_worker).trim() || prior.proposed_worker,
    selected_skills: asArray("selected_skills", body.selected_skills ?? prior.selected_skills),
    depends_on: (Array.isArray(body.depends_on) ? body.depends_on : prior.depends_on).map((item) => String(item).trim()).filter((dep) => dep !== proposalId && proposals.some((item) => item.id === dep)),
    files: asArray("files", body.files ?? prior.files),
    verify: String(body.verify || prior.verify || "").trim(),
  };
  if (!next.title || !next.objective || !next.completion_checks.length) throw new Error("Plan provider returned an incomplete task proposal");
  next.revision = prior.revision + 1;
  next.source = "model";
  // The regenerated model output is the new baseline: its worker/skills are
  // what "default" means for this card from now on.
  next.defaults = { proposed_worker: next.proposed_worker, selected_skills: [...next.selected_skills] };
  next.revisions = [...prior.revisions, { rev: prior.revision, at: new Date().toISOString(), source: prior.source, proposal: prior }];
  proposals[index] = next;
  artifact.task_proposals = proposals;
  return persistArtifact(root, loaded, artifact, {
    provider: response.provider || provider || loaded.provider || null,
    model: response.model || model || loaded.model || null,
    last_regenerated: { proposal_id: proposalId, at: new Date().toISOString() },
  });
}

// Honest labelling: the Studio never presents a local structural draft as a
// model plan or the other way around.
export function planDraftLabel(loaded) {
  const via = loaded.generated_via || (loaded.provider ? "provider" : "local");
  const provider = loaded.provider || null;
  const model = loaded.model || null;
  return via === "provider"
    ? { mode: "model", label: `Model plan · ${provider || "provider"}${model ? ` / ${model}` : ""}`, provider, model, generated_at: loaded.saved_at || null }
    : { mode: "local", label: "Local structural draft · deterministic, not model output", provider: null, model: null, generated_at: loaded.saved_at || null };
}

// Stage-specific schema gates for the intermediate SDD artifacts. A frame
// stays deliberately incomplete, a specify artifact must bound the behavior
// with observable acceptance examples, and a route artifact must name the
// skills, worker, and provider before anything plans implementation steps.
export function validateStageArtifact(stage, artifact) {
  if (stage === "frame") {
    if (!artifact || !artifact.title || !artifact.objective) throw new Error("frame artifact needs title and objective");
    return true;
  }
  if (stage === "specify") {
    const required = ["title", "objective", "completion_checks", "acceptance_examples", "in_scope", "out_of_scope"];
    const missing = required.filter((key) => !artifact || artifact[key] == null || (Array.isArray(artifact[key]) && artifact[key].length === 0));
    if (missing.length) throw new Error(`specify artifact missing: ${missing.join(", ")}`);
    if (!Array.isArray(artifact.acceptance_examples) || !artifact.acceptance_examples.every((item) => item && item.given && item.when && item.then)) {
      throw new Error("specify acceptance_examples must contain given/when/then");
    }
    if (!Array.isArray(artifact.completion_checks) || !artifact.completion_checks.every((item) => typeof item === "string" && item.trim())) {
      throw new Error("specify completion_checks must be non-empty strings");
    }
    return true;
  }
  if (stage === "route") {
    const required = ["title", "objective", "selected_skills", "skill_route", "proposed_worker"];
    const missing = required.filter((key) => !artifact || artifact[key] == null || (Array.isArray(artifact[key]) && artifact[key].length === 0));
    if (missing.length) throw new Error(`route artifact missing: ${missing.join(", ")}`);
    if (!Array.isArray(artifact.skill_route) || !artifact.skill_route.every((item) => item && item.skill && item.reason)) {
      throw new Error("skill_route must contain skill/reason entries");
    }
    return true;
  }
  if (["plan", "review", "approved"].includes(stage)) return validatePlanArtifact(artifact);
  throw new Error(`unknown plan stage ${stage}`);
}

function stageDir(draft) {
  return typeof draft === "string" ? null : draft.dir || null;
}

function readStages(root, draft) {
  const dir = stageDir(draft);
  if (!dir) return [];
  const stages = [];
  for (const name of PLAN_STAGES) {
    const file = path.join(dir, `stage-${name}.json`);
    if (fs.existsSync(file)) {
      try { stages.push(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { /* a torn stage file never blocks the studio */ }
    }
  }
  return stages;
}

// Persist the next SDD stage for an existing draft. The raw intent file is
// never rewritten; each stage lands in its own schema-checked file so the
// chain intent → frame → specify → route → plan stays auditable.
export function advanceStage(root, draft, stage, patch = {}) {
  if (!PLAN_STAGES.includes(stage)) throw new Error(`unknown plan stage ${stage}`);
  const loaded = typeof draft === "string" ? loadPlanDraft(root, draft) : draft;
  if (loaded.stage === "approved") throw new Error("an approved draft is closed to new stages");
  const artifact = {
    ...(loaded.artifact || {}),
    title: loaded.artifact?.title || titleOf(loaded.intent),
    objective: loaded.artifact?.objective || loaded.intent,
    ...patch,
    stage,
  };
  validateStageArtifact(stage, artifact);
  const dir = loaded.dir;
  fs.writeFileSync(path.join(dir, `stage-${stage}.json`), JSON.stringify({ schema: PLAN_SCHEMA_VERSION, stage, artifact, saved_at: new Date().toISOString() }, null, 2) + "\n");
  if (["plan", "review", "approved"].includes(stage)) {
    const envelope = JSON.parse(fs.readFileSync(path.join(dir, "artifact.json"), "utf8"));
    envelope.stage = stage;
    envelope.artifact = artifact;
    envelope.saved_at = new Date().toISOString();
    fs.writeFileSync(path.join(dir, "artifact.json"), JSON.stringify(envelope, null, 2) + "\n");
  }
  return { ...loaded, stage, artifact, stages: readStages(root, { dir }) };
}

export function savePlanDraft(root, { intent, artifact, stage = "plan", id = null } = {}) {
  if (!intent) throw new Error("plan draft needs intent");
  // Every persisted stage is schema-checked: frames stay deliberately
  // incomplete, specify/route artifacts must bound behavior and route, and
  // only a plan that claims review/approval may be a complete final artifact.
  validateStageArtifact(stage, artifact || null);
  const draftId = id || `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(artifact?.title || intent)}`;
  const dir = path.join(path.dirname(paths(root).state), "plan-studio", draftId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "intent.md"), String(intent).trimEnd() + "\n");
  fs.writeFileSync(path.join(dir, "artifact.json"), JSON.stringify({ schema: PLAN_SCHEMA_VERSION, stage, artifact: artifact || null, saved_at: new Date().toISOString() }, null, 2) + "\n");
  return { id: draftId, dir, intentPath: path.join(dir, "intent.md"), artifactPath: path.join(dir, "artifact.json"), stage, artifact: artifact || null };
}

export function loadPlanDraft(root, id) {
  const dir = path.join(path.dirname(paths(root).state), "plan-studio", id);
  const file = path.join(dir, "artifact.json");
  if (!fs.existsSync(file)) throw new Error(`Unknown plan draft ${id}`);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return { ...saved, id, dir, intent: fs.readFileSync(path.join(dir, "intent.md"), "utf8") };
}

// A plan queue id is derived deterministically from the draft, so re-approval
// always finds the same queue instead of duplicating workstreams.
function planQueueId(loaded) {
  const title = String(loaded.artifact?.title || loaded.intent || "plan");
  // Queue ids are capped at 32 chars (queueCreate) — 5 + 17 + 1 + 6 = 29.
  return `plan-${slug(title).slice(0, 17) || "draft"}-${String(loaded.id).replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase()}`;
}

export function approvePlanDraft(root, draft, { note = "approved by manager in Plan Studio" } = {}) {
  const loaded = typeof draft === "string" ? loadPlanDraft(root, draft) : draft;
  const artifact = loaded.artifact;
  validatePlanArtifact(artifact);
  const proposals = validateProposals(artifact);
  validateContracts(Object.fromEntries(proposals.map((proposal) => [proposal.id, proposal])));
  const state = loadState(root);
  const existing = Object.values(state.tasks).filter((task) => task.plan_draft_id === loaded.id);
  if (existing.length) {
    const ordered = proposals.flatMap((proposal) => existing.filter((task) => task.plan_proposal_id === proposal.id));
    const taskIds = (ordered.length ? ordered : existing).map((task) => task.id);
    return { task: taskIds.length ? state.tasks[taskIds[0]] : null, tasks: taskIds.map((id) => state.tasks[id]), taskIds, queueId: existing[0].plan_queue_id || null, created: false, draft: loaded };
  }
  // Approval creates the dedicated Plan Queue plus one ordered canonical task
  // per card — membership only, never execution. Execution still needs the
  // queue preview and an explicit run confirmation.
  const queueId = planQueueId(loaded);
  const book = loadQueueBook(root);
  if (!book.queues[queueId]) {
    queueCreate(root, queueId, {
      name: String(artifact.title || "Plan").slice(0, 60),
      provider: loaded.provider ? `${loaded.provider}${loaded.model ? `/${loaded.model}` : ""}` : null,
    });
    const queue = loadQueue(root, queueId);
    queue.plan_draft_id = loaded.id;
    saveQueue(root, queue);
  }
  const createdIds = new Map();
  for (const proposal of proposals) {
    const task = createTaskInWorkspace(root, {
      title: proposal.title,
      objective: proposal.objective || artifact.objective,
      completion_checks: proposal.completion_checks,
      risk: artifact.risk || "normal",
      labels: [...new Set([...(artifact.labels || []), "plan-studio"])],
      selected_skills: proposal.selected_skills || [],
      proposed_worker: proposal.proposed_worker || "pip",
      skill_route: artifact.skill_route || null,
      source: { type: "plan-studio", draft_id: loaded.id, proposal_id: proposal.id },
    });
    const nextState = loadState(root);
    const stored = nextState.tasks[task.id];
    stored.plan_draft_id = loaded.id;
    stored.plan_proposal_id = proposal.id;
    stored.plan_queue_id = queueId;
    stored.plan_artifact_path = loaded.artifactPath;
    stored.plan_approval_note = note;
    stored.plan_depends_on = (proposal.depends_on || []).map((dep) => createdIds.get(dep)).filter(Boolean);
    stored.dispatch_contract = proposal.dispatch_contract;
    stored.check_owners = Object.fromEntries(Object.entries(proposal.check_owners || {}).map(([check, owner]) => [check, createdIds.get(owner) || (owner === proposal.id ? task.id : owner)]));
    if (proposal.id === proposals.at(-1).id) {
      stored.integrated_delivery = true;
      stored.integrated_checks = [...new Set(proposals.flatMap((item) => item.completion_checks))];
      stored.plan_depends_on = [...createdIds.values()];
      stored.review_required = true;
    }
    nextState.updated_at = new Date().toISOString();
    nextState.log.push({ at: new Date().toISOString(), task: task.id, actor: "manager", event: "plan_approve", detail: `${note} (card ${proposal.id}, rev ${proposal.revision})` });
    fs.writeFileSync(paths(root).state + ".tmp", JSON.stringify(nextState, null, 2) + "\n");
    fs.renameSync(paths(root).state + ".tmp", paths(root).state);
    queueAdd(root, task.id, { queueId });
    createdIds.set(proposal.id, task.id);
  }
  const after = loadState(root);
  const taskIds = proposals.map((proposal) => createdIds.get(proposal.id)).filter(Boolean);
  return { task: after.tasks[taskIds[0]], tasks: taskIds.map((id) => after.tasks[id]), taskIds, queueId, created: true, draft: loaded };
}

export async function runPlanProvider(root, intent, { role = "pip", provider, confirm = false, invoke, draftId = null, budget = null } = {}) {
  if (!confirm) throw new Error("Plan Studio provider calls require explicit confirmation");
  if (typeof invoke !== "function") throw new Error("Plan Studio needs a provider invoke function");
  // Usage gate: an exhausted local budget blocks the provider call before any
  // spend; an unknown remote quota never blocks (it is surfaced, not guessed).
  if (budget) {
    const gate = usageGate(budget);
    if (!gate.ok) throw new Error(`Plan Studio provider call refused: ${gate.reason}`);
  }
  const request = {
    schema: PLAN_SCHEMA_VERSION,
    task: "Convert the intent into an evidence-gated ATL SDD/TDD plan.",
    intent: String(intent).trim(),
    required: ["title", "objective", "constraints", "risks", "completion_checks", "acceptance_examples", "selected_skills", "proposed_worker", "implementation_steps", "verifier_commands"],
    rule: "Return JSON only. acceptance_examples must be a list of objects, each with non-empty string fields given, when, then. implementation_steps must be a list of objects, each with non-empty string step, string-array files, string verify. Each task must have independently satisfiable completion checks. A prerequisite task must never require implementation owned by one of its downstream dependents; put integration checks on the integration task. Declare all dependencies explicitly and without cycles. Ground proposed paths and verification commands in inspected project evidence when available; otherwise label them as unknown and do not invent commands. Preserve the original request and constraints. Separate assumptions from observed facts. Do not claim checks passed. Do not execute commands or change files.",
  };
  const id = draftId || `${Date.now()}-${slug(titleOf(intent))}`;
  const logPath = path.join(path.dirname(paths(root).state), "plan-studio", id, "provider.log");
  // Post-invoke failures carry the transcript path so the browser can offer
  // the raw model response next to the error message.
  // A schema-rejected response stays review-only, but its complete text is
  // retained on the error so Card 03 can show the attempted plan in full.
  // It is never saved as an approvable draft.
  const withLog = (message, providerResponse = null) => Object.assign(new Error(message), { providerLogPath: logPath, providerResponse });
  const response = await invoke({ root, role, request, logPath });
  if (!response || response.code !== 0) throw withLog(`Plan provider failed (code ${response?.code ?? "unknown"})`, response?.text || response?.output || null);
  const text = String(response.text || response.output || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let artifact;
  try { artifact = JSON.parse(text); } catch { throw withLog("Plan provider did not return valid JSON", text); }
  try {
    validatePlanArtifact(normalizeModelArtifact(artifact));
  } catch (error) {
    throw withLog(error.message, text);
  }
  // Model output that only returned implementation steps still gets typed,
  // editable task cards (1:1 from the steps) before anything is persisted —
  // and every card from a provider plan is honestly labelled model output.
  artifact = normalizeModelArtifact(artifact);
  artifact.task_proposals = normalizeProposals(artifact).map((proposal) => ({ ...proposal, source: "model" }));
  const draft = savePlanDraft(root, { intent, artifact, stage: "plan", id });
  // Skill/provider/model selection stays visible on the draft: the manager
  // approves knowing exactly who planned it and through which provider.
  const envelope = JSON.parse(fs.readFileSync(draft.artifactPath, "utf8"));
  envelope.provider = response.provider || provider || null;
  envelope.model = response.model || null;
  envelope.role = role;
  envelope.generated_via = response.provider ? "provider" : "custom-invoke";
  fs.writeFileSync(draft.artifactPath, JSON.stringify(envelope, null, 2) + "\n");
  return { ...draft, provider: envelope.provider, model: envelope.model, role };
}
