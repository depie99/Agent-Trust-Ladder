# CLI reference

Generated from `runtime/atl-manager.mjs` usage text. Run `atl --help` for your installed version. Do not edit this reference by hand.

## How to use commands

Run commands from the managed application and inspect any `ATL_PROJECT` override. Replace example task IDs and paths. Preview execution before confirming. Commands that publish, restore, install, or change credentials have material effects; read their guide first.

## Current help

```text
atl-manager — persistent coordinator runtime for the ATL digital team
Run it inside the project it manages (state lives in <project>/.trust/manager).
Install once with scripts\install-atl.cmd (or install-atl.sh) and use: atl <command>

Setup
  init                          create .trust/manager/ scaffold + config
  projects register             register this local repository with the ATL supervisor
  projects list                 list locally registered repositories
  projects concurrency <1..5>  set the bounded shared provider-session cap
  backup create [--label name] create a recoverable project snapshot
  backup list                  list project snapshots
  backup restore <id>          restore a snapshot (requires no active run)

Intake (pulls new work in)
  intake [--source file|github|azure|all]
  intake status                 per-source enabled state + auth readiness
  intake enable <source> [--repo owner/name,owner2/name2] [--remove owner/name] [--force]
                                flip the source on in config; github repos are probed
                                live first — a 404 (private repo, no auth) blocks the
                                enable with the fix unless --force
  intake disable <source>       flip the source off (keeps repos/urls)
  triage <task-id>              print Pip's triage packet for a task

Role actions (every one takes --actor pip|rowan|sage|beacon|mira|manager)
  revision <id>                print the workspace content revision
  observe <id> <packet.json>    record complete revision-bound observation evidence
  contract-repair <id> <file>  apply one supervisor-requested Pip contract revision
  update <id> [--set k=v]... [--check "..."]... [--objective "..."]
                [--evidence-pass "..."]... [--evidence-fail "..."]...
                [--review "approve: ..."| "changes-requested: ..."] [--note "..."]
                [--to worker] [--priority p] [--risk risky]
  move <id> <status> --actor <role> [--note "..."]
  assign <id> --to <worker> --actor mira
  workspace <id>                create the isolated worktree/clone
  block <id> --reason "..." [--wake-in 2h] --actor <role>
  unblock <id> [--to triaged|assigned] [--note "..."]
  resource <id> <url-or-path> [--label "..."] [--caption "..."]
  escalate <id> --reason "..." --actor <role>

Owner gates (the human's levers, no incantations)
  why [task-id]                 the full "why" behind every active task — complete
                                blocker text, never truncated, plus the exact fix command
  approve <task-id> [--note "..."]
                                the owner gate in one word: records your approval as
                                durable evidence, clears an approval blocker, and
                                queues the task for the next launch

Manager view
  wake                          the wake loop: what Mira should do next
  brief [--save]                Mira's manager brief
  ui [--port n]                 open the browser-native ATL control plane
  ui-refresh [--port n]         restart the browser UI from current source
  tui [--once] [--plain]        terminal compatibility control room (alias: dashboard)
  control-plane [--port n]      browser-native ATL control plane (aliases: ui, web)

History (the agent CLIs' local chat transcripts — providers keep usage only)
  history [--source codex|zcode|all] [--n 20]
                                the most recent Codex / ZCode CLI sessions on this machine
  history show <number|id|latest> [--n 200]
                                print one session transcript (who asked what, what came back)

Navigation (local source hints; always read source before editing)
  map build|status [--json]     build or inspect a revision-aware local symbol map
  map query --symbol Name       find bounded candidate definitions
  map neighbors --symbol-id ID  show syntax-level import relationships
  context assemble --task ID --query "..." [--max-tokens 800]
                                create a bounded, source-reference-only context packet

Research (the engineering-intelligence pipeline — research/ is the evidence store)
  research [list] [--status pending|approved|promoted|rejected] [--priority P0|P1|P2]
                                cumulative research records, P0 first; --status pending is the review inbox
  research show <id>            one record: summary, sources, evidence level, decision log
  research add <url> --title "..." --priority P1
                                [--set kind=post --set people=a,b --set evidence=verified|second-hand|speculation]
                                [--set atl_impact="..." --set objective="..." --set checks=one,two]
                                file a finding; deduped by canonical url + title
  research set <id> --set priority=P0 --set atl_impact="..."
                                assess a captured record (whitelisted fields)
  research approve <id>         lighter human gate before promotion (optional)
  research promote <id>         the human gate: file the improvement task (idempotent via intake key)
  research reject <id> --reason "..."
  research transcript <youtube-url> [--set record=R-0003]
                                capture a timestamped transcript (best-effort; failures are explicit)
  research retro                scan team history for repeat-attempt / blocker / escalation patterns
  research graph                rebuild research/graph.json (records-people-repos-concepts-tasks)
  research status               counts by status/priority + watchlist health
  research brief [--offline]    run the daily source sweep now (--offline re-renders from the index)
  ready                         dependency-aware launch view: ready / waiting / stuck tasks

Codex app bridge (opt-in; injects durable ATL context into one existing thread)
  codex bridge status          show the configured target thread and bridge state
  codex bridge link <thread>   enable the bridge for an explicit Codex thread id
                               add --mode queue to create a visible model turn
  codex bridge start           create a dedicated ATL history thread in Codex
  codex bridge unlink          disable the bridge without deleting local ATL logs
  codex bridge sync [--task]   import current feed and team transcripts now

Control room (spec 014 — compose/import/review/queue/preview/launch)
  compose [--title "..."] "<body text>" [--check "..."]...
                                save an immutable raw draft + create a new candidate (idempotent by content)
  queue [add <id> | remove <id> | list | clear]
                                 the persistent execution queue — separate from keyboard focus
  feedback [list | add <task-id> "prompt" --mode checkpoint|interrupt]
                                 durable human instructions for the next or restarted bot session
  launch [--dry-run] [--confirm] [--worker id] [--model model] [--max-minutes m] [--max-sessions n]
                                 preview, then run the queued tasks sequentially with per-role providers
                                 add --pause-after-bot to stop after each completed provider session
  providers                     providers, keys (masked), and per-role mapping
  provider templates            pre-filled endpoint presets (zai, bigmodel, custom)
  provider add <id> [--template t] [--worker claude|codex] [--protocol openai|anthropic|custom] [--base-url url]
                [--key secret | --key-env VAR] [--model model] [--thinking-level level]
                                store an API provider once per machine in ~/.atl/providers.json
                                (e.g. GLM: provider add zai --key <key> --model glm-4.6)
  provider key <id> --key secret | --key-env VAR
                                update the stored API key
  provider use <id> [--role role]
                                make a stored provider the project default (or one role's provider)
  provider remove <id>          delete a stored provider
  provider models [--provider id]
                                list known models for a provider (when available)
  provider set --provider id [--model model] [--role role] [--auth mode]
                                persist the default or per-role provider/model selection
  provider clear --role role    remove a per-role provider override
  show [task-id]                portfolio or one task
  feed [--task id] [--n 50] [--roster]   the team chat: what every bot did
  routines                      configured when/then triggers
  memory status                 show the optional Mem0 graph-memory provider state
  memory recall "query"         retrieve advisory project memory
  memory remember "fact"        store an explicitly supplied advisory memory
  memory learn <kind> "text"    store a preference, style, prompt, lesson, or outcome
  memory forget <id>             remove one local learning entry
  show-me [task-id] [--save]     render a structural handoff outline
  visual-pr [--title "..."]      write a reviewer-ready PR description
  route <task-id> [--smart]      inspect and persist the route; --smart opts into one Jev decision
  role <mira|pip|rowan|sage|beacon>   print the role contract a session must adopt
  run <task-id> --worker <provider-id> [--model model] [--auth subscription|api] [--confirm]
                                run one bounded role session
  overnight [<task-id> | --all] --worker <provider-id> [--model model] [--auth subscription|api] --confirm
  overnight status              inspect the durable overnight ledger; starts nothing
  overnight recover --confirm   resume only untouched tasks after an interrupted runner
                                run bounded role sessions until a gate or budget stops it;
                                with --all, take the whole active queue in priority order,
                                block stalled tasks and move on, end with a saved brief
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
const knownActor = (taskId = null) => {
  const a = actorOf();
  const known = ["mira", "pip", "rowan", "sage", "beacon", "manager"];
  if (!known.includes(a)) throw new StateError(`--actor must be one of ${known.join(", ")}`);
  if (a !== "manager" && !process.env.ATL_WORKER_CREDENTIAL) throw new StateError("role actor mutations require a scoped ATL_WORKER_CREDENTIAL; --actor alone is not authorization");
  if (process.env.ATL_WORKER_CREDENTIAL) {
    let credential;
    try { credential = JSON.parse(process.env.ATL_WORKER_CREDENTIAL); } catch { throw new StateError("invalid scoped worker credential"); }
    if (a === "manager" || (taskId && credential.task !== taskId) || !validateWorkerCredential(credential, { project: path.resolve(ROOT), task: credential.task, role: a, run: credential.run, generation: credential.generation }) || !credential.lease_id || !leaseAllows(ROOT, { key: credential.lease_key, id: credential.lease_id, generation: credential.generation })) {
      throw new StateError("scoped worker credential cannot impersonate this actor");
    }
  }
  return a;
};

function loadConfig() {
  if (!fs.existsSync(P.config)) {
    throw new StateError(`Missing ${P.config}. Run: node runtime\atl-manager.mjs init`);
  }
  return JSON.parse(fs.readFileSync(P.config, "utf8"));
}

async function applySkillRoute(task, { smart = false } = {}) {
  if (!smart) return applyDeterministicRoute(ROOT, task);
  const route = await routeTaskWithJev(ROOT, {
    title: task.title,
    objective: [task.objective, task.objective_hint].filter(Boolean).join(" "),
    labels: task.labels,
    source: task.source,
  }, { config: loadJevConfig() });
  task.selected_skills = route.selected_skills;
  task.proposed_worker = route.proposed_worker;
  task.skill_route = route;
  task.decision_log.push({ at: new Date().toISOString(), route: route.source, skills: route.selected_skills });
  return route;
}

function loadJevConfig() {
  const file = path.join(ROOT, "config", "jev.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
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

// Routines: Mira's routing policy declared in advance. (Match/apply live in
// lib/composer.mjs so `atl intake` and the control-room composer share them.)

function defaultConfig() {
  return {
    version: 1,
    inbox_dir: ".trust/manager/inbox",
    briefs_dir: ".trust/manager/briefs",
    budgets: { max_attempts: 3, max_auto_recoveries: 3, stale_after_hours: 24, max_active_tasks: 5 },
    navigation: {
      mode: "off",
      max_tokens: 800,
      build_on_launch: true,
      note: "off preserves existing prompts. Set on only after checking map coverage; map entries are navigation hints, never source authority.",
    },
    routines: [],
    providers: {
      default: "codex",
      auth: "subscription",
      model: localDefaultModel("codex"),
      by_role: {},
      catalog: {},
      note: 'per-role override, e.g. "by_role": { "sage": "claude" }; custom CLIs/models live under catalog; a missing executable blocks a launch with an actionable message',
    },
    codex_bridge: {
      enabled: false,
      thread_id: "",
      include_feed: true,
      include_session_transcripts: true,
      note: "opt-in app-server bridge; link one explicit Codex thread before enabling",
    },
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
        note: "enable with: atl intake enable github --repo owner/name (probes access first); public repos work unauthenticated, private need gh auth login or GITHUB_TOKEN",
      },
      azure: {
        enabled: false,
        org_url: "https://devops.soitco.net:32678/Solico-Group",
        project: "Middleware-and-Portals",
        team: "Middleware-and-Portals Team",
        iteration_path: "Middleware-and-Portals\Sprint 73",
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

// driveTaskUntilGate lives in lib/launch.mjs (spec 014): one owner for every
// provider spawn, shared by `run`, `overnight`, and the control-room queue.

function parseWorkerFlags({ overnight }) {
  const dryRun = flags["dry-run"] === true;
  if (!dryRun && flags.confirm !== true) {
    throw new StateError(`${overnight ? "overnight" : "run"} requires --confirm; use --dry-run to preview without starting an agent`);
  }
  const profile = providerProfile(loadConfig());
  const selectedId = String(flags.worker || profile.use || profile.defaultWorker).toLowerCase();
  const regEntry = selectedId ? loadUserProviders().providers[selectedId] : null;
  // A registry id (--worker zai, or providers.use in config) runs on its
  // underlying worker CLI with the stored key injected at spawn time.
  const worker = regEntry ? String(regEntry.worker || "claude").toLowerCase() : selectedId;
  const workerLabel = regEntry ? `${worker} via ${selectedId}` : worker;
  const auth = regEntry ? "api" : String(flags.auth || profile.auth).toLowerCase();
  assertWorkerAuth(worker, auth);
  const envPolicy = regEntry ? { unset: [], stripped: [] } : workerEnvPolicy(worker, auth);
  const provider = {
    ...providerSpec(profile, worker),
    ...(flags.model ? { model: String(flags.model) } : regEntry ? { model: regEntry.model || null } : {}),
    auth: regEntry ? "api" : (flags.auth ? auth : providerSpec(profile, worker).auth),
    ...(regEntry ? { userProvider: { id: selectedId, ...regEntry } } : {}),
  };
  const maxMinutes = Number(flags["max-minutes"] || (overnight ? 120 : 60));
  // Overnight runs must have room for the normal Rowan -> Sage -> Rowan ->
  // Sage -> Beacon relay. Five sessions starves the next stage as soon as a
  // reviewer requests one repair pass, so use a bounded eight-session default;
  // operators can still choose a smaller or larger budget explicitly.
  const resources=resourcePolicy(loadConfig());
  const maxSessions = Number(flags["max-sessions"] || (resources.enabled?resources.max_sessions:(overnight?resources.default_sessions:1)));
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes > 24 * 60) {
    throw new StateError(`--max-minutes must be between 1 and ${24 * 60}`);
  }
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 50) {
    throw new StateError("--max-sessions must be an integer between 1 and 50");
  }
  return { dryRun, worker, workerLabel, auth: provider.auth || auth, envPolicy, provider, maxMinutes, maxSessions };
}

async function syncBridgeSession(summary) {
  try {
    const result = await syncTeamContext(ROOT, { taskId: summary.taskId, sessionLog: summary.logPath });
    if (result.injected) console.log(`  Codex bridge: imported ${summary.taskId}/${summary.role} into ${result.threadId}`);
  } catch (error) {
    console.error(`  Codex bridge warning: ${error.message}`);
    say("runner", `Codex bridge could not import ${summary.taskId}/${summary.role}: ${error.message}`, { task: summary.taskId, detail: "local transcript remains available" });
  }
}

async function runWorkerLoop(taskId, { overnight }) {
  if (!taskId) throw new StateError(`${overnight ? "overnight" : "run"} needs a task id`);
  const opts = parseWorkerFlags({ overnight });
  const budget = { sessions: 0, maxSessions: opts.maxSessions, deadline: Date.now() + opts.maxMinutes * 60 * 1000 };
  console.log(`${opts.dryRun ? "Previewing" : "Starting"} ${overnight ? "overnight" : "one-shot"} ATL run for ${taskId}`);
  console.log(`  provider: ${opts.workerLabel}   model: ${opts.provider.model || "provider default"}   max time: ${opts.maxMinutes}m   max sessions: ${opts.maxSessions}`);
  if (opts.provider.userProvider) {
    console.log(`  credentials: ${maskKey(opts.provider.userProvider.api_key)} from ~/.atl/providers.json (injected at spawn, never logged)`);
  }
  if (opts.envPolicy.stripped.length) {
    console.log(`  subscription safety: child will not receive ${opts.envPolicy.stripped.join(", ")}`);
  }

  const outcome = await driveTaskUntilGate(ROOT, taskId, budget, {
    overnight,
    dryRun: opts.dryRun,
    onSession: syncBridgeSession,
    resolveWorker: (role,task) => (resourcePolicy(loadConfig()).enabled||task?.provider_route)?routeTask(loadConfig(),task,role,{overrides:{worker:flags.worker,model:flags.model}}):({ worker: opts.worker, auth: opts.auth, envPolicy: opts.envPolicy, provider: opts.provider, userProvider: opts.provider.userProvider }),
  }).catch((error) => ({ status: "unknown", reason: `worker could not start: ${error.message}`, failed: true }));

  const finalState = loadState(ROOT);
  const finalTask = finalState.tasks[taskId];
  console.log(`\nRun stopped after ${budget.sessions} session(s): ${taskId} is ${finalTask?.status || "unknown"}.`);
  console.log(`Reason: ${outcome.reason}.`);
  console.log("Next: atl wake && atl brief --save && atl show " + taskId);
}

// `overnight --all`: the autonomous queue. Takes every active task in
// priority order and drives each through the role pipeline with real bounded
// sessions. One stalled or failed task is recorded (blocked) and the queue
// moves on — the run stops only on its budget. Ends with a saved brief.
async function runQueueLoop({ overnight }) {
  if (!overnight) throw new StateError("--all is only available on overnight");
  const opts = parseWorkerFlags({ overnight });
  const budget = { sessions: 0, maxSessions: opts.maxSessions, deadline: Date.now() + opts.maxMinutes * 60 * 1000 };

  if (!opts.dryRun) {
    recoverDueBlockedTasks(ROOT, { dryRun: false, maxRecoveries: Number(loadConfig().budgets?.max_auto_recoveries ?? 1) });
  }
  const state = loadState(ROOT);
  const queue = queueSelect(Object.values(state.tasks));
  console.log(`${opts.dryRun ? "Previewing" : "Starting"} overnight queue run — ${queue.length} active task(s)`);
  console.log(`  provider: ${opts.workerLabel}   model: ${opts.provider.model || "provider default"}   max time: ${opts.maxMinutes}m   max sessions: ${opts.maxSessions}`);
  if (opts.provider.userProvider) {
    console.log(`  credentials: ${maskKey(opts.provider.userProvider.api_key)} from ~/.atl/providers.json (injected at spawn, never logged)`);
  }
  if (opts.envPolicy.stripped.length) {
    console.log(`  subscription safety: child will not receive ${opts.envPolicy.stripped.join(", ")}`);
  }
  if (!queue.length) {
    console.log("Queue is empty. Drop task files into the inbox, then: atl intake");
    return;
  }
  const runnableQueue = queue;
  for (const t of queue) {
    const role = nextRole(t) || "-";
    console.log(`  ${t.id}  [${t.priority || "normal"}]  ${t.status} -> ${role}  ${t.title}`);
  }
  if (opts.dryRun) {
    console.log("  dry-run: no agent started.");
    return;
  }

  const results = [];
  const pending = [...runnableQueue];
  while (pending.length) {
    const queued = pending.shift();
    if (budget.sessions >= budget.maxSessions || Date.now() >= budget.deadline) {
      results.push({ id: queued.id, status: "queued", reason: budget.sessions >= budget.maxSessions ? "not reached: session budget exhausted" : "not reached: time budget exhausted" });
      continue;
    }
    const fresh = loadState(ROOT).tasks[queued.id];
    if (!fresh || isTerminal(fresh.status)) {
      results.push({ id: queued.id, status: fresh?.status || "unknown", reason: "skipped: already settled" });
      continue;
    }
    say("runner", `queue: taking ${fresh.id} — ${fresh.title}`, { task: fresh.id });
    const outcome = await driveTaskUntilGate(ROOT, fresh.id, budget, {
      overnight: true,
      dryRun: false,
      onSession: syncBridgeSession,
      resolveWorker: (role,task) => (resourcePolicy(loadConfig()).enabled||task?.provider_route)?routeTask(loadConfig(),task,role,{overrides:{worker:flags.worker,model:flags.model}}):({ worker: opts.worker, auth: opts.auth, envPolicy: opts.envPolicy, provider: opts.provider, userProvider: opts.provider.userProvider }),
    }).catch((error) => ({ status: "unknown", reason: `worker could not start: ${error.message}`, failed: true }));
    results.push({ id: fresh.id, status: outcome.status || "unknown", reason: outcome.reason });
    const recovery = recoverAfterOutcome(ROOT, fresh.id, outcome, {
      maxRecoveries: Number(loadConfig().budgets?.max_auto_recoveries ?? 1),
    });
    if (recovery.recovered) {
      pending.push(loadState(ROOT).tasks[fresh.id]);
      results.push({ id: fresh.id, status: "requeued", reason: "Mira auto-recovered a non-human blocker" });
    }
  }

  const after = loadState(ROOT);
  saveBrief(ROOT, renderBrief(after));
  say("runner", "queue run finished — morning brief saved.");
  console.log(`\nQueue run finished after ${budget.sessions} session(s). Results:`);
  for (const r of results) console.log(`  ${String(r.id).padEnd(6)} ${String(r.status).padEnd(12)} ${r.reason}`);
  console.log("\nMorning report: atl brief   ·   transcript: atl feed --roster   ·   per task: atl show <id>");
}

function printLaunchPlan(plan) {
  if (!plan.items.length) {
    console.log("The execution queue is empty. Select work with `atl queue add <id>` (or `x` in atl ui).");
    return;
  }
  console.log(`Launch plan — ${plan.items.length} queued task(s): ${plan.readyCount} ready, ${plan.blockedCount} blocked · strictly sequential`);
  console.log(`  budget: ${plan.budget.maxMinutes}m total, ${plan.budget.maxSessions} session(s) max · stored in .trust/manager/queue.json`);
  for (const item of plan.items) {
    console.log(`\n  ${item.taskId} [${item.status} → ${item.role || "-"}] (${item.priority}) ${item.title}`);
    console.log(`    provider: ${item.provider.worker}   model: ${item.provider.model || "provider default"}   auth: ${item.provider.auth}  (${item.provider.source})`);
    console.log(`    workspace: ${item.workspace || item.workspaceNote || "-"}   logs: ${item.sessionLogs}`);
    if (item.command) console.log(`    command: ${item.command}`);
    for (const rule of item.containment) console.log(`    containment: ${rule}`);
    for (const blocker of item.blockers) console.log(`    BLOCKED: ${blocker}`);
  }
  console.log(`\nConfirm with: ${plan.confirmCommand}`);
}

const PROVIDER_ROLES = ["pip", "mira", "rowan", "sage", "beacon"];

function saveConfig(config) {
  const temp = `${P.config}.tmp-${process.pid}
```

## Related guides

[Getting started](getting-started.md), [tasks and queues](tasks-and-queues.md), [providers](providers.md), [overnight runs](overnight-runs.md), [configuration](configuration.md).

## Browser and terminal command console

Enter these inside the Control Plane CLI console or the terminal command console. They are not all top-level `atl` subcommands. In particular, the top-level CLI queue command only exposes add, remove, list, and clear; named-queue operations below belong to the console or browser queue UI. Source: `runtime/lib/command-console.mjs`.

| Console syntax | Effect class | Purpose |
|---|---|---|
| `help` | read | list commands |
| `why [task-id]` | read | explain blockers and next actions |
| `show [task-id]` | read | inspect a task or active portfolio |
| `brief` | read | render the manager brief |
| `wake` | read | show the next role actions |
| `feed [--task T-001]` | read | read the team feed |
| `queue list / create / use / rename / reorder / pause / resume / archive / inspect / dry-run / add / remove / clear` | mutation | manage named execution queues |
| `task create / edit / archive / restore ...` | mutation | manage task records safely |
| `plan generate / list / show / frame / card / feedback / approve` | mutation | generate, edit, and approve plan drafts with typed task cards |
| `unblock <task-id> [--to triaged / assigned] [--note text]` | mutation | recover a blocked task |
| `approve <task-id> [--note text]` | confirm | record owner approval and queue |
| `feedback add <task-id> <text> [--mode checkpoint / interrupt]` | mutation | send durable bot feedback |
| `notify list / ack <id> / snooze <id> [minutes]` | mutation | manage notifications |
| `launch --dry-run / --confirm` | confirm | open the bounded launch gate |
