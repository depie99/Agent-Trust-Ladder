#!/usr/bin/env node
// atl-manager — the runtime that keeps the ATL digital team alive.
//
//   Mira   coordinates (assign, escalate, brief)        judgment slot
//   Pip    triages intake into bounded tasks            analysis slot
//   Rowan  builds in isolated workspaces                code slot
//   Sage   reviews independently                        review slot
//   Beacon verifies finish conditions, night watch      analysis slot
//
// The runner owns state (.trust/manager/state.json) and enforces role
// contracts on every transition. Agent sessions adopt a role via
// `role <name>` and act only through these commands.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  StateError, STATUSES, paths, emptyState, loadState, saveState,
  createTask, logEvent, transition, addEvidence,
} from "./lib/state.mjs";
import { contractFor, renderRole, ROLE_SLOT } from "./lib/roles.mjs";
import { IntakeError, runIntake } from "./lib/intake.mjs";
import { WorkspaceError, ensureWorkspace } from "./lib/workspace.mjs";
import { renderBrief, renderTask, wakeActions, saveBrief, activeTasks } from "./lib/render.mjs";
import { post as feedPost, renderFeed, renderRoster } from "./lib/feed.mjs";
import { buildShowMe, saveShowMe } from "./lib/show-me.mjs";
import { saveVisualPrDescription } from "./lib/visual-pr.mjs";
import { memoryStatus, safeRecall, safeRemember } from "./lib/memory.mjs";
import { bundledRoot, formatRoute, isSkillAvailable, routeTask } from "./lib/skill-router.mjs";

// The project is where you run the CLI from (like git): state, config, and
// workspaces live in <cwd>/.trust/manager and <cwd>/config. Override with ATL_PROJECT.
const ROOT = process.env.ATL_PROJECT ? path.resolve(process.env.ATL_PROJECT) : process.cwd();
const P = paths(ROOT);

// Narration: every command speaks in the acting bot's voice.
const say = (from, text, opts = {}) => feedPost(ROOT, { from, text, ...opts });

// ---------- tiny argv parser (no dependencies)

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = { set: {}, check: [], pass: [], fail: [], note: [], review: [] };
const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  const eat = (name) => {
    if (a === `--${name}`) {
      const next = argv[i + 1];
      flags[name] = next === undefined || String(next).startsWith("--") ? true : argv[++i];
      return true;
    }
    return false;
  };
  if (eat("actor") || eat("to") || eat("source") || eat("reason") || eat("priority") || eat("risk") || eat("wake-in") || eat("save") || eat("checkpoint") || eat("task") || eat("n") || eat("title")) continue;
  if (a === "--set") {
    const kv = String(argv[++i]);
    const m = kv.match(/^([\w.]+)=(.*)$/s);
    if (!m) throw new StateError(`--set expects key=value, got "${kv}"`);
    let v = m[2];
    if (/^[[{"]/.test(v) || v === "true" || v === "false" || v === "null" || /^-?\d+(\.\d+)?$/.test(v)) {
      try { v = JSON.parse(v); } catch { /* keep string */ }
    }
    flags.set[m[1]] = v;
    continue;
  }
  if (a === "--check") { flags.check.push(argv[++i]); continue; }
  if (a === "--evidence-pass") { flags.pass.push(argv[++i]); continue; }
  if (a === "--evidence-fail") { flags.fail.push(argv[++i]); continue; }
  if (a === "--note") { flags.note.push(argv[++i]); continue; }
  if (a === "--review") { flags.review.push(argv[++i]); continue; }
  if (a === "--force") { flags.force = true; continue; }
  pos.push(a);
}

function usage() {
  return `
atl-manager — persistent coordinator runtime for the ATL digital team
Run it inside the project it manages (state lives in <project>/.trust/manager).
Install once with scripts\\install-atl.cmd (or install-atl.sh) and use: atl <command>

Setup
  init                          create .trust/manager/ scaffold + config

Intake (pulls new work in)
  intake [--source file|github|azure|all]
  triage <task-id>              print Pip's triage packet for a task

Role actions (every one takes --actor pip|rowan|sage|beacon|mira|manager)
  update <id> [--set k=v]... [--check "..."]... [--objective "..."]
                [--evidence-pass "..."]... [--evidence-fail "..."]...
                [--review "approve: ..."| "changes-requested: ..."] [--note "..."]
                [--to worker] [--priority p] [--risk risky]
  move <id> <status> --actor <role> [--note "..."]
  assign <id> --to <worker> --actor mira
  workspace <id>                create the isolated worktree/clone
  block <id> --reason "..." [--wake-in 2h] --actor <role>
  escalate <id> --reason "..." --actor <role>

Manager view
  wake                          the wake loop: what Mira should do next
  brief [--save]                Mira's manager brief
  show [task-id]                portfolio or one task
  feed [--task id] [--n 50] [--roster]   the team chat: what every bot did
  routines                      configured when/then triggers
  memory status                 show the optional Mem0 graph-memory provider state
  memory recall "query"         retrieve advisory project memory
  memory remember "fact"        store an explicitly supplied advisory memory
  show-me [task-id] [--save]     render a structural handoff outline
  visual-pr [--title "..."]      write a reviewer-ready PR description
  route <task-id>                inspect and persist the selected specialist skills
  role <mira|pip|rowan|sage|beacon>   print the role contract a session must adopt
  validate                      sanity-check config + state
`.trim();
}

const need = (id) => {
  const state = loadState(ROOT);
  const task = state.tasks[id];
  if (!task) throw new StateError(`Unknown task ${id}. Use: show`);
  return { state, task };
};

const actorOf = () => flags.actor || "manager";
const knownActor = () => {
  const a = actorOf();
  const known = ["mira", "pip", "rowan", "sage", "beacon", "manager"];
  if (!known.includes(a)) throw new StateError(`--actor must be one of ${known.join(", ")}`);
  return a;
};

function loadConfig() {
  if (!fs.existsSync(P.config)) {
    throw new StateError(`Missing ${P.config}. Run: node runtime\\atl-manager.mjs init`);
  }
  return JSON.parse(fs.readFileSync(P.config, "utf8"));
}

function applySkillRoute(task) {
  const route = routeTask(ROOT, {
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

// Narration: after any successful mutation, the acting bot speaks in the feed.
const STATUS_LABEL = { in_progress: "Running", in_review: "In review", verifying: "Verifying", done: "Done", blocked: "Blocked", escalated: "Escalated" };

function narrateMove(task, from, to, actor, note) {
  const t = task;
  if (to === "triaged") {
    const n = t.completion_checks.length;
    say("pip", `triage holds for ${t.id}: ${t.objective} (${n} observable check${n === 1 ? "" : "s"}). routing to mira.`, { task: t.id });
  } else if (to === "assigned") {
    say("mira", `${t.id} routed to ${t.assigned_worker}. kicking ${t.assigned_worker}.`, { task: t.id });
  } else if (to === "in_progress" && from === "assigned") {
    say(actor, `claimed ${t.id}. ${t.assigned_worker} is on it.`, { task: t.id, kind: "card", status: STATUS_LABEL[to], detail: t.workspace ? `workspace: ${t.workspace}` : null });
  } else if (to === "in_progress" && from === "in_review") {
    say(actor, `changes requested on ${t.id} — back on it.`, { task: t.id, kind: "card", status: STATUS_LABEL[to] });
  } else if (to === "in_review") {
    say(actor, `${t.id} ready for review — diff + evidence in the workspace. over to sage.`, { task: t.id, kind: "card", status: STATUS_LABEL[to] });
  } else if (to === "verifying") {
    say("sage", `review done on ${t.id}. beacon is rechecking the finish conditions.`, { task: t.id, kind: "card", status: STATUS_LABEL[to] });
  } else if (to === "done") {
    say("beacon", `${t.id} done — every check observed. brief updated.`, { task: t.id, kind: "card", status: STATUS_LABEL[to] });
  } else if (to === "blocked") {
    say(actor, `blocking ${t.id}: ${t.blocker?.reason || note || ""}${t.next_wake_at ? ` — wakes ${t.next_wake_at}` : ""}`, { task: t.id, kind: "card", status: STATUS_LABEL[to] });
  } else if (to === "escalated") {
    say(actor, `ESCALATION ${t.id}: ${t.blocker?.reason || note || ""} — needs the manager.`, { task: t.id, kind: "card", status: STATUS_LABEL[to] });
  } else if (to === "rejected") {
    say(actor, `${t.id} rejected as noise — ${note || "no bounded task inside"}.`, { task: t.id });
  }
}

// Routines: Mira's routing policy declared in advance.
function matchRoutine(routines, cand) {
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

function applyRoutine(task, routine) {
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

function defaultConfig() {
  return {
    version: 1,
    inbox_dir: ".trust/manager/inbox",
    briefs_dir: ".trust/manager/briefs",
    budgets: { max_attempts: 3, stale_after_hours: 24, max_active_tasks: 5 },
    routines: [],
    memory: {
      provider: "none",
      project_id: "",
      mem0: {
        enable_graph: true,
        graph_store: {
          provider: "neo4j",
          config: {
            url: "$NEO4J_URL",
            username: "$NEO4J_USERNAME",
            password: "$NEO4J_PASSWORD",
          },
        },
      },
    },
    intake: {
      file: { enabled: true },
      github: {
        enabled: false,
        repos: ["shahryarjb/temp_mishka_cms"],
        note: "set enabled=true; unauthenticated works for public repos, or run: gh auth login / set GITHUB_TOKEN",
      },
      azure: {
        enabled: false,
        org_url: "https://devops.soitco.net:32678/Solico-Group",
        project: "Middleware-and-Portals",
        team: "Middleware-and-Portals Team",
        iteration_path: "Middleware-and-Portals\\Sprint 73",
        token_env: "AZDO_PAT",
        tls_allow_untrusted: true,
        note: "set enabled=true and provide AZDO_PAT (Work Items: Read). tls_allow_untrusted is ON for the self-hosted server certificate; turn it off if you install a trusted cert.",
      },
    },
    workspaces: {
      root: ".trust/manager/workspaces",
      repos: {
        "shahryarjb/temp_mishka_cms": { path: "" },
      },
      note: "put a local clone path in repos.<owner/name>.path to get cheap git worktrees instead of fresh clones",
    },
  };
}

const resolveWake = (v) => {
  if (!v || v === true) return null;
  const m = String(v).match(/^\+?(\d+)([mhd])$/);
  if (m) {
    const mult = { m: 60000, h: 3600000, d: 86400000 }[m[2]];
    return new Date(Date.now() + Number(m[1]) * mult).toISOString();
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new StateError(`--wake-in expects hours like "8h" or an ISO date, got "${v}"`);
  return d.toISOString();
};

// ---------- commands

async function main() {
  switch (cmd) {
    case "init": {
      for (const d of [P.inbox, P.briefs, P.workspaces]) fs.mkdirSync(d, { recursive: true });
      if (!fs.existsSync(P.config)) {
        fs.mkdirSync(path.dirname(P.config), { recursive: true });
        fs.writeFileSync(P.config, JSON.stringify(defaultConfig(), null, 2) + "\n");
      }
      if (!fs.existsSync(P.routing)) {
        const defaults = path.join(path.dirname(fileURLToPath(import.meta.url)), "defaults", "model-routing.json");
        fs.mkdirSync(path.dirname(P.routing), { recursive: true });
        fs.copyFileSync(defaults, P.routing);
      }
      const skillRouting = P.skillRouting;
      if (!fs.existsSync(skillRouting)) {
        fs.mkdirSync(path.dirname(skillRouting), { recursive: true });
        fs.copyFileSync(path.join(bundledRoot(), "config", "skill-routing.json"), skillRouting);
      }
      const projectMeta = path.join(ROOT, ".atl", "project.json");
      if (!fs.existsSync(projectMeta)) {
        fs.mkdirSync(path.dirname(projectMeta), { recursive: true });
        const bundlePackage = path.join(bundledRoot(), "package.json");
        const bundleVersion = fs.existsSync(bundlePackage) ? JSON.parse(fs.readFileSync(bundlePackage, "utf8")).version : "unknown";
        fs.writeFileSync(projectMeta, JSON.stringify({ package: "@depie99/atl", version: bundleVersion, initialized_at: new Date().toISOString() }, null, 2) + "\n");
      }
      if (!fs.existsSync(P.state)) {
        saveState(ROOT, emptyState());
      }
      console.log(`Ready.\n  state:     ${P.state}\n  config:    ${P.config}\n  routing:   ${P.routing}\n  inbox:     ${P.inbox}  (drop markdown bullet files here)\n  workspaces:${P.workspaces}`);
      console.log(`  skill route:${P.skillRouting}\n  project:   ${projectMeta}`);
      console.log(`\nNext: add a task file to the inbox, then: atl intake   (or: node runtime\\atl-manager.mjs intake)`);
      return;
    }

    case "intake": {
      const cfg = loadConfig();
      const state = loadState(ROOT);
      const which = flags.source || "all";
      const batches = await runIntake({ ...cfg, inbox_dir: path.resolve(ROOT, cfg.inbox_dir) }, which);
      let added = 0, skipped = 0;
      for (const b of batches) {
        for (const cand of b.tasks) {
          const dup = Object.values(state.tasks).find((t) => t.intake_key && t.intake_key === cand.intake_key);
          if (dup) { skipped++; continue; }
          const t = createTask(state, {
            title: cand.title,
            source: cand.source,
            priority: cand.priority,
            risk: cand.risk,
            labels: cand.labels,
            intake_key: cand.intake_key,
          });
          if (cand.objective_hint) t.objective_hint = cand.objective_hint;
          if (cand.completion_checks.length) t.completion_checks = cand.completion_checks; // pre-filled; Pip still owns triage
          const routine = matchRoutine(cfg.routines, cand);
          if (routine) applyRoutine(t, routine);
          const route = applySkillRoute(t);
          logEvent(state, { task: t.id, actor: "runner", event: "intake", detail: `${b.source}: ${cand.title}` });
          const ref = cand.source.url || cand.title;
          say("pip", `grabbing ${ref} — "${cand.title}". pulling ${b.source} + thread, then queuing triage.`, { task: t.id });
          if (routine?.then?.assign_to) {
            say("mira", `${t.id} pre-routed to ${routine.then.assign_to} by routine "${routine.name}". kicks when triage lands.`, { task: t.id });
          }
          say("pip", `${t.id} skill route: ${route.selected_skills.join(", ") || "unresolved"} (${route.status}).`, { task: t.id });
          added++;
          console.log(`  + ${t.id} [new] (${b.source})${routine ? ` [routine: ${routine.name}]` : ""} ${cand.title}`);
        }
      }
      saveState(ROOT, state);
      console.log(`\nIntake done: ${added} new, ${skipped} already known. Next: node runtime\\atl-manager.mjs triage <task-id> (as Pip).`);
      return;
    }

    case "triage": {
      const { state, task } = need(pos[0]);
      const routing = JSON.parse(fs.readFileSync(P.routing, "utf8"));
      const route = applySkillRoute(task);
      saveState(ROOT, state);
      console.log(renderRole("pip", routing));
      console.log("\n--- Task packet ---\n");
      console.log(renderTask(task));
      console.log("\n--- Specialist route ---\n");
      console.log(formatRoute(route));
      if (task.objective_hint) console.log(`  (hint from source: ${task.objective_hint.slice(0, 300)})`);
      const recalled = await safeRecall(ROOT, `${task.title} ${task.objective_hint || ""}`, { agentId: "pip", runId: task.id, limit: 3 });
      if (recalled.results.length) {
        console.log("\n--- Advisory memory context ---\n");
        for (const hit of recalled.results) console.log(`- ${hit.memory || hit}`);
        if (recalled.relations?.length) console.log(`  related graph facts: ${recalled.relations.length}`);
      }
      console.log("\n--- Pip fills it in like this ---\n");
      console.log(`node runtime\\atl-manager.mjs update ${task.id} --actor pip \\`);
      console.log(`  --set objective="<one bounded sentence>" \\`);
      console.log(`  --check "<observable check 1>" --check "<observable check 2>" \\`);
      console.log(`  --priority ${task.priority} --risk normal --note "triage rationale"`);
      console.log(`node runtime\\atl-manager.mjs move ${task.id} triaged --actor pip`);
      return;
    }

    case "route": {
      const { state, task } = need(pos[0]);
      const route = applySkillRoute(task);
      saveState(ROOT, state);
      console.log(formatRoute(route));
      return;
    }

    case "update": {
      const { state, task } = need(pos[0]);
      const actor = knownActor();
      const contract = actor !== "manager" ? contractFor(actor) : null;

      if (task.status === "new" && actor && !["pip", "manager", "mira"].includes(actor)) {
        throw new StateError(`${task.id}: only Pip (or the manager) may shape a task in triage`);
      }
      for (const [k, v] of Object.entries(flags.set)) {
        const writable = contract ? contract.may_write : null;
        const base = k.split(".")[0];
        if (writable && !writable.includes(base)) {
          throw new StateError(`${actor} may not write "${base}" (allowed: ${writable.join(", ")})`);
        }
        task[base] = v;
      }
      if (flags.objective) {
        if (contract && !contract.may_write.includes("objective")) throw new StateError(`${actor} may not write objective`);
        task.objective = flags.objective;
      }
      for (const c of flags.check) {
        if (contract && !contract.may_write.includes("completion_checks")) throw new StateError(`${actor} may not write completion_checks`);
        if (!task.completion_checks.includes(c)) task.completion_checks.push(c);
      }
      if (flags.priority) {
        if (contract && !contract.may_write.includes("priority")) throw new StateError(`${actor} may not write priority`);
        task.priority = flags.priority;
      }
      if (flags.risk) {
        if (contract && !contract.may_write.includes("risk")) throw new StateError(`${actor} may not write risk`);
        task.risk = flags.risk === "risky" ? "risky" : "normal";
        task.review_required = task.review_required || task.risk === "risky";
      }
      if (flags.to) {
        if (actor !== "mira" && actor !== "manager") throw new StateError("only Mira (or the manager) assigns workers; use: assign");
        task.assigned_worker = flags.to;
      }
      for (const p of flags.pass) {
        addEvidence(state, task.id, { kind: "check", check: p, result: "pass", detail: "" }, actor);
        say(actor, `check passed on ${task.id}: ${p}`, { task: task.id });
      }
      for (const f of flags.fail) {
        addEvidence(state, task.id, { kind: "check", check: f, result: "fail", detail: "" }, actor);
        say(actor, `check FAILED on ${task.id}: ${f} — back to the bench.`, { task: task.id });
      }
      if (flags.checkpoint) {
        if (contract && !contract.may_write.includes("last_checkpoint")) throw new StateError(`${actor} may not write last_checkpoint`);
        task.last_checkpoint = { at: new Date().toISOString(), note: flags.checkpoint };
        say(actor, `checkpoint on ${task.id}: ${flags.checkpoint}`, { task: task.id });
      }
      for (const f of flags.fail) addEvidence(state, task.id, { kind: "check", check: f, result: "fail", detail: "" }, actor);
      for (const r of flags.review) {
        const m = r.match(/^\s*(approve|changes-requested)\s*[:\-]\s*(.+)$/i);
        if (!m) throw new StateError(`--review expects "approve: <findings>" or "changes-requested: <findings>"`);
        addEvidence(state, task.id, { kind: "review", result: m[1].toLowerCase(), detail: m[2].trim() }, actor);
        say(actor, `review verdict on ${task.id}: ${m[1].toLowerCase()} — ${m[2].trim()}`, { task: task.id });
      }
      for (const n of flags.note) {
        addEvidence(state, task.id, { kind: "note", detail: n }, actor);
        say(actor, n, { task: task.id });
      }
      if (Object.keys(flags.set).length || flags.objective || flags.check.length || flags.pass.length || flags.fail.length || flags.review.length || flags.note.length || flags.priority || flags.risk || flags.to || flags.checkpoint) {
        task.updated_at = new Date().toISOString();
        logEvent(state, { task: task.id, actor, event: "update", detail: JSON.stringify({ set: Object.keys(flags.set), checks: flags.check.length, pass: flags.pass.length, fail: flags.fail.length, reviews: flags.review.length }) });
      }
      saveState(ROOT, state);
      console.log(renderTask(task));
      return;
    }

    case "move": {
      const { state, task } = need(pos[0]);
      const to = pos[1];
      const from = task.status;
      const actor = knownActor();
      transition(state, task.id, to, { actor, note: flags.note?.[0] });
      narrateMove(task, from, to, actor, flags.note?.[0]);
      if (to === "triaged" && task.auto_route && task.assigned_worker) {
        say("mira", `routine "${task.auto_route}" kicks in: ${task.id} → ${task.assigned_worker}.`);
        transition(state, task.id, "assigned", { actor: "mira", note: `routine ${task.auto_route}` });
        narrateMove(task, "triaged", "assigned", "mira", `routine ${task.auto_route}`);
      }
      saveState(ROOT, state);
      if (to === "done") {
        const checks = task.completion_checks.map((check) => {
          const evidence = task.evidence.find((entry) => entry.kind === "check" && entry.check === check && entry.result === "pass");
          return `${check}: ${evidence ? "passed" : "unverified"}`;
        }).join("; ");
        const memory = await safeRemember(ROOT, `Verified ATL outcome for ${task.id}: ${task.title}. Objective: ${task.objective || "not recorded"}. Checks: ${checks}.`, { agentId: "beacon", runId: task.id });
        if (memory.error) say("beacon", `memory advisory unavailable for ${task.id}: ${memory.error}`, { task: task.id });
      }
      console.log(renderTask(task));
      return;
    }

    case "assign": {
      const { state, task } = need(pos[0]);
      const worker = flags.to;
      if (!["pip", "rowan", "sage", "beacon"].includes(worker)) {
        throw new StateError(`--to must be one of pip, rowan, sage, beacon`);
      }
      task.assigned_worker = worker;
      transition(state, task.id, "assigned", { actor: knownActor(), note: `assigned to ${worker}` });
      narrateMove(task, "triaged", "assigned", actorOf(), `assigned to ${worker}`);
      saveState(ROOT, state);
      console.log(renderTask(task));
      return;
    }

    case "workspace": {
      const { state, task } = need(pos[0]);
      const cfg = loadConfig();
      const wcfg = { ...(cfg.workspaces || {}) };
      if (wcfg.repos) {
        for (const [k, v] of Object.entries(wcfg.repos)) {
          if (v && v.path) wcfg.repos[k] = { path: path.isAbsolute(v.path) ? v.path : path.resolve(ROOT, v.path) };
        }
      }
      const ws = ensureWorkspace(ROOT, wcfg, task);
      task.workspace = ws.dir;
      logEvent(state, { task: task.id, actor: actorOf(), event: "workspace", detail: `${ws.mode}${ws.from ? " from " + ws.from : ""}${ws.reused ? " (reused)" : ""}` });
      say(actorOf() === "manager" ? "mira" : actorOf(), `workspace ready for ${task.id} (${ws.mode}${ws.reused ? ", reused" : ""}).`, { task: task.id, detail: ws.dir });
      saveState(ROOT, state);
      console.log(`${task.id} workspace: ${ws.dir}  [${ws.mode}${ws.reused ? ", reused" : ""}]`);
      return;
    }

    case "block": {
      const { state, task } = need(pos[0]);
      if (!flags.reason) throw new StateError(`block needs --reason "..."`);
      const from = task.status;
      task.blocker = { reason: flags.reason, since: new Date().toISOString(), actor: actorOf() };
      task.next_wake_at = resolveWake(flags["wake-in"]);
      transition(state, task.id, "blocked", { actor: knownActor(), note: flags.reason });
      narrateMove(task, from, "blocked", actorOf(), flags.reason);
      saveState(ROOT, state);
      console.log(renderTask(task));
      return;
    }

    case "escalate": {
      const { state, task } = need(pos[0]);
      if (!flags.reason) throw new StateError(`escalate needs --reason "..."`);
      const from = task.status;
      task.blocker = { reason: flags.reason, since: new Date().toISOString(), actor: actorOf() };
      transition(state, task.id, "escalated", { actor: knownActor(), note: flags.reason });
      narrateMove(task, from, "escalated", actorOf(), flags.reason);
      saveState(ROOT, state);
      console.log(renderTask(task));
      return;
    }

    case "wake": {
      const state = loadState(ROOT);
      const cfg = loadConfig();
      const actions = wakeActions(state, cfg.budgets ? cfg : { budgets: cfg });
      if (actions.length === 0) {
        console.log("Nothing to do. The queue is quiet — good time for Beacon to preserve run memory.");
        return;
      }
      console.log(`# Wake — ${new Date().toISOString()}\n`);
      let lastFor = "";
      for (const a of actions) {
        if (a.for !== lastFor) { console.log(`\n## For ${a.for}`); lastFor = a.for; }
        console.log(`- ${a.task === "-" ? "" : a.task + ": "}${a.what}`);
      }
      const escalations = actions.filter((a) => a.for === "manager").length;
      console.log(`\n${actions.length} action(s); ${escalations} need the human manager.`);
      return;
    }

    case "brief": {
      const state = loadState(ROOT);
      const text = renderBrief(state);
      console.log(text);
      if (flags.save) {
        const f = saveBrief(ROOT, text);
        console.log(`\nSaved: ${f}`);
      }
      return;
    }

    case "show": {
      const state = loadState(ROOT);
      if (pos[0]) {
        console.log(renderTask(state.tasks[pos[0]]));
      } else {
        const tasks = activeTasks(state);
        const done = Object.values(state.tasks).filter((t) => t.status === "done");
        console.log(`active: ${tasks.length}, done: ${done.length}`);
        for (const t of tasks) {
          console.log(`  ${t.id} [${t.status}] (${t.priority}${t.risk === "risky" ? "/risky" : ""}) ${t.title} — ${t.assigned_worker || "unassigned"}`);
        }
      }
      return;
    }

    case "feed": {
      if (flags.roster) {
        const routing = JSON.parse(fs.readFileSync(P.routing, "utf8"));
        console.log(renderRoster(routing));
        console.log("");
      }
      console.log(renderFeed(ROOT, { task: flags.task || null, n: flags.n ? Number(flags.n) : 100 }));
      return;
    }

    case "routines": {
      const cfg = loadConfig();
      const routines = cfg.routines || [];
      if (routines.length === 0) {
        console.log('No routines configured. Add them to config/manager.json:\n\n  "routines": [{ "name": "...", "when": { "source": "github", "keyword": "bug" }, "then": { "priority": "high", "assign_to": "rowan" } }]');
        return;
      }
      console.log("Routines — declared routing policy (applied at intake):");
      for (const r of routines) {
        const when = Object.entries(r.when || {}).map(([k, v]) => `${k}=${v}`).join(" · ");
        const then = Object.entries(r.then || {}).map(([k, v]) => `${k}=${v}`).join(" · ");
        console.log(`  ${r.name}\n    when ${when}\n    then ${then || "(triage only)"}`);
      }
      return;
    }

    case "memory": {
      const subcommand = pos[0] || "status";
      if (subcommand === "status") {
        console.log(JSON.stringify(await memoryStatus(ROOT), null, 2));
        return;
      }
      const query = pos.slice(1).join(" ").trim();
      if (!query) throw new StateError(`memory ${subcommand} needs a quoted value`);
      if (subcommand === "recall") {
        const result = await safeRecall(ROOT, query, { agentId: actorOf() });
        if (result.error) throw new StateError(result.error);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (subcommand === "remember") {
        const result = await safeRemember(ROOT, query, { agentId: actorOf() });
        if (result.error) throw new StateError(result.error);
        console.log(JSON.stringify({ stored: result.stored, provider: result.provider }, null, 2));
        return;
      }
      throw new StateError(`Unknown memory command "${subcommand}". Use status, recall, or remember.`);
    }

    case "show-me": {
      const content = buildShowMe(ROOT, { taskId: pos[0] || null });
      if (flags.save) console.log(`Saved: ${saveShowMe(ROOT, content, { taskId: pos[0] || null })}`);
      console.log(content);
      return;
    }

    case "visual-pr":
    case "pr-description": {
      const file = saveVisualPrDescription(ROOT, { title: flags.title || null, taskId: flags.task || null, slug: pos[0] || null });
      console.log(`Saved: ${file}`);
      console.log(fs.readFileSync(file, "utf8"));
      return;
    }

    case "role": {
      const name = pos[0];
      const routing = JSON.parse(fs.readFileSync(P.routing, "utf8"));
      if (name === "manager") {
        console.log("The human manager. May do anything, including overrides. The team escalates here; the manager decides priorities, risk acceptance, merges, deploys, and policy.");
        return;
      }
      console.log(renderRole(name, routing));
      return;
    }

    case "validate": {
      const cfg = loadConfig();
      const skillRouting = fs.existsSync(P.skillRouting)
        ? JSON.parse(fs.readFileSync(P.skillRouting, "utf8"))
        : { routes: [], fallback: null };
      const state = loadState(ROOT);
      const problems = [];
      for (const route of [...(skillRouting.routes || []), ...(skillRouting.fallback ? [skillRouting.fallback] : [])]) {
        if (route.skill && !isSkillAvailable(ROOT, route.skill)) {
          problems.push(`skill route ${route.skill}: missing skills/${route.skill}/SKILL.md`);
        }
      }
      const known = new Set(Object.keys(state.tasks));
      for (const t of Object.values(state.tasks)) {
        if (!STATUSES.includes(t.status)) problems.push(`${t.id}: bad status ${t.status}`);
        for (const e of t.evidence) {
          if (e.kind === "check" && e.check && !t.completion_checks.includes(e.check)) {
            problems.push(`${t.id}: evidence references unknown check "${e.check}"`);
          }
        }
        if (t.assigned_worker && !["pip", "rowan", "sage", "beacon"].includes(t.assigned_worker)) {
          problems.push(`${t.id}: bad worker ${t.assigned_worker}`);
        }
      }
      for (const e of state.log) {
        if (e.task !== null && e.task !== undefined && e.task !== "-" && !known.has(e.task) && e.event !== "intake") {
          problems.push(`log references unknown task ${e.task}`);
        }
      }
      if (cfg.intake?.azure?.enabled && !process.env[cfg.intake.azure.token_env || "AZDO_PAT"]) {
        problems.push(`azure intake enabled but ${cfg.intake.azure.token_env || "AZDO_PAT"} is not set`);
      }
      if (problems.length) {
        console.error("State problems:\n  - " + problems.join("\n  - "));
        process.exitCode = 1;
      } else {
        console.log(`State OK: ${Object.keys(state.tasks).length} tasks, ${state.log.length} log events. Config OK.`);
      }
      return;
    }

    default:
      console.log(usage());
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
