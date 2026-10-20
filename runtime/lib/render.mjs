// Renderers: manager brief (Mira), task views, and the wake-loop action list.

import fs from "node:fs";
import path from "node:path";
import { paths } from "./state.mjs";

const AGE = (iso) => {
  if (!iso) return "?";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };

export function activeTasks(state) {
  return Object.values(state.tasks)
    .filter((t) => !["done", "rejected"].includes(t.status))
    .sort((a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2) ||
      a.id.localeCompare(b.id));
}

// The wake loop: what Mira should do next, in order. Pure read of state.
export function wakeActions(state, cfg) {
  const actions = [];
  const budgets = cfg.budgets || {};
  const staleHours = budgets.stale_after_hours ?? 24;
  const maxActive = budgets.max_active_tasks ?? 5;

  for (const t of activeTasks(state)) {
    if (t.status === "new") {
      actions.push({ task: t.id, for: "pip", what: `triage "${t.title}" (new, priority ${t.priority})` });
    }
    if (t.status === "triaged" && !t.assigned_worker) {
      actions.push({ task: t.id, for: "mira", what: `assign "${t.title}" (triaged, unassigned)` });
    }
    if (t.status === "assigned" && !t.workspace) {
      actions.push({ task: t.id, for: "mira", what: `create workspace for ${t.id} before ${t.assigned_worker} starts` });
    }
    if (["assigned", "in_progress"].includes(t.status)) {
      const last = t.last_checkpoint?.at || t.updated_at;
      const hours = (Date.now() - new Date(last).getTime()) / 3600000;
      if (hours >= staleHours) {
        actions.push({ task: t.id, for: "beacon", what: `${t.id} is stale (${AGE(last)} since checkpoint) — recheck or set a wake timer` });
      } else if (t.status === "assigned") {
        actions.push({ task: t.id, for: t.assigned_worker, what: `start "${t.title}" (assigned, idle ${AGE(last)})` });
      }
    }
    if (t.status === "in_review") {
      actions.push({ task: t.id, for: "sage", what: `independent review of ${t.id}` });
    }
    if (t.status === "verifying") {
      actions.push({ task: t.id, for: "beacon", what: `verify finish conditions of ${t.id}` });
    }
    if (t.status === "blocked") {
      const due = t.next_wake_at ? new Date(t.next_wake_at) : null;
      if (!due || due <= new Date()) {
        actions.push({ task: t.id, for: "mira", what: `blocked: ${t.blocker?.reason || "?"} — retry timer due, re-route or escalate` });
      } else {
        actions.push({ task: t.id, for: "beacon", what: `wakes ${due.toISOString()} (${t.blocker?.reason || "?"})` });
      }
    }
    if (t.status === "escalated") {
      actions.push({ task: t.id, for: "manager", what: `ESCALATED — needs your decision: ${t.blocker?.reason || "?"}` });
    }
    if (t.attempt_count >= (budgets.max_attempts ?? 3) && !["done", "rejected", "escalated"].includes(t.status)) {
      actions.push({ task: t.id, for: "mira", what: `${t.id} hit the attempt budget (${t.attempt_count}) — escalate or change approach` });
    }
  }

  const inFlight = activeTasks(state).filter((t) => ["assigned", "in_progress", "in_review", "verifying"].includes(t.status)).length;
  if (inFlight > maxActive) {
    actions.push({ task: "-", for: "mira", what: `WIP limit: ${inFlight} active > ${maxActive} — finish before starting more` });
  }
  return actions;
}

export function renderBrief(state) {
  const tasks = Object.values(state.tasks);
  const by = (s) => tasks.filter((t) => t.status === s);
  const done = by("done");
  const L = [];
  L.push(`# Manager brief — ${new Date().toISOString().replace("T", " ").slice(0, 16)}`);
  L.push("");
  L.push(`Portfolio: ${tasks.length} tasks — ${done.length} done, ${activeTasks(state).length} active, ${by("escalated").length} escalated, ${by("blocked").length} blocked.`);
  L.push("");

  const section = (title, list, render) => {
    if (list.length === 0) return;
    L.push(`## ${title}`);
    for (const t of list) L.push(render(t));
    L.push("");
  };

  section("Shipped", done.slice(-5).reverse(), (t) =>
    `- ${t.id} ${t.title} — evidence: ${t.evidence.filter((e) => e.kind === "check" && e.result === "pass").length} passing check(s)${t.evidence.some((e) => e.kind === "review") ? ", reviewed" : ""} (${AGE(t.updated_at)} ago)`);
  section("Needs your decision", by("escalated"), (t) =>
    `- ${t.id} ${t.title} — ${t.blocker?.reason || "escalated"} (waiting ${AGE(t.blocker?.since)})`);
  section("Blocked", by("blocked"), (t) =>
    `- ${t.id} ${t.title} — ${t.blocker?.reason || "?"} (worker: ${t.assigned_worker || "-"}, since ${AGE(t.blocker?.since)} ago)`);
  section("In review / verifying", [...by("in_review"), ...by("verifying")], (t) =>
    `- ${t.id} ${t.title} — ${t.status}, ${t.assigned_worker || "-"}${t.review_required ? " (review required)" : ""}`);
  section("In progress", by("in_progress"), (t) =>
    `- ${t.id} ${t.title} — ${t.assigned_worker || "-"}, attempt ${t.attempt_count}, checkpoint ${t.last_checkpoint ? `${t.last_checkpoint.note || "(no note)"} (${AGE(t.last_checkpoint.at)} ago)` : "none yet"}`);
  section("Assigned, not started", by("assigned"), (t) =>
    `- ${t.id} ${t.title} — waiting on ${t.assigned_worker || "-"}`);
  section("Awaiting triage", by("new"), (t) =>
    `- ${t.id} ${t.title} — from ${t.source.type}${t.source.url ? ` (${t.source.url})` : ""}, priority ${t.priority}`);
  section("Triaged, awaiting routing", by("triaged"), (t) =>
    `- ${t.id} ${t.title} — priority ${t.priority}${t.risk === "risky" ? ", RISKY" : ""}, ${t.completion_checks.length} check(s)`);

  const suggested = wakeActions(state, { budgets: { max_attempts: 3, stale_after_hours: 24, max_active_tasks: 5 } })
    .filter((a) => a.for === "mira" || a.for === "manager").slice(0, 5);
  if (suggested.length) {
    L.push("## Recommended next moves");
    for (const a of suggested) L.push(`- ${a.task === "-" ? "" : a.task + ": "}${a.what}`);
    L.push("");
  }
  L.push(`Decision trail: ${state.log.length} events, last at ${state.log.length ? state.log[state.log.length - 1].at : "-"}`);
  return L.join("\n");
}

export function renderTask(task) {
  const t = task;
  const L = [];
  L.push(`${t.id} [${t.status}] ${t.title}`);
  L.push(`  source: ${t.source.type}${t.source.url ? ` ${t.source.url}` : ""}`);
  L.push(`  priority: ${t.priority}   risk: ${t.risk}   review_required: ${!!t.review_required}`);
  L.push(`  worker: ${t.assigned_worker || "-"}   attempts: ${t.attempt_count}   workspace: ${t.workspace || "-"}`);
  if (t.objective) L.push(`  objective: ${t.objective}`);
  if (t.completion_checks.length) {
    L.push("  completion checks:");
    for (const c of t.completion_checks) {
      const ev = t.evidence.filter((e) => e.kind === "check" && e.check === c);
      const mark = ev.some((e) => e.result === "pass") ? "PASS" : ev.some((e) => e.result === "fail") ? "FAIL" : "----";
      L.push(`    [${mark}] ${c}`);
    }
  }
  const reviews = t.evidence.filter((e) => e.kind === "review");
  if (reviews.length) {
    L.push("  reviews:");
    for (const r of reviews) L.push(`    ${r.result}: ${r.detail} (${r.actor}, ${AGE(r.at)} ago)`);
  }
  if (t.blocker) L.push(`  blocker: ${t.blocker.reason} (since ${AGE(t.blocker.since)} ago, by ${t.blocker.actor})`);
  if (t.next_wake_at) L.push(`  next wake: ${t.next_wake_at}`);
  if (t.last_checkpoint) L.push(`  checkpoint: ${t.last_checkpoint.note || "-"} (${AGE(t.last_checkpoint.at)} ago)`);
  const notes = t.evidence.filter((e) => e.kind === "note");
  if (notes.length) {
    L.push("  notes:");
    for (const n of notes.slice(-3)) L.push(`    ${n.detail} (${n.actor}, ${AGE(n.at)} ago)`);
  }
  return L.join("\n");
}

export function saveBrief(root, text) {
  const dir = paths(root).briefs;
  fs.mkdirSync(dir, { recursive: true });
  const name = `brief-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16)}.md`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, text + "\n");
  return file;
}
