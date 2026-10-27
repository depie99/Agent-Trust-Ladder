// The control room's composition path: free text or imported candidates in,
// canonical ATL tasks out. Everything here is deterministic local capture —
// the TUI renderer never calls an LLM. Semantic normalization remains Pip's
// job through a bounded provider session (`atl run <id>`), exactly as the
// 014 brief assumes.
//
// Two entry points share one apply loop:
//   composeTask       — natural-language text from the manager (immutable
//                       raw draft saved first; idempotent by content hash)
//   importCandidates  — read-only candidates from file/GitHub/Azure adapters
//                       (idempotent by the adapter's intake_key)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths, createTask, logEvent } from "./state.mjs";
import { parseIntakeFile } from "./intake.mjs";
import { post as feedPost } from "./feed.mjs";
import { routeTask } from "./skill-router.mjs";
import { addResourceToTask } from "./resources.mjs";

export class ComposerError extends Error {}

const say = (root, from, text, opts = {}) => feedPost(root, { from, text, ...opts });

// Deterministic free-text → intake candidate. Reuses the inbox file grammar
// (## title, @priority/@risk/@source meta, `Checks:` bullets) so a composed
// task and an inbox task normalize identically.
export function normalizeDraftText(raw, { source = "manual" } = {}) {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new ComposerError("compose needs some text");
  const lines = text.split("\n");
  const first = lines[0].trim();
  const synthetic = /^#{2,3}\s+\S/.test(first) ? text : `## ${first}\n${lines.slice(1).join("\n")}`;
  const parsed = parseIntakeFile(synthetic, "composer");
  if (!parsed.length) throw new ComposerError("could not read a task title from the first line");
  const candidate = parsed[0];
  // Idempotency: same text never creates a second task.
  const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
  candidate.intake_key = `composer:${hash}`;
  candidate.source = {
    type: source === "manual" ? "manual" : source,
    url: "",
    thread: "control room composer",
    excerpt: first.slice(0, 300),
  };
  return candidate;
}

// The raw draft is immutable: new text always gets a new file, so no manager
// wording is ever lost (brief OPEN-003). Returns the absolute draft path.
export function saveDraft(root, { text, source = "manual", intakeKey }) {
  const day = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(11, 19);
  const slug = String(text).split("\n")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "draft";
  const dir = path.join(path.dirname(paths(root).state), "drafts", day);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp}-${slug}.md`);
  const frontmatter = [
    "---",
    `intake_key: ${intakeKey}`,
    `source: ${source}`,
    `created_at: ${new Date().toISOString()}`,
    "---",
    "",
  ].join("\n");
  fs.writeFileSync(file, frontmatter + String(text).replace(/\r\n/g, "\n").trim() + "\n");
  return file;
}

// ---- routines (moved from the CLI so intake and the composer share them)

export function matchRoutine(routines, cand) {
  for (const r of routines || []) {
    const w = r.when || {};
    if (w.source && cand.source.type !== w.source) continue;
    if (w.keyword) {
      const hay = `${cand.title} ${cand.objective_hint || ""}`.toLowerCase();
      if (!hay.includes(String(w.keyword).toLowerCase())) continue;
    }
    if (w.label && !(cand.labels || []).some((l) => String(l).toLowerCase() === String(w.label).toLowerCase())) continue;
    if (w.type && !cand.title.toLowerCase().startsWith(String(w.type).toLowerCase())) continue;
    return r;
  }
  return null;
}

export function applyRoutine(task, routine) {
  const then = routine.then || {};
  if (then.priority) task.priority = then.priority;
  if (then.risk) {
    task.risk = then.risk === "risky" ? "risky" : "normal";
    if (task.risk === "risky") task.review_required = true;
  }
  if (then.assign_to) {
    task.assigned_worker = then.assign_to;
    task.auto_route = routine.name; // the runner kicks the worker as soon as triage lands
  }
  task.decision_log.push({ at: new Date().toISOString(), rule: `routine:${routine.name}` });
}

// Deterministic skill route — the only routing the TUI may trigger. The
// Jev (LLM) decision stays a CLI `--smart` opt-in in `triage`/`route`.
export function applyDeterministicRoute(root, task) {
  const route = routeTask(root, {
    title: task.title,
    objective: [task.objective, task.objective_hint].filter(Boolean).join(" "),
    labels: task.labels,
    source: task.source,
  });
  task.selected_skills = route.selected_skills;
  task.proposed_worker = route.proposed_worker;
  task.skill_route = route;
  task.decision_log.push({ at: new Date().toISOString(), route: route.source, skills: route.selected_skills });
  return route;
}

// Apply read-only candidates into state (shared by `atl intake` and the TUI
// import screen). Mutates `state`; the caller saves. Idempotent by intake_key.
export function importCandidates(root, state, candidates, { cfg = {} } = {}) {
  const created = [];
  let added = 0;
  let skipped = 0;
  for (const cand of candidates || []) {
    if (!cand || !cand.title || !cand.intake_key) continue;
    const dup = Object.values(state.tasks).find((t) => t.intake_key && t.intake_key === cand.intake_key);
    if (dup) { skipped++; continue; }
    const t = createTask(state, {
      title: cand.title,
      source: cand.source,
      priority: cand.priority,
      risk: cand.risk,
      labels: cand.labels,
      intake_key: cand.intake_key,
      resources: [],
    });
    for (const resource of cand.resources || []) {
      addResourceToTask(root, t, resource.ref, {
        label: resource.label,
        caption: resource.caption,
        kind: resource.kind,
        source: resource.source || cand.source?.type || "manual",
      });
    }
    if (cand.objective_hint) t.objective_hint = cand.objective_hint;
    if (cand.completion_checks.length) t.completion_checks = cand.completion_checks; // pre-filled; Pip still owns triage
    const routine = matchRoutine(cfg.routines, cand);
    if (routine) applyRoutine(t, routine);
    const route = applyDeterministicRoute(root, t);
    logEvent(state, { task: t.id, actor: "runner", event: "intake", detail: `${cand.source.type}: ${cand.title}` });
    const ref = cand.source.url || cand.title;
    say(root, "pip", `grabbing ${ref} — "${cand.title}". pulling ${cand.source.type} + thread, then queuing triage.`, { task: t.id });
    if (routine?.then?.assign_to) {
      say(root, "mira", `${t.id} pre-routed to ${routine.then.assign_to} by routine "${routine.name}". kicks when triage lands.`, { task: t.id });
    }
    say(root, "pip", `${t.id} skill route: ${route.selected_skills.join(", ") || "unresolved"} (${route.status}).`, { task: t.id });
    created.push({ task: t, routine, route });
    added++;
  }
  return { added, skipped, created };
}

// Natural-language compose: draft first (nothing lost), then the canonical
// task. Returns the existing task unchanged when the same text was already
// composed. `task.source.url` points at the draft so the dashboard's Enter
// view opens the manager's verbatim wording.
export function composeTask(root, state, text, { source = "manual", cfg = {} } = {}) {
  const candidate = normalizeDraftText(text, { source });
  const existing = Object.values(state.tasks).find((t) => t.intake_key && t.intake_key === candidate.intake_key);
  if (existing) return { task: existing, created: false, draftPath: null };
  const draftPath = saveDraft(root, { text, source, intakeKey: candidate.intake_key });
  candidate.source.url = draftPath;
  const { created } = importCandidates(root, state, [candidate], { cfg });
  return { task: created[0].task, created: true, draftPath };
}
