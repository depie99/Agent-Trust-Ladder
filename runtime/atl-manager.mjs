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
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  StateError, STATUSES, paths, emptyState, loadState, saveState, mutateState,
  createTask, logEvent, transition, addEvidence, reviseTaskPacket,
} from "./lib/state.mjs";
import { contractFor, renderRole, ROLE_SLOT } from "./lib/roles.mjs";
import { IntakeError, ghCliAuthenticated, normalizeGitHubRepo, probeGitHubRepo, runIntake } from "./lib/intake.mjs";
import { loadConnections, saveConnections, validateConnection } from "./lib/issue-connections.mjs";
import { dpapiSupported, saveAzureConnection } from "./lib/azure-connection.mjs";
import { WorkspaceError, ensureWorkspace } from "./lib/workspace.mjs";
import { renderBrief, renderTask, wakeActions, saveBrief, activeTasks } from "./lib/render.mjs";
import { post as feedPost, renderFeed, renderRoster } from "./lib/feed.mjs";
import { runDashboard } from "./lib/dashboard.mjs";
import { taskReviewReport } from "./lib/command-console.mjs";
import { buildShowMe, saveShowMe } from "./lib/show-me.mjs";
import { saveVisualPrDescription } from "./lib/visual-pr.mjs";
import { memoryStatus, safeRecall, safeRemember } from "./lib/memory.mjs";
import { forgetLocal, learnLocal } from "./lib/learning.mjs";
import { bundledRoot, formatRoute, isSkillAvailable, routeTaskWithJev } from "./lib/skill-router.mjs";
import { assertWorkerAuth, isTerminal, nextRole, queueSelect, workerEnvPolicy } from "./lib/worker.mjs";
import { applyDeterministicRoute, composeTask, importCandidates } from "./lib/composer.mjs";
import { queueAdd, queueClear, queueIds, queueRemove, loadQueue } from "./lib/queue.mjs";
import { buildLaunchPlan, driveTaskUntilGate, executeLaunchQueue, recoverAfterOutcome, recoverDueBlockedTasks, reconcileOvernightRun, resumeOvernightRun } from "./lib/launch.mjs";
import { discoverProvider, localDefaultModel, providerForRole, providerModels, providerNames, providerProfile, providerSpec } from "./lib/providers.mjs";
import { resourcePolicy, routeTask } from './lib/resource-policy.mjs';
import {
  credentialContext, getProvider, loadUserProviders, maskKey, PROVIDER_TEMPLATES,
  removeProvider, saveUserProviders, templateById, upsertProvider, registryPath, validateProviderEntry, wireMismatches,
} from "./lib/userProviders.mjs";
import { unblockTask, approveTask, explainTasks } from "./lib/recovery.mjs";
import { addResourceToTask } from "./lib/resources.mjs";
import { historySources, listHistory, readTranscript, renderHistoryList, renderTranscript, resolveHistoryRef } from "./lib/history.mjs";
import { listFeedback, submitFeedback } from "./lib/feedback.mjs";
import { bridgeStatus, startDedicatedBridge, syncTeamContext, updateBridgeConfig } from "./lib/codex-bridge.mjs";
import { startControlPlaneServer } from "./lib/control-plane-server.mjs";
import {
  acquireWriterLease, beatOwnerRecord, claimOwnerRecord, daemonStatus, ensureDaemon,
  releaseOwnerRecord, releaseWriterLease, renewWriterLease, runtimeIdentity, sameRuntime, stopDaemon,
  LEASE_WAIT_MS_DEFAULT,
} from "./lib/daemon.mjs";
import { hasWrittenState } from "./lib/state.mjs";
import { assembleContext, buildMap, mapStatus, neighbors, queryMap } from "./lib/navigation.mjs";
import { addClaim, archiveSource, buildContextPack, listClaims, saveContextPack, sourceStatus } from "./lib/brain.mjs";
import { approveClaim, listRoutines, listSkills, promoteSkill, registerRoutine, staleClaims, validateSkill } from "./lib/governance.mjs";
import { registerProject, setSupervisorDefaults, supervisorSnapshot } from "./lib/supervisor.mjs";
import { createWorkerCredential, validateWorkerCredential } from "./lib/session-auth.mjs";
import { acquireLease, leaseAllows, releaseLease, reconcileLeases } from "./lib/leases.mjs";
import { createBackup, listBackups, restoreBackup } from "./lib/backup.mjs";
import { repairContract } from "./lib/queue-recovery.mjs";
import { setVerificationPolicy, setVerifier, testEvidence, verificationPolicy } from "./lib/test-evidence.mjs";
import { snapshot as contentSnapshot } from "./lib/handoffs.mjs";

// Resolve the owning ATL project from nested folders and managed workspaces.
// ATL_PROJECT remains an explicit override for workers and integrations.
function findProjectRoot(start) {
  let current = path.resolve(start);
  while (true) {
    const workspaceMarker = path.join(current, ".atl-workspace.json");
    if (fs.existsSync(workspaceMarker)) {
      try {
        const marker = JSON.parse(fs.readFileSync(workspaceMarker, "utf8"));
        if (typeof marker.project_root === "string" && marker.project_root.trim())
          return path.resolve(current, marker.project_root);
      } catch { /* ignore malformed markers and continue discovery */ }
    }
    if (fs.existsSync(path.join(current, ".atl", "project.json"))
      || fs.existsSync(path.join(current, ".trust", "manager", "state.json"))) return current;
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}
const ROOT = process.env.ATL_PROJECT ? path.resolve(process.env.ATL_PROJECT) : findProjectRoot(process.cwd());
const P = paths(ROOT);

function completeControlPlaneRuntime(candidate) {
  if (!candidate) return null;
  const runtime = path.resolve(candidate);
  return fs.existsSync(path.join(runtime, "control-plane.html"))
    && fs.existsSync(path.join(runtime, "control-plane-client.js"))
    && fs.existsSync(path.join(runtime, "lib", "control-plane-server.mjs"))
    ? runtime
    : null;
}

function preferredControlPlaneRuntime(projectRoot) {
  // A project's own runtime takes priority for a checked-out ATL project.
  const projectRuntime = completeControlPlaneRuntime(path.join(projectRoot, "runtime"));
  if (projectRuntime) return projectRuntime;

  // The installer records its checkout so a globally installed `atl` keeps
  // serving the newest local ATL source while managing another project.
  const installHome = process.env.ATL_INSTALL_DIR ? path.resolve(process.env.ATL_INSTALL_DIR) : path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(installHome, "source.json"), "utf8"));
    const sourceRuntime = completeControlPlaneRuntime(path.join(String(marker.source_root || ""), "runtime"));
    if (sourceRuntime) return sourceRuntime;
    return completeControlPlaneRuntime(path.join(installHome, "runtime"));
  } catch {
    return completeControlPlaneRuntime(path.join(installHome, "runtime"));
  }
}

function openControlPlane(url) {
  if (process.env.ATL_NO_OPEN === "1") return;
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// ---------- one runtime (issue #34): version alignment and the newest-bundle shim

function compareVersions(a, b) {
  const part = (text) => String(text || "0").split(/[-+]/)[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const left = part(a), right = part(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

// The plugin bundle is the runtime; the global CLI defers to a strictly newer
// bundle (by manifest version) by re-execing it, and warns on any mismatch it
// cannot run instead. plugin-host sets ATL_RUNTIME_BUNDLE for its children.
function checkRuntimeMismatch() {
  if (process.env.ATL_RUNTIME_DELEGATED === "1") return null;
  const bundleDir = process.env.ATL_RUNTIME_BUNDLE ? path.resolve(process.env.ATL_RUNTIME_BUNDLE) : null;
  if (!bundleDir || bundleDir === path.dirname(path.dirname(fileURLToPath(import.meta.url)))) return null;
  const own = runtimeIdentity();
  let bundle;
  try { bundle = runtimeIdentity(bundleDir); } catch { return null; }
  if (sameRuntime(own, bundle)) return null;
  const bundleRuntime = path.join(bundleDir, "runtime", "atl-manager.mjs");
  // Delegate only to a complete bundle runtime: re-execing a half-shipped
  // bundle would swap a working CLI for a MODULE_NOT_FOUND.
  const bundleComplete = fs.existsSync(bundleRuntime)
    && fs.existsSync(path.join(bundleDir, "runtime", "lib", "state.mjs"))
    && fs.existsSync(path.join(bundleDir, "runtime", "lib", "control-plane-server.mjs"));
  if (compareVersions(bundle.manifestVersion || bundle.version, own.manifestVersion || own.version) > 0 && bundleComplete) {
    try {
      const child = spawn(process.execPath, [bundleRuntime, ...process.argv.slice(2)], {
        cwd: process.cwd(),
        env: { ...process.env, ATL_RUNTIME_DELEGATED: "1" },
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", () => warnMismatch(own, bundle, bundleDir));
      child.once("close", (code) => process.exit(code ?? 1));
      return { delegated: true };
    } catch { warnMismatch(own, bundle, bundleDir); return { delegated: false }; }
  }
  warnMismatch(own, bundle, bundleDir);
  return { delegated: false };
}

function warnMismatch(own, bundle, bundleDir) {
  const describe = (identity) => `manifest ${identity.manifestVersion || "unknown"}${identity.version ? ` (runtime ${identity.version})` : ""}${identity.commit ? ` commit ${String(identity.commit).slice(0, 7)}` : ""}`;
  console.error(
    `ATL runtime mismatch: CLI ${describe(own)} but plugin bundle ${describe(bundle)} at ${bundleDir}; `
    + `prefer the plugin tools, or update the global CLI (npm i -g @depie99/atl) to align runtimes.`
  );
}

// Attach to an already-running daemon and wait until it goes away. Ctrl+C
// here detaches: the daemon keeps serving other clients.
async function waitUntilDaemonEnds(root) {
  while ((await daemonStatus(root)).alive) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
}

// Owner-process lifecycle (issue #34): keep the daemon record fresh so the
// synchronous writer gate in state.mjs recognizes this owner, and — when
// spawned as a detached daemon — exit after a quiet period instead of
// lingering forever.
function runOwnerLifecycle(root, running) {
  process.once("exit", () => releaseOwnerRecord(root));
  if (process.env.ATL_DAEMON_CHILD === "1") {
    process.on("unhandledRejection", reason => {
      const name = reason instanceof Error ? reason.name : typeof reason;
      process.stderr.write(`[ATL daemon] unhandled background rejection (${String(name).slice(0, 80)}); daemon remains available\n`);
    });
  }
  const beat = setInterval(() => beatOwnerRecord(root), 30000);
  beat.unref?.();
  if (process.env.ATL_DAEMON_CHILD !== "1") return;
  const idleMs = Math.max(60000, Number(process.env.ATL_DAEMON_IDLE_MS || 15 * 60000));
  const idleCheck = setInterval(() => {
    const obs = running.server.atlObservability;
    if (!obs || obs.streamCount() > 0) return;
    if (Date.now() - obs.lastRequestAt() < idleMs) return;
    try {
      const statePath = paths(root).state;
      const mtime = fs.statSync(statePath).mtimeMs;
      if (Date.now() - mtime < idleMs) return;
    } catch { /* no state yet — nothing in flight */ }
    const record = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, ".atl", "daemon.json"), "utf8")); } catch { return null; } })();
    if (record?.lease && Number(record.lease.expires_at || 0) > Date.now()) return; // a writer still holds the lease
    console.log(`ATL project daemon idle for ${Math.round(idleMs / 60000)} min — exiting. The next atl session restarts it at the same URL.`);
    running.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref?.();
  }, 60000);
  idleCheck.unref?.();
}

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
  if (a.startsWith("--ttl=")) { flags.ttl = a.slice("--ttl=".length); continue; }
  if (eat("capture") || eat("file") || eat("cursor") || eat("ttl") || eat("actor") || eat("to") || eat("source") || eat("reason") || eat("priority") || eat("risk") || eat("wake-in") || eat("save") || eat("checkpoint") || eat("task") || eat("n") || eat("title") || eat("label") || eat("caption") || eat("smart") || eat("worker") || eat("provider") || eat("model") || eat("role") || eat("auth") || eat("mode") || eat("max-minutes") || eat("max-sessions") || eat("max-tokens") || eat("confirm") || eat("dry-run") || eat("base-url") || eat("key") || eat("key-env") || eat("template") || eat("repo") || eat("remove") || eat("thread") || eat("port") || eat("host") || eat("symbol") || eat("symbol-id") || eat("limit") || eat("query") || eat("subject") || eat("max-claims") || eat("url") || eat("project") || eat("iteration") || eat("token-env") || eat("name") || eat("token")) continue;
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
  if (a === "--once") { flags.once = true; continue; }
  if (a === "--plain") { flags.plain = true; continue; }
  if (a === "--force") { flags.force = true; continue; }
  if (a === "--all") { flags.all = true; continue; }
  if (a === "--pause-after-bot") { flags.pauseAfterBot = true; continue; }
  if (a === "--no-open") { flags.noOpen = true; continue; }
  if (a === "--fresh") { flags.fresh = true; continue; }
  if (a === "--json") { flags.json = true; continue; }
  if (a === "--expand") { flags.expand = true; continue; }
  if (a === "--mermaid") { flags.mermaid = true; continue; }
  if (a.startsWith("--")) process.stderr.write(`Warning: unrecognized option ${a}; it is being preserved as a positional argument for compatibility.\n`);
  pos.push(a);
}

function usage() {
  return `
atl-manager — persistent coordinator runtime for the ATL digital team
  Run it inside the project it manages (state lives in <project>/.trust/manager).
Install once with scripts/install-atl.cmd (or scripts/install-atl.sh) and use: atl <command>

Setup
  init                          create .trust/manager/ scaffold + config
  projects register             register this local repository with the ATL supervisor
  projects list                 list locally registered repositories
  projects concurrency <1..5>  set the bounded shared provider-session cap
  backup create [--label name] create a recoverable project snapshot
  backup list                  list project snapshots
  backup restore <id>          restore a snapshot (requires no active run)

State owner (one daemon per project owns state.json)
  daemon status                 live owner record: pid, port, URL, writer lease (token masked)
  daemon start                  start or reuse the per-project daemon (stable URL per project)
  daemon stop                   stop the owner; direct writes resume until the next session starts it
  ui [--port n] [--fresh]       open the control plane — reuses the project daemon when one is
                                alive (the URL stays stable); --fresh restarts the owner first.
                                Mutating CLI commands take a writer lease from the owner
                                automatically; with no daemon the direct-write path applies.

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
  verifier <id> "<check>" <type> verification/<script>.mjs
  verification-policy <project|id> <block|allow|inherit>
  test-evidence <id>           report verification attempts and revision freshness
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
  ui [--port n]                 open the latest browser-native ATL control plane
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
  provider add <id> [--template t] [--worker claude|codex|openai-http] [--protocol openai|anthropic|custom] [--base-url url]
                [--key-env VAR] [--model model] [--thinking-level level]
                                store an API provider once per machine in ~/.atl/providers.json
                                (key is prompted without echo; Ctrl+R shows/hides)
  provider key <id> [--key-env VAR]
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
  review <task-id> [--mermaid|--json] [--capture id] [--expand --file id --cursor n]  inspect captured changes
  feed [--task id] [--n 50] [--roster]   the team chat: what every bot did
  routines                      configured when/then triggers
  memory status                 show the optional Mem0 graph-memory provider state
  session start --actor <role> --task <id> [--ttl 2h]
                                issue a scoped, expiring credential for an
                                interactive agent session (ATL_WORKER_CREDENTIAL)
  session stop                  release that session's lease
  --version                     show the runtime version and source commit
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
  harness <operation> [file]    harness planning/program/run API with a JSON request file
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
  if (a !== "manager" && !process.env.ATL_WORKER_CREDENTIAL) throw new StateError("role actor mutations require a scoped ATL_WORKER_CREDENTIAL; --actor alone is not authorization. Supported path: atl session start --actor <role> --task <id>");
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
    throw new StateError(`Missing ${P.config}. Run: atl init`);
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
        repos: [],
        note: "enable with: atl intake enable github --repo owner/name (probes access first); public repos work unauthenticated, private need gh auth login or GITHUB_TOKEN",
      },
      azure: {
        enabled: false,
        org_url: "",
        project: "",
        team: "",
        iteration_path: "",
        token_env: "AZDO_PAT",
        tls_allow_untrusted: false,
        note: "Configure your Azure DevOps connection and provide AZDO_PAT before enabling intake.",
      },
    },
    workspaces: {
      root: ".trust/manager/workspaces",
      repos: {},
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
  if (!opts.dryRun && finalTask) {
    const evidence = outcome.evidence?.checks ? outcome.evidence : testEvidence(finalTask);
    console.log(`Test Evidence: ${evidence.verified ? "verified" : "unverified"}`);
    for (const check of evidence.checks) console.log(`  ${check.status}: ${check.expected}`);
    console.log(`Evidence details: atl test-evidence ${taskId}`);
  }
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
  for (const result of results) {
    console.log(`  ${String(result.id).padEnd(6)} ${String(result.status).padEnd(12)} ${result.reason}`);
    const task = after.tasks[result.id];
    if (!task) continue;
    const evidence = testEvidence(task, task.verification_revision, ROOT);
    console.log(`    Test Evidence: ${evidence.verified ? "verified" : "unverified"} (atl test-evidence ${task.id})`);
  }
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
  const temp = `${P.config}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n");
  try {
    fs.renameSync(temp, P.config);
  } catch (error) {
    // Windows does not replace an existing file with renameSync. The temp
    // file still protects against a partial write, then is copied into place.
    fs.copyFileSync(temp, P.config);
    fs.rmSync(temp, { force: true });
    if (error && !fs.existsSync(P.config)) throw error;
  }
}

function printProviders(cfg) {
  const profile = providerProfile(cfg);
  const registry = profile.userProviders || {};
  const registryIds = Object.keys(registry);
  console.log("Your providers (~/.atl/providers.json — API keys stored outside every repo):");
  if (!registryIds.length) {
    console.log("  (none yet — add one: atl provider add zai --model glm-4.6, then enter the key at the hidden prompt)");
    console.log("  or in the control room: atl ui → press p → press a");
  }
  for (const id of registryIds) {
    const entry = registry[id];
    const problems = validateProviderEntry(entry);
    const mark = problems.length ? "×" : "✓";
    const inUse = profile.use === id ? " · IN USE (project default)" : "";
    const roleUse = PROVIDER_ROLES.filter((role) => (profile.byRole[role] || "") === id);
    console.log(`  ${mark} ${id.padEnd(12)} ${entry.worker} · ${entry.model || "no model"} · key ${maskKey(entry.api_key)}${inUse}${roleUse.length ? ` · roles: ${roleUse.join(", ")}` : ""}`);
    console.log(`     ${entry.base_url || "(no base URL)"}`);
    for (const problem of problems) console.log(`     ! ${problem}`);
  }
  console.log("\nBuilt-in workers (subscription auth, no key stored):");
  for (const name of providerNames(cfg).filter((n) => !registry[n])) {
    const spec = providerSpec(profile, name);
    const disc = discoverProvider(name, { command: spec.command });
    const model = spec.model || "provider default";
    console.log(`  ${disc.available ? "✓" : "×"} ${name.padEnd(12)} ${disc.available ? `${disc.path} · model ${model} · auth ${spec.auth}` : `${disc.error} · model ${model}`}`);
  }
  console.log("\nPer-role mapping (the provider/model actually used by each ATL role):");
  for (const role of PROVIDER_ROLES) {
    const p = providerForRole(profile, role);
    console.log(`  ${role.padEnd(7)} ${p.worker} · ${p.model || "provider default"} · auth ${p.auth}  (${p.source})`);
  }
  console.log("\nAdd a provider:   atl provider add zai --model glm-5.3 --thinking-level medium");
  console.log("Use it here:      atl provider use zai   (or per role: atl provider use zai --role rowan)");
  console.log("Other commands:   provider key · provider remove · provider templates · atl ui → p");
}

function updateProviderSelection({ clear = false } = {}) {
  const cfg = loadConfig();
  const providers = cfg.providers || (cfg.providers = {});
  providers.by_role = providers.by_role || {};
  providers.model_by_role = providers.model_by_role || {};
  providers.catalog = providers.catalog || {};
  const role = flags.role && String(flags.role).toLowerCase() !== "default" ? String(flags.role).toLowerCase() : null;
  if (role && !PROVIDER_ROLES.includes(role)) {
    throw new StateError(`--role must be one of ${PROVIDER_ROLES.join(", ")}`);
  }
  if (clear) {
    if (!role) throw new StateError("provider clear needs --role <pip|mira|rowan|sage|beacon>");
    delete providers.by_role[role];
    delete providers.model_by_role[role];
    saveConfig(cfg);
    console.log(`Cleared the ${role} provider/model override. It now follows the default selection.`);
    return;
  }
  const worker = flags.provider && String(flags.provider).toLowerCase();
  if (!worker) throw new StateError("provider set needs --provider <id>");
  const registry = loadUserProviders();
  const regEntry = registry.providers[worker] || null;
  if (regEntry && flags.model) {
    upsertProvider(registry, worker, { model: String(flags.model) });
    saveUserProviders(registry);
  }
  if (role) {
    const previous = providers.by_role[role];
    providers.by_role[role] = worker;
    if (flags.model && !regEntry) providers.model_by_role[role] = String(flags.model);
    else if (previous && previous !== worker) delete providers.model_by_role[role];
  } else if (regEntry) {
    providers.use = worker;
  } else {
    const previous = providers.default;
    providers.default = worker;
    if (flags.model) {
      providers.model = String(flags.model);
      if (providers.catalog[worker] && typeof providers.catalog[worker] === "object") {
        providers.catalog[worker].model = String(flags.model);
      }
    }
    else if (previous && previous !== worker) delete providers.model;
    if (flags.auth) providers.auth = String(flags.auth).toLowerCase();
  }
  saveConfig(cfg);
  const selected = providerForRole(providerProfile(cfg), role || "rowan");
  console.log(`Saved ${role ? `${role} role` : "default"} selection: ${selected.worker} · ${selected.model || "provider default"} · auth ${selected.auth}${selected.userProvider ? ` (user provider "${selected.userProvider.id}", key injected at spawn)` : ""}`);
  console.log(`Verify: atl providers   Preview: atl launch --dry-run`);
}

// ---------- intake source config (`atl intake status|enable|disable`)

const INTAKE_SOURCES = ["file", "github", "azure"];

async function printIntakeStatus(only = "all") {
  const cfg = loadConfig();
  const sources = cfg.intake || {};
  const want = (name) => only === "all" || only === name;
  console.log("Intake sources (config/manager.json):");

  if (want("file")) {
    const dir = path.resolve(ROOT, cfg.inbox_dir);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md")) : [];
    console.log(`  file     ${(sources.file?.enabled !== false ? "enabled " : "disabled")}  inbox ${cfg.inbox_dir} (${files.length} markdown file${files.length === 1 ? "" : "s"})`);
  }
  if (want("github")) {
    const gh = sources.github || {};
    const repos = gh.repos || [];
    console.log(`  github   ${gh.enabled ? "enabled " : "disabled"}  repos: ${repos.length ? repos.join(", ") : "(none — add with --repo owner/name)"}`);
    if (only === "github" || gh.enabled || repos.length) {
      const ghAuthed = await ghCliAuthenticated();
      const tokenSet = Boolean(process.env.GITHUB_TOKEN);
      console.log(`           auth: gh cli ${ghAuthed ? "logged in" : "not logged in"} · GITHUB_TOKEN ${tokenSet ? "set" : "not set"}${!ghAuthed && !tokenSet ? "  (private repos will 404 — fix with: gh auth login)" : ""}`);
    }
  }
  if (want("azure")) {
    const az = sources.azure || {};
    const tokenEnv = az.token_env || "AZDO_PAT";
    console.log(`  azure    ${az.enabled ? "enabled " : "disabled"}  ${az.org_url || "(no org_url)"} · ${az.project || "(no project)"} · ${az.iteration_path || "(no iteration_path)"}`);
    console.log(`           auth: ${tokenEnv} ${process.env[tokenEnv] ? "set" : "not set"}`);
  }
  // Saved issue-source connections (what the ATL UI manages). The CLI can
  // only see durable credentials (DPAPI vaults, environment); session tokens
  // live inside the running server and are intentionally invisible here.
  try {
    const store = loadConnections(ROOT, cfg.intake || {});
    if (store.connections.length) {
      console.log("\nSaved connections (Issue sources):");
      for (const connection of store.connections) {
        const envName = connection.provider === "jira" ? connection.settings.token_env || "JIRA_TOKEN" : "AZDO_PAT";
        const durable = connection.credential_ref === "os-protected";
        const fromEnv = connection.provider !== "github" && Boolean(process.env[envName]);
        const marker = store.defaults[connection.provider] === connection.id ? " (default)" : "";
        const credential = durable ? "credential saved on this account" : fromEnv ? "credential from environment" : "no durable credential (session-only or none)";
        console.log(`  ${connection.provider.padEnd(6)} ${connection.name}${marker} — ${connection.enabled ? "enabled" : "paused"}, ${connection.status || "unchecked"}, ${credential}`);
        if (connection.provider === "azure" && (connection.status === "needs-auth" || (!durable && !fromEnv))) {
          console.log("         fix: atl intake connect azure --token -   (or ATL UI → Issue sources → Re-authenticate)");
        }
      }
    }
  } catch { /* unreadable store — legacy status above still stands */ }
  console.log(`\nEnable:   atl intake enable <file|github|azure> [--repo owner/name]`);
  console.log(`Disable:  atl intake disable <file|github|azure>`);
  console.log(`Reconnect: atl intake connect azure [--url … --project …] --token -`);
}

async function intakeConfigCommand(sub) {
  const cfg = loadConfig();
  const sources = cfg.intake || (cfg.intake = {});
  const source = String(sub === "status" ? (flags.source || "all") : pos[1] || "").toLowerCase();

  if (sub === "status") {
    if (source !== "all" && !INTAKE_SOURCES.includes(source)) {
      throw new StateError(`intake status --source must be one of: ${INTAKE_SOURCES.join(" | ")}`);
    }
    await printIntakeStatus(source);
    return;
  }

  if (sub === "connect") return connectAzureCommand();

  if (!INTAKE_SOURCES.includes(source)) {
    throw new StateError(`intake ${sub} needs a source: ${INTAKE_SOURCES.join(" | ")}`);
  }
  const entry = sources[source] || (sources[source] = {});

  if (sub === "disable") {
    entry.enabled = false;
    saveConfig(cfg);
    console.log(`${source} intake disabled (repos/urls kept in config).`);
    console.log(`Re-enable with: atl intake enable ${source}`);
    return;
  }

  if (source === "file") {
    entry.enabled = true;
    saveConfig(cfg);
    console.log(`file intake enabled (inbox: ${cfg.inbox_dir}).`);
    return;
  }

  if (source === "azure") {
    const tokenEnv = entry.token_env || "AZDO_PAT";
    if (!process.env[tokenEnv] && !flags.force) {
      console.log("azure intake NOT enabled — the personal access token is missing.");
      console.log(`  1. On ${entry.org_url || "the Azure DevOps server"} create a PAT (Work Items: Read).`);
      console.log(`  2. set ${tokenEnv}=<token>   (PowerShell: $env:${tokenEnv}="<token>")`);
      console.log(`  3. re-run: atl intake enable azure   (or --force to enable without the token)`);
      return;
    }
    entry.enabled = true;
    saveConfig(cfg);
    console.log(`azure intake enabled (${entry.project || "project"} · ${entry.iteration_path || "no iteration set"}${process.env[tokenEnv] ? "" : ` · warning: ${tokenEnv} is not set`}).`);
    console.log(`Pull now: atl intake --source azure`);
    return;
  }

  // github — probe every configured repo through the same gh-CLI → REST path
  // the adapter uses, so a private-repo 404 surfaces here with the fix.
  const toRemove = String(flags.remove || "").split(",").map(normalizeGitHubRepo).filter(Boolean);
  if (toRemove.length) {
    entry.repos = (entry.repos || []).map(normalizeGitHubRepo).filter((repo) => !toRemove.includes(repo));
  }
  const requested = String(flags.repo || "").split(",").map(normalizeGitHubRepo).filter(Boolean);
  for (const repo of requested) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      throw new StateError(`--repo expects owner/name, got "${repo}"`);
    }
  }
  entry.repos = [...new Set([...(entry.repos || []), ...requested])];
  if (!entry.repos.length) {
    saveConfig(cfg);
    console.log(`github repo list is now empty${toRemove.length ? ` (removed: ${toRemove.join(", ")})` : ""}. Add one with: atl intake enable github --repo owner/name`);
    return;
  }
  console.log(`Probing ${entry.repos.length} repo(s) the way intake will read them…`);
  const unreachable = [];
  for (const repo of entry.repos) {
    const probe = await probeGitHubRepo(repo);
    if (probe.ok) {
      console.log(`  ✓ ${repo} — reachable via ${probe.via}, ${probe.open_issues} open issue(s)`);
    } else {
      unreachable.push(repo);
      console.log(`  × ${repo} — ${String(probe.error).split("\n")[0]}`);
    }
  }
  if (unreachable.length && !flags.force) {
    console.log(`\ngithub intake NOT enabled for: ${unreachable.join(", ")}.`);
    console.log(`  Fix access, then retry:             gh auth login  ·  or set GITHUB_TOKEN=<repo read token>`);
    console.log(`  Drop a stale repo and retry:        atl intake enable github --remove ${unreachable.join(",")} --repo ${entry.repos.filter((r) => !unreachable.includes(r)).join(",") || "owner/name"}`);
    console.log(`  Enable anyway (will 404 at intake): atl intake enable github --repo ${entry.repos.join(",")} --force`);
    return;
  }
  entry.enabled = true;
  entry.note = `enabled via 'atl intake enable github' on ${new Date().toISOString().slice(0, 10)}`;
  saveConfig(cfg);
  console.log(`\ngithub intake enabled for: ${entry.repos.join(", ")}`);
  console.log(`Pull now: atl intake --source github`);
}

// ---------- commands

// Reconnect (or create) the saved Azure connection from the terminal — the
// same durable surfaces the ATL UI writes: the per-connection DPAPI vault and
// the connection store, plus the legacy home vault and config.intake.azure
// that My Tasks and intake pulls read. Session-only credentials cannot cross
// a process boundary to a running server, so the CLI always persists.
async function connectAzureCommand() {
  if (flags.token && flags.token !== "-") {
    throw new StateError('Passing the PAT as a --token value exposes it in the process list. Use --token - (pipe it via stdin) or run in a terminal for a hidden prompt.');
  }
  const cfg = loadConfig();
  const store = loadConnections(ROOT, cfg.intake || {});
  let record = store.connections.find((c) => c.id === store.defaults.azure && c.provider === "azure")
    || store.connections.find((c) => c.provider === "azure" && c.enabled)
    || null;
  const url = String(flags.url || "");
  const project = String(flags.project || "");
  if (!record && !(url && project)) {
    throw new StateError("No saved Azure connection found. Add --url https://server/collection and --project NAME to create one, or connect from the ATL UI (Issue sources).");
  }
  const validated = validateConnection({
    provider: "azure",
    name: String(flags.name || record?.name || `${project || record.settings.project} (Azure Boards)`),
    org_url: url || record.settings.org_url,
    project: project || record.settings.project,
    iteration_path: String(flags.iteration || record?.settings.iteration_path || ""),
    token_env: String(flags["token-env"] || record?.settings.token_env || "AZDO_PAT"),
    enabled: true,
  });

  let token = "";
  if (flags.token === "-") token = fs.readFileSync(0, "utf8").trim();
  else if (process.stdin.isTTY && process.stdout.isTTY) token = (await promptSecret(`PAT for ${validated.settings.org_url}`)).trim();
  else token = String(process.env[validated.settings.token_env] || "").trim();
  if (!token) {
    throw new StateError(`No PAT supplied. Pipe one (… | atl intake connect azure --token -), run in a terminal for a hidden prompt, or set ${validated.settings.token_env}.`);
  }
  if (token.length > 4096 || /[\r\n]/.test(token)) throw new StateError("Enter a valid Azure PAT.");

  // CLI credentials are always remembered: a session credential could not be
  // handed to the (separate) server process even if one is running.
  if (!(await dpapiSupported())) {
    throw new StateError('Windows credential protection (DPAPI) is unavailable here, so the CLI cannot persist the PAT. Reconnect in the ATL UI (Issue sources → Re-authenticate) without "Remember securely" to keep it for that server session.');
  }

  if (!record) {
    record = { id: crypto.randomUUID(), ...validated, status: "unchecked", checked_at: null };
    store.connections.push(record);
    store.defaults.azure ||= record.id;
  } else {
    Object.assign(record, validated);
  }
  record.status = "unchecked";
  record.checked_at = null;
  // Write the vaults before the store marks credential_ref, so a failed
  // DPAPI save can never leave the store pointing at a missing credential.
  await saveAzureConnection(record.settings, token, { dir: path.join(ROOT, ".trust", "manager", "credentials", record.id) });
  await saveAzureConnection(record.settings, token);
  record.credential_ref = "os-protected";
  saveConnections(ROOT, store, store.revision);

  cfg.intake ||= {};
  cfg.intake.azure = {
    ...(cfg.intake.azure || {}),
    org_url: record.settings.org_url,
    project: record.settings.project,
    iteration_path: record.settings.iteration_path || "",
    token_env: record.settings.token_env,
    enabled: true,
  };
  saveConfig(cfg);

  console.log(`Azure connection "${record.name}" saved for ${record.settings.org_url} · ${record.settings.project}.`);
  console.log("  Credential encrypted for this Windows account (connection store + legacy vault).");
  console.log("  A running ATL server picks the new credential up automatically within a few seconds.");
  console.log("Verify: atl intake --source azure   ·   ATL UI → Issue sources → Check access");
}

async function promptSecret(prompt) {
  const input = process.stdin;
  if (!input.isTTY || !process.stdout.isTTY || typeof input.setRawMode !== "function") {
    throw new StateError("No provider key supplied. Use --key-env VAR in non-interactive shells, or run this command in a terminal for a hidden prompt.");
  }
  readline.emitKeypressEvents(input);
  return new Promise((resolve, reject) => {
    let value = "", revealed = false, finished = false;
    const draw = () => {
      const shown = revealed ? value : "•".repeat([...value].length);
      process.stdout.write(`\r\x1b[2K${prompt}: ${shown}`);
    };
    const cleanup = () => {
      if (finished) return;
      finished = true;
      input.removeListener("keypress", onKey);
      input.removeListener("end", onEof);
      input.removeListener("close", onEof);
      try { input.setRawMode(false); } catch { /* stdin may already be closed */ }
      input.pause();
      process.stdout.write("\r\x1b[2K\n");
    };
    const onEof = () => { cleanup(); reject(new StateError("Credential entry ended because stdin closed.")); };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === "c") { cleanup(); reject(new StateError("Credential entry cancelled.")); return; }
      if (key.ctrl && key.name === "r") { revealed = !revealed; draw(); return; }
      if (key.name === "return" || key.name === "enter") { cleanup(); resolve(value); return; }
      if (key.name === "backspace" || key.name === "delete") { value = [...value].slice(0, -1).join(""); draw(); return; }
      if (!key.ctrl && !key.meta && typeof text === "string" && text && !/[\r\n\u0000-\u001f\u007f]/.test(text)) { value += text; draw(); }
    };
    process.stdout.write(`${prompt} (hidden; Ctrl+R shows/hides): `);
    input.on("keypress", onKey);
    input.once("end", onEof);
    input.once("close", onEof);
    input.setRawMode(true);
    input.resume();
  });
}

async function dispatch() {
  switch (cmd) {
    case "--version":
    case "-v":
    case "version": {
      // One runtime (issue #34): report the manifest version and bundle commit
      // the same way atl_info does, so CLI and plugin always agree.
      const installDir = process.env.ATL_INSTALL_DIR || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
      const identity = runtimeIdentity(installDir);
      const bits = [`ATL runtime ${identity.version}`];
      if (identity.commit) bits.push(`(${String(identity.commit).slice(0, 7)})`);
      if (identity.manifestVersion) bits.push(`manifest ${identity.manifestVersion}`);
      console.log(bits.join(" "));
      return;
    }
    case "harness": {
      const operation = pos[0];
      if (!/^(plan\/(context|save|answer|review|approve)|run\/(preview|start|status|stop)|program\/(save|status|approve|reconcile|bind|start|stop)|project\/bootstrap)$/.test(operation || '')) throw new StateError('Use: atl harness <operation> [request.json]');
      const payload = pos[1] ? JSON.parse(fs.readFileSync(path.resolve(pos[1]), 'utf8')) : {};
      const daemon = await ensureDaemon(ROOT);
      const response = await fetch(new URL(`/api/harness/${operation}`, daemon.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      console.log(JSON.stringify(result, null, 2));
      if (!response.ok || result.ok === false) process.exitCode = 1;
      return;
    }
    case "init": {
      const workspaceRoot = path.join(ROOT, ".trust", "manager", "workspaces");
      const relativeToWorkspace = path.relative(workspaceRoot, ROOT);
      if (relativeToWorkspace === "" || (!relativeToWorkspace.startsWith(`..${path.sep}`) && relativeToWorkspace !== ".." && !path.isAbsolute(relativeToWorkspace))) {
        throw new StateError("Refusing to initialize a nested task workspace. Run atl commands from the owning project.");
      }
      const ignoreFile = path.join(ROOT, ".gitignore");
      const runtimeIgnore = [
        "# The whole .trust/ folder is local runtime state — never commit or push it.",
        "/.trust/", "/.atl/", "/.atl-evidence/", "/.humanlayer/", "/.tmp-*/",
        "providers.json", "owner-session.json", ".env", ".env.*", "!.env.template",
      ].join("\n");
      const currentIgnore = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "";
      if (["/.trust/", "/.atl/", "/.atl-evidence/", "/.humanlayer/"].some((rule) => !currentIgnore.includes(rule))) {
        fs.appendFileSync(ignoreFile, `${currentIgnore && !currentIgnore.endsWith("\n") ? "\n" : ""}\n${runtimeIgnore}\n`);
      }
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
      const jevConfig = path.join(ROOT, "config", "jev.json");
      if (!fs.existsSync(jevConfig) && fs.existsSync(path.join(bundledRoot(), "config", "jev.json"))) {
        fs.copyFileSync(path.join(bundledRoot(), "config", "jev.json"), jevConfig);
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
      console.log(`  skill route:${P.skillRouting}\n  Jev config:${jevConfig}\n  project:   ${projectMeta}`);
      console.log(`\nNext: add a task file to the inbox, then: atl intake   (or: node runtime\\atl-manager.mjs intake)`);
      return;
    }

    case "intake": {
      const sub = pos[0];
      if (sub === "status" || sub === "enable" || sub === "disable" || sub === "connect") {
        await intakeConfigCommand(sub);
        return;
      }
      const cfg = loadConfig();
      const state = loadState(ROOT);
      const which = flags.source || "all";
      let batches;
      try {
        batches = await runIntake({ ...cfg, inbox_dir: path.resolve(ROOT, cfg.inbox_dir) }, which);
      } catch (error) {
        if (/401|403|unauthori|forbidden|credential|token/i.test(String(error?.message))) {
          // A rejected credential gets the fix path inline, not a bare error.
          throw new StateError(`${error.message}\n  The saved credential was rejected. Fix it with:\n    atl intake connect azure --token -   (pipe a PAT, or hidden prompt in a terminal)\n    ATL UI → Issue sources → connection card → Re-authenticate`);
        }
        throw error;
      }
      let added = 0, skipped = 0;
      for (const b of batches) {
        const result = importCandidates(ROOT, state, b.tasks, { cfg });
        added += result.added;
        skipped += result.skipped;
        for (const { task, routine } of result.created) {
          console.log(`  + ${task.id} [new] (${b.source})${routine ? ` [routine: ${routine.name}]` : ""} ${task.title}`);
        }
      }
      saveState(ROOT, state);
      console.log(`\nIntake done: ${added} new, ${skipped} already known. Next: node runtime\\atl-manager.mjs triage <task-id> (as Pip).`);
      return;
    }

    case "compose": {
      const body = pos.join(" ").trim();
      const title = typeof flags.title === "string" ? flags.title.trim() : "";
      if (!body && !title) throw new StateError('compose needs the task text, e.g.: atl compose --title "Fix the login redirect" --check "signed-in user lands on /dashboard"');
      let text = [title, body].filter(Boolean).join("\n");
      if (flags.check.length) text += `\nChecks:\n${flags.check.map((c) => `- ${c}`).join("\n")}`;
      const cfg = loadConfig();
      // mutateState retries on revision conflict so parallel composes (CLI,
      // plugin, Control Plane) cannot silently drop a task (issue #31).
      const { result: { task, created, draftPath } } = mutateState(ROOT, (state) => composeTask(ROOT, state, text, { source: "manual", cfg }));
      if (created) {
        console.log(`  + ${task.id} [new] (composer) ${task.title}`);
        console.log(`  draft: ${draftPath}  (immutable raw wording)`);
        say("manager", `composed ${task.id} in the control room: "${task.title}". waiting for the packet review.`, { task: task.id });
      } else {
        console.log(`Already composed: ${task.id} — "${task.title}" (compose is idempotent by content)`);
      }
      console.log(`Next: review the packet (atl ui → select → v) or triage: node runtime\\atl-manager.mjs triage ${task.id}`);
      return;
    }

    case "queue": {
      const sub = pos[0] || "list";
      if (sub === "add") {
        const id = pos[1];
        need(id);
        const { added } = queueAdd(ROOT, id, { by: actorOf() });
        console.log(added ? `${id} queued for execution (membership is stored in .trust/manager/queue.json).` : `${id} is already queued.`);
      } else if (sub === "remove") {
        const id = pos[1];
        if (!id) throw new StateError("queue remove needs a task id");
        const { removed } = queueRemove(ROOT, id);
        console.log(removed ? `${id} removed from the execution queue.` : `${id} was not queued.`);
      } else if (sub === "clear") {
        const { removed } = queueClear(ROOT);
        console.log(`Queue cleared (${removed} entr${removed === 1 ? "y" : "ies"} removed).`);
      } else if (sub === "list") {
        printLaunchPlan(buildLaunchPlan(ROOT, { taskIds: queueIds(ROOT) }));
      } else {
        throw new StateError("queue subcommands: add <id> | remove <id> | list | clear");
      }
      return;
    }

    case "feedback": {
      const sub = pos[0] || "list";
      if (sub === "list") {
        console.log(JSON.stringify(listFeedback(ROOT, { taskId: pos[1] || null }), null, 2));
      } else if (sub === "add") {
        const taskId = pos[1];
        const prompt = pos.slice(2).join(" ").trim();
        if (!taskId || !prompt) throw new StateError('feedback add needs a task id and quoted prompt');
        const item = submitFeedback(ROOT, { taskId, prompt, mode: String(flags.mode || "checkpoint"), role: flags.role || null });
        say("manager", `feedback queued for ${taskId} (${item.mode}) — the next applicable bot will receive it.`, { task: taskId, detail: item.id });
        console.log(JSON.stringify(item, null, 2));
      } else {
        throw new StateError("feedback subcommands: list [task-id] | add <task-id> \"prompt\" [--mode checkpoint|interrupt]");
      }
      return;
    }

    case "launch": {
      const opts = parseWorkerFlags({ overnight: true });
      const launchOverrides = {};
      if (flags.worker) launchOverrides.worker = opts.worker;
      if (flags.auth) launchOverrides.auth = opts.auth;
      if (flags.model) launchOverrides.model = opts.provider.model;
      const plan = buildLaunchPlan(ROOT, { taskIds: queueIds(ROOT), maxMinutes: opts.maxMinutes, maxSessions: opts.maxSessions, providerDefaults: launchOverrides });
      printLaunchPlan(plan);
      if (opts.dryRun) {
        console.log("\ndry-run: no agent started.");
        return;
      }
      if (plan.blockedCount) {
        console.log(`\n${plan.blockedCount} queued task(s) have launch blockers — they will be containment-blocked and skipped.`);
      }
      console.log("\nStarting sequential queue run…");
      const overrides = {};
      if (flags.worker) overrides.worker = opts.worker;
      if (flags.auth) overrides.auth = opts.auth;
      if (flags.model) overrides.model = opts.provider.model;
      const { results, budget } = await executeLaunchQueue(ROOT, {
        maxMinutes: opts.maxMinutes, maxSessions: opts.maxSessions, confirm: true, providerDefaults: overrides,
        onSession: syncBridgeSession,
        pauseAfterSession: flags.pauseAfterBot === true,
        onReview: async (summary) => {
          console.log(`\nPaused after ${summary.taskId}/${summary.role}. Review the brief and press Enter in the controlling TTY to continue.`);
          if (!process.stdin.isTTY) return "continue";
          return new Promise((resolve) => process.stdin.once("data", () => resolve("continue")));
        },
      });
      console.log(`\nQueue run finished after ${budget.sessions} session(s). Results:`);
      for (const r of results) console.log(`  ${String(r.id).padEnd(6)} ${String(r.status).padEnd(12)} ${r.reason}`);
      const finalState = loadState(ROOT);
      console.log(`\nMorning report: atl brief   ·   transcript: atl feed --roster   ·   queue: atl queue list`);
      return;
    }

    case "providers":
    case "provider": {
      const sub = cmd === "providers" ? "list" : (pos[0] || "list");
      if (sub === "list") {
        printProviders(loadConfig());
      } else if (sub === "models") {
        const cfg = loadConfig();
        const profile = providerProfile(cfg);
        const name = String(flags.provider || pos[1] || profile.defaultWorker).toLowerCase();
        const spec = providerSpec(profile, name);
        const ids = [...new Set([...(spec.models || []), ...providerModels(name).map((m) => m.id)])];
        console.log(`Models for ${name}:`);
        if (!ids.length) console.log("  No model registry is available; enter the exact model id accepted by this provider.");
        for (const id of ids) {
          const entry = providerModels(name).find((m) => m.id === id);
          console.log(`  ${id}${entry?.label && entry.label !== id ? ` — ${entry.label}` : ""}${id === spec.model ? "  (selected)" : ""}`);
        }
        console.log(`\nCurrent effective model: ${spec.model || "provider default"}`);
      } else if (sub === "set") {
        updateProviderSelection();
      } else if (sub === "clear") {
        updateProviderSelection({ clear: true });
      } else if (sub === "templates") {
        console.log("Provider templates (pre-filled base URLs; the model id comes from your plan):");
        for (const t of PROVIDER_TEMPLATES) {
          console.log(`  ${t.id.padEnd(10)} ${t.label}`);
          console.log(`             claude → ${t.baseUrl.claude || "(you supply the endpoint)"}`);
          console.log(`             codex  → ${t.baseUrl.codex || "(you supply the endpoint)"}`);
        }
        console.log("\nUse one: atl provider add zai --model glm-5.3 --thinking-level medium   (key is prompted without echo)");
      } else if (sub === "add") {
        const id = pos[1];
        if (!id) throw new StateError("provider add needs a name: provider add <id> [--template t] [--worker claude|codex|openai-http] [--protocol openai|anthropic|custom] [--base-url url] [--key-env VAR] [--model model] [--thinking-level level]");
        const template = templateById(flags.template || (templateById(id) ? id : "custom"));
        const worker = String(flags.worker || template.worker || "claude").toLowerCase();
        if (!["claude", "codex", "openai-http"].includes(worker)) throw new StateError("--worker must be claude, codex, or openai-http");
        const base = flags["base-url"] || template.baseUrl[worker] || "";
        if (flags.key !== undefined) throw new StateError("--key is not accepted because command arguments may be visible in process lists. Use --key-env VAR or the hidden prompt.");
        const key = flags["key-env"]
            ? (process.env[String(flags["key-env"])] || "").trim()
            : await promptSecret("Provider API key / token");
        if (flags["key-env"] && !key) throw new StateError(`--key-env ${flags["key-env"]} is not set in this shell`);
        if (!key) throw new StateError("No key entered. Use a non-empty key or --key-env VAR.");
        if (worker === "claude" && !base && !flags["base-url"]) {
          throw new StateError("a base URL is required for custom providers: --base-url https://your-endpoint/api/anthropic");
        }
        const registry = loadUserProviders();
         const entry = upsertProvider(registry, id, {
           label: template.id === "custom" ? id : template.label,
           protocol: flags.protocol || template.protocol || "custom",
           worker,
           base_url: String(base),
           api_key: key,
           model: flags.model ? String(flags.model) : (template.models[0] || ""),
           models: template.models,
           thinking_level: flags["thinking-level"] || flags.thinking || "",
           thinking_levels: template.thinkingLevels,
         });
        const wireProblems = wireMismatches(entry.worker, entry.base_url);
        if (wireProblems.length) throw new StateError(`refusing to save "${entry.id}": ${wireProblems.join("; ")}`);
        saveUserProviders(registry);
        console.log(`Saved provider "${entry.id}" in ${registryPath()}`);
        console.log(`  worker: ${entry.worker}   model: ${entry.model || "(none)"}   key: ${maskKey(entry.api_key)}`);
        console.log(`  base:   ${entry.base_url || "(none — custom endpoints need --base-url)"}`);
        console.log(`Use it in this project:  atl provider use ${entry.id}`);
      } else if (sub === "key") {
        const id = pos[1];
        if (!id) throw new StateError("provider key needs a name: provider key <id> [--key-env VAR]");
        if (flags.key !== undefined) throw new StateError("--key is not accepted because command arguments may be visible in process lists. Use --key-env VAR or the hidden prompt.");
        const key = flags["key-env"]
            ? (process.env[String(flags["key-env"])] || "").trim()
            : await promptSecret("Provider API key / token");
        if (flags["key-env"] && !key) throw new StateError(`--key-env ${flags["key-env"]} is not set in this shell`);
        if (!key) throw new StateError("No key entered. Use a non-empty key or --key-env VAR.");
        const registry = loadUserProviders();
        const entry = getProvider(registry, id);
        if (!entry) throw new StateError(`no provider named "${id}" — add it first: atl provider add ${id} --key ...`);
        upsertProvider(registry, id, { api_key: key });
        saveUserProviders(registry);
        console.log(`Updated the key for "${id}": ${maskKey(key)} (stored in ~/.atl/providers.json)`);
      } else if (sub === "use") {
        const id = pos[1] || flags.provider;
        if (!id) throw new StateError("provider use needs a name: provider use <id> [--role role]");
        const registry = loadUserProviders();
        const entry = getProvider(registry, id);
        const builtin = new Set(["codex", "claude", "gapgpt"]);
        if (!entry && !builtin.has(String(id).toLowerCase())) throw new StateError(`no provider named "${id}" in ~/.atl/providers.json or built-in workers`);
        flags.provider = entry?.id || String(id).toLowerCase();
        updateProviderSelection();
      } else if (sub === "remove") {
        const id = pos[1];
        if (!id) throw new StateError("provider remove needs a name: provider remove <id>");
        const registry = loadUserProviders();
        const entry = removeProvider(registry, id);
        saveUserProviders(registry);
        console.log(`Removed "${entry.id}" from ~/.atl/providers.json.`);
        console.log("If this project still selects it, point roles elsewhere: atl provider use <other-id> (or provider set --provider codex).");
      } else {
        throw new StateError("provider subcommands: list | templates | add <id> | key <id> | use <id> [--role role] | remove <id> | set --provider id | clear --role role | models [--provider id]");
      }
      return;
    }

    case "triage": {
      const { state, task } = need(pos[0]);
      const routing = JSON.parse(fs.readFileSync(P.routing, "utf8"));
      const route = await applySkillRoute(task, { smart: Boolean(flags.smart) });
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
      const route = await applySkillRoute(task, { smart: Boolean(flags.smart) });
      saveState(ROOT, state);
      console.log(formatRoute(route));
      return;
    }

    case "update": {
      const { state, task } = need(pos[0]);
      const actor = knownActor(task.id);
      const contract = actor !== "manager" ? contractFor(actor) : null;
      if (actor === "pip" && task.pip_repair_request && (flags.objective || flags.check.length || Object.keys(flags.set).length)) throw new StateError("a requested Pip repair must use contract-repair; the approved objective and acceptance cannot change through update");

      if (task.status === "new" && actor && !["pip", "manager", "mira"].includes(actor)) {
        throw new StateError(`${task.id}: only Pip (or the manager) may shape a task in triage`);
      }
      let packetChanged = false;
      for (const [k, v] of Object.entries(flags.set)) {
        const writable = contract ? contract.may_write : null;
        const base = k.split(".")[0];
        if (writable && !writable.includes(base)) {
          throw new StateError(`${actor} may not write "${base}" (allowed: ${writable.join(", ")})`);
        }
        task[base] = v;
        if (["objective", "completion_checks", "priority", "risk", "resources", "dependencies"].includes(base)) packetChanged = true;
      }
      if (flags.objective) {
        if (contract && !contract.may_write.includes("objective")) throw new StateError(`${actor} may not write objective`);
        task.objective = flags.objective;
        packetChanged = true;
      }
      for (const c of flags.check) {
        if (contract && !contract.may_write.includes("completion_checks")) throw new StateError(`${actor} may not write completion_checks`);
        if (!task.completion_checks.includes(c)) { task.completion_checks.push(c); packetChanged = true; }
      }
      if (flags.priority) {
        if (contract && !contract.may_write.includes("priority")) throw new StateError(`${actor} may not write priority`);
        task.priority = flags.priority;
        packetChanged = true;
      }
      if (flags.risk) {
        if (contract && !contract.may_write.includes("risk")) throw new StateError(`${actor} may not write risk`);
        task.risk = flags.risk === "risky" ? "risky" : "normal";
        task.review_required = task.review_required || task.risk === "risky";
        packetChanged = true;
      }
      if (flags.to) {
        if (actor !== "mira" && actor !== "manager") throw new StateError("only Mira (or the manager) assigns workers; use: assign");
        task.assigned_worker = flags.to;
      }
      for (const p of flags.pass) {
        addEvidence(state, task.id, { kind: "check", check: p, result: "pass", detail: "", coverage: "complete", code_revision: task.workspace ? contentSnapshot(ROOT, task.workspace).revision : null }, actor);
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
      for (const r of flags.review) {
        const m = r.match(/^\s*(approve|changes-requested)\s*[:\-]\s*(.+)$/i);
        if (!m) throw new StateError(`--review expects "approve: <findings>" or "changes-requested: <findings>"`);
        addEvidence(state, task.id, { kind: "review", result: m[1].toLowerCase(), detail: m[2].trim(), code_revision: task.workspace ? contentSnapshot(ROOT, task.workspace).revision : null }, actor);
        say(actor, `review verdict on ${task.id}: ${m[1].toLowerCase()} — ${m[2].trim()}`, { task: task.id });
      }
      for (const n of flags.note) {
        addEvidence(state, task.id, { kind: "note", detail: n }, actor);
        say(actor, n, { task: task.id });
      }
      if (packetChanged) reviseTaskPacket(state, task.id, { actor, reason: "task packet fields changed" });
      if (Object.keys(flags.set).length || flags.objective || flags.check.length || flags.pass.length || flags.fail.length || flags.review.length || flags.note.length || flags.priority || flags.risk || flags.to || flags.checkpoint) {
        task.updated_at = new Date().toISOString();
        logEvent(state, { task: task.id, actor, event: "update", detail: JSON.stringify({ set: Object.keys(flags.set), checks: flags.check.length, pass: flags.pass.length, fail: flags.fail.length, reviews: flags.review.length }) });
      }
      saveState(ROOT, state);
      console.log(renderTask(task));
      return;
    }

    case "test-evidence": {
      const { task } = need(pos[0]);
      const revision = task.workspace ? contentSnapshot(ROOT, task.workspace, { storeBlobs: false }).revision : null;
      console.log(JSON.stringify({ ...testEvidence(task, revision, ROOT), effective_policy: verificationPolicy(loadState(ROOT), task) }, null, 2));
      return;
    }
    case "verification-policy": {
      const state = loadState(ROOT);
      const task = pos[0] === "project" ? null : need(pos[0]).task;
      if (knownActor(task?.id) !== "manager") throw new StateError("Only the manager can set verification policy");
      setVerificationPolicy(state, task ? state.tasks[task.id] : null, pos[1]);
      saveState(ROOT, state);
      return;
    }
    case "verifier": {
      const { state, task } = need(pos[0]);
      if (knownActor(task.id) !== "manager") throw new StateError("Only the manager can register executable verifiers");
      setVerifier(task, pos[1], pos[2], pos.slice(3));
      saveState(ROOT, state);
      return;
    }
    case "revision": {
      const { task } = need(pos[0]);
      console.log(contentSnapshot(ROOT, task.workspace).revision); return;
    }
    case "observe": {
      const { state, task } = need(pos[0]);
      const actor = knownActor(task.id);
      if (!["rowan", "sage", "beacon", "manager"].includes(actor)) throw new StateError("this role cannot record verification evidence");
      const file = path.resolve(task.workspace, pos[1] || "");
      if (!file.startsWith(path.resolve(task.workspace) + path.sep)) throw new StateError("evidence packet must be inside the task workspace");
      const entry = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!["check", "review", "browser-journey"].includes(entry.kind)) throw new StateError("unsupported observation kind");
      if (entry.kind === "review" && !["sage", "manager"].includes(actor)) throw new StateError("Sage owns independent review");
      if (entry.kind === "browser-journey" && !["beacon", "manager"].includes(actor)) throw new StateError("Beacon owns integrated browser verification");
      // Artifact identifiers are issued by the deterministic runner.
      delete entry.output_id;
      delete entry.screenshots;
      addEvidence(state, task.id, entry, actor); saveState(ROOT, state);
      console.log("observation recorded"); return;
    }
    case "contract-repair": {
      const { task } = need(pos[0]);
      const actor = knownActor(task.id);
      if (actor !== "pip" || !task.pip_repair_request) throw new StateError("only a supervisor-requested Pip repair is permitted");
      const file = path.resolve(task.workspace, pos[1] || "");
      if (!file.startsWith(path.resolve(task.workspace) + path.sep)) throw new StateError("repair packet must be inside the task workspace");
      const packet = JSON.parse(fs.readFileSync(file, "utf8"));
      repairContract(ROOT, task.id, packet.patch, { objective: task.objective, budgetApproved: true, evidence: packet.evidence });
      console.log("contract revision recorded; affected evidence invalidated"); return;
    }
    case "move": {
      const { state, task } = need(pos[0]);
      const to = pos[1];
      const from = task.status;
      const actor = knownActor(task.id);
      if (to === "done" && task.workspace && task.verifiers?.length) {
        task.verification_revision = contentSnapshot(ROOT, task.workspace, { storeBlobs: false }).revision;
        if (task.run_verification_policy !== "allow" && !testEvidence(task, task.verification_revision, ROOT).verified) {
          throw new StateError(`${task.id}: current verification evidence is required`);
        }
      }
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
      transition(state, task.id, "assigned", { actor: knownActor(task.id), note: `assigned to ${worker}` });
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

    case "session": {
      // Supported authorization path for interactive agent sessions (#33):
      // one operator action issues a scoped, expiring credential bound to one
      // task, one role and a fenced lease; the role contract still gates
      // which transitions the role may perform.
      const sub = pos[0] || "start";
      if (sub === "start") {
        const taskId = flags.task || pos[1];
        if (!taskId) throw new StateError("session start needs --task <id> and --actor <role>");
        const role = actorOf();
        if (role === "manager") throw new StateError("the manager acts as the owner and needs no session credential");
        const { state, task } = need(taskId);
        const ttlText = typeof flags.ttl === "string" && flags.ttl.trim() ? flags.ttl.trim() : "2h";
        const ttlMatch = ttlText.match(/^(\d+)(s|m|h|d)?$/i);
        if (!ttlMatch) throw new StateError(`--ttl must look like 30m, 2h or 3600 (got "${ttlText}")`);
        const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400 }[(ttlMatch[2] || "s").toLowerCase()];
        const ttlSeconds = Number(ttlMatch[1]) * unitSeconds;
        if (ttlSeconds < 60 || ttlSeconds > 24 * 3600) throw new StateError("--ttl must be between 1 minute and 24 hours");
        reconcileLeases(ROOT);
        const project = path.resolve(ROOT);
        const lease = acquireLease(ROOT, { project, task: task.id, role, run: `session:${new Date().toISOString()}`, ttlMs: ttlSeconds * 1000 });
        const credential = createWorkerCredential({ project, task: task.id, role, run: lease.run, generation: lease.generation, leaseId: lease.id, leaseKey: lease.key, expiresInSeconds: ttlSeconds });
        logEvent(state, { task: task.id, actor: "manager", event: "session-start", detail: `role ${role} session credential issued (ttl ${ttlText}, lease ${lease.id})` });
        saveState(ROOT, state);
        const exported = `ATL_WORKER_CREDENTIAL='${JSON.stringify(credential).replace(/'/g, "'\\''")}'`;
        console.log(`Interactive ${role} session scoped to ${task.id} ("${task.title}") until ${credential.expires_at}.`);
        console.log(`  POSIX:  export ${exported}`);
        console.log(`  Windows: set ATL_WORKER_CREDENTIAL=${JSON.stringify(credential)}`);
        console.log(`Then run role commands with --actor ${role}. End the session with: atl session stop (credential in ATL_WORKER_CREDENTIAL).`);
        return;
      }
      if (sub === "stop") {
        if (!process.env.ATL_WORKER_CREDENTIAL) throw new StateError("session stop needs the session's ATL_WORKER_CREDENTIAL in the environment");
        let credential;
        try { credential = JSON.parse(process.env.ATL_WORKER_CREDENTIAL); } catch { throw new StateError("invalid scoped worker credential"); }
        const released = releaseLease(ROOT, { key: credential.lease_key, id: credential.lease_id, generation: credential.generation });
        console.log(released ? `Session lease ${credential.lease_id} released; the credential no longer authorizes anything.` : "Session lease was already released or expired.");
        return;
      }
      throw new StateError("session: start | stop");
    }

    case "block": {
      const { state, task } = need(pos[0]);
      if (!flags.reason) throw new StateError(`block needs --reason "..."`);
      const from = task.status;
      task.blocker = { reason: flags.reason, since: new Date().toISOString(), actor: actorOf() };
      task.next_wake_at = resolveWake(flags["wake-in"]);
      transition(state, task.id, "blocked", { actor: knownActor(task.id), note: flags.reason });
      narrateMove(task, from, "blocked", actorOf(), flags.reason);
      saveState(ROOT, state);
      console.log(renderTask(task));
      return;
    }

    case "unblock": {
      const id = pos[0];
      if (!id) throw new StateError("unblock needs a task id");
      const result = unblockTask(ROOT, id, { to: flags.to, note: flags.note?.[0] || "blocker resolved by manager" });
      say("mira", `${id} unblocked → ${result.to}${result.worker ? ` and routed to ${result.worker}` : " — ready for assignment"}.`, { task: id });
      console.log(renderTask(result.task));
      console.log(`\nNext: ${result.to === "assigned" ? `atl queue add ${id} && atl launch --confirm` : `assign ${id} --to <worker> --actor mira`}`);
      return;
    }

    case "approve": {
      const id = pos[0];
      if (!id) throw new StateError("approve needs a task id");
      const result = approveTask(ROOT, id, { note: flags.note?.[0] || "" });
      say("manager", `owner approved ${id}${result.unblocked ? ` — blocker cleared, back to ${result.task.status}` : ""}${result.queued ? " and queued for the next launch" : " (already queued)"}.`, { task: id });
      const state = loadState(ROOT);
      logEvent(state, { task: id, actor: "manager", event: "approve", detail: result.detail });
      saveState(ROOT, state);
      console.log(renderTask(result.task));
      console.log(`\nNext: atl launch --confirm  (the approval is on the record; the task is ${result.queued ? "queued" : "already in the queue"})`);
      return;
    }

    case "why": {
      const id = pos[0];
      const rows = explainTasks(ROOT, id);
      if (id && rows.length === 0) {
        const state = loadState(ROOT);
        if (!state.tasks[id]) throw new StateError(`Unknown task ${id}`);
        console.log(`${id} is ${state.tasks[id].status} — nothing is blocking it.`);
        return;
      }
      console.log(`# Why — the state of every active task, ${new Date().toISOString()}\n`);
      for (const r of rows) {
        const t = r.task;
        console.log(`${t.id} [${t.status}] (${t.priority}${t.risk === "risky" ? "/risky" : ""}) ${t.title}`);
        console.log(`  why: ${r.why}`);
        if (r.since) console.log(`  blocked ${r.since}${r.actor ? ` by ${r.actor}` : ""}`);
        if (r.fix) console.log(`  fix: ${r.fix}`);
        console.log("");
      }
      const gates = rows.filter((r) => r.kind === "owner-approval").length;
      if (!id) console.log(`${rows.length} active task(s), ${gates} waiting on the owner. Give the word with: atl approve <task-id>`);
      return;
    }

    case "resource": {
      const id = pos[0];
      const ref = pos.slice(1).join(" ").trim();
      if (!id || !ref) throw new StateError('resource needs a task id and a URL or local path');
      const { state, task } = need(id);
      const result = addResourceToTask(ROOT, task, ref, {
        label: typeof flags.label === "string" ? flags.label : "",
        caption: typeof flags.caption === "string" ? flags.caption : "",
        source: "manager",
      });
      if (!result.added) throw new StateError(`${id}: that resource is already attached`);
      logEvent(state, { task: id, actor: "manager", event: "resource", detail: `${result.resource.kind}: ${result.resource.ref}` });
      saveState(ROOT, state);
      say("manager", `attached ${result.resource.kind} to ${id}: ${result.resource.label}.`, { task: id, detail: result.resource.ref });
      console.log(renderTask(task));
      return;
    }

    case "escalate": {
      const { state, task } = need(pos[0]);
      if (!flags.reason) throw new StateError(`escalate needs --reason "..."`);
      const from = task.status;
      task.blocker = { reason: flags.reason, since: new Date().toISOString(), actor: actorOf() };
      transition(state, task.id, "escalated", { actor: knownActor(task.id), note: flags.reason });
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

    case "dashboard":
    case "tui": {
      await runDashboard(ROOT, { once: flags.once === true, plain: flags.plain === true });
      if (flags.once === true) process.exit(0);
      return;
    }

    case "ui-refresh":
      throw new StateError("ui-refresh was removed. Use `atl ui`; it automatically serves the latest complete project UI.");
    case "ui":
    case "control-plane":
    case "web": {
      if (flags.once === true) {
        await runDashboard(ROOT, { once: true, plain: flags.plain === true });
        process.exit(0);
      }
      const host = String(flags.host || "127.0.0.1");
      const port = Number(flags.port || 0);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new StateError("--port must be an integer from 0 to 65535");
      if (flags.fresh === true) await stopDaemon(ROOT);
      // Keep browser assets and API routes on one runtime version. An installed
      // CLI uses its registered checkout when it manages a different project.
      const assetRoot = preferredControlPlaneRuntime(ROOT);
      const projectServer = assetRoot ? path.join(assetRoot, "lib", "control-plane-server.mjs") : null;
      let startServer = startControlPlaneServer;
      if (assetRoot) {
        const module = await import(pathToFileURL(projectServer).href);
        if (typeof module.startControlPlaneServer !== "function") throw new StateError("Project Control Plane server does not export startControlPlaneServer.");
        startServer = module.startControlPlaneServer;
      }
      // One state owner (issue #34): reuse a live project daemon when one
      // exists; otherwise start the server and claim the owner record in
      // <root>/.atl/daemon.json. The daemon is the only direct writer of
      // state.json — other processes write through a writer lease.
      const existing = await daemonStatus(ROOT);
      if (existing.alive) {
        console.log(`ATL browser control plane: ${existing.url}`);
        console.log("Reusing the project daemon that owns this project's state. Press Ctrl+C to detach (the daemon keeps serving; `atl daemon stop` stops it).");
        if (!flags.noOpen) openControlPlane(existing.url);
        await waitUntilDaemonEnds(ROOT);
        return;
      }
      let running;
      try {
        running = await startServer(ROOT, { host, port, ...(assetRoot ? { assetRoot } : {}) });
      } catch (error) {
        // A sibling spawner won the deterministic-port race after our health
        // check: fall back to an ephemeral port instead of failing.
        if (error?.code !== "EADDRINUSE") throw error;
        running = await startServer(ROOT, { host, port: 0, ...(assetRoot ? { assetRoot } : {}) });
      }
      try {
        claimOwnerRecord(ROOT, { port: running.port, url: running.url, runtime: runtimeIdentity(path.dirname(path.dirname(assetRoot || fileURLToPath(import.meta.url)))) });
        // Rotate the browser owner session only after this process won the
        // daemon ownership claim; a losing concurrent starter must not revoke
        // the winning panel's cookie or CSRF token.
        running.server.rotateOwnerSession?.();
      } catch (error) {
        running.server.close();
        if (error?.statusCode === 409) {
          console.log(`ATL browser control plane: ${error.message.replace("another project daemon", "reusing the project daemon")}`);
          await waitUntilDaemonEnds(ROOT);
          return;
        }
        throw error;
      }
      console.log(`ATL browser control plane: ${running.url}`);
      console.log("This process now owns the project's state (single writer, issue #34). Press Ctrl+C to stop.");
      if (!flags.noOpen) openControlPlane(running.url);
      runOwnerLifecycle(ROOT, running);
      await new Promise((resolve) => {
        const stop = () => {
          running.server.close(() => resolve());
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      return;
    }

    case "daemon": {
      const sub = pos[0] || "status";
      if (sub === "status") {
        const status = await daemonStatus(ROOT);
        console.log(JSON.stringify({ ...status, record: status.record ? { ...status.record, lease: status.record.lease } : null }, null, 2));
        return;
      }
      if (sub === "start") {
        const daemon = await ensureDaemon(ROOT);
        console.log(`${daemon.reused ? "reusing" : "started"} project daemon: ${daemon.url}`);
        return;
      }
      if (sub === "stop") {
        const result = await stopDaemon(ROOT);
        console.log(result.stopped ? "project daemon stopped" : result.wasAlive ? "daemon process ended" : "no project daemon is running");
        return;
      }
      throw new StateError(`unknown daemon command "${sub}" (status | start | stop)`);
    }

    case "review": {
      const taskId = pos[0];
      if (!taskId) throw new StateError("review needs a task id: atl review T-001 [--mermaid|--json]");
      console.log(taskReviewReport(ROOT, taskId, flags.mermaid ? "mermaid" : flags.json ? "json" : "text", { captureId: flags.capture, fileId: flags.file, cursor: flags.cursor, expand: flags.expand }));
      return;
    }
    case "show": {
      const state = loadState(ROOT);
      if (flags.json) {
        const tasks = pos[0] ? [state.tasks[pos[0]]].filter(Boolean) : activeTasks(state);
        console.log(JSON.stringify({ revision: state.revision || 0, active_count: activeTasks(state).length, done_count: Object.values(state.tasks).filter((task) => task.status === "done").length, tasks }, null, 2));
        return;
      }
      if (pos[0]) {
        console.log(renderTask(state.tasks[pos[0]]));
      } else {
        const tasks = activeTasks(state);
        const done = Object.values(state.tasks).filter((t) => t.status === "done");
        console.log(`active: ${tasks.length}, done: ${done.length}`);
        for (const t of tasks) {
          console.log(`  ${t.id} [${t.status}] (${t.priority}${t.risk === "risky" ? "/risky" : ""}) ${t.title} — ${t.assigned_worker || "unassigned"}`);
        }
        const gated = tasks.filter((t) => t.status === "blocked" || t.status === "escalated").length;
        if (gated > 0) console.log(`\n  ${gated} task(s) stopped at a gate — atl why explains each one and prints its fix.`);
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

    case "codex": {
      const sub = pos[0] || "bridge";
      const action = sub === "bridge" ? (pos[1] || "status") : sub;
      if (action === "status") {
        console.log(JSON.stringify(bridgeStatus(ROOT), null, 2));
        return;
      }
      if (action === "link") {
        const threadId = String(pos[sub === "bridge" ? 2 : 1] || flags.thread || "").trim();
        if (!threadId) throw new StateError("codex bridge link needs an explicit thread id");
        const mode = String(flags.mode || "target").toLowerCase();
        if (!["target", "dedicated", "queue"].includes(mode)) throw new StateError("codex bridge link --mode must be target, dedicated, or queue");
        const config = updateBridgeConfig(ROOT, (bridge) => {
          bridge.enabled = true;
          bridge.thread_id = threadId;
          bridge.mode = mode;
          bridge.fallback = mode === "dedicated" ? "new-thread" : "none";
        });
        console.log(`Codex bridge linked to ${config.thread_id}`);
        console.log(mode === "queue"
          ? "Future completed ATL team sessions will be queued as visible Codex turns (model usage applies)."
          : "Future completed ATL team sessions will be imported into this thread.");
        return;
      }
      if (action === "start") {
        const result = await startDedicatedBridge(ROOT, { name: String(flags.name || "ATL Team History") });
        console.log(JSON.stringify(result, null, 2));
        console.log(`Open in Codex app: codex://threads/${result.threadId}`);
        return;
      }
      if (action === "unlink") {
        const config = updateBridgeConfig(ROOT, (bridge) => { bridge.enabled = false; });
        console.log(`Codex bridge disabled; target retained as ${config.thread_id || "(none)"}.`);
        return;
      }
      if (action === "sync") {
        const result = await syncTeamContext(ROOT, { taskId: flags.task || null });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      throw new StateError("codex bridge commands: status | link <thread-id> | start | unlink | sync [--task T-001]");
    }

    case "history": {
      const sub = pos[0];
      if (sub && sub !== "list" && sub !== "show") {
        throw new StateError('history subcommands: (list) | show <number|id|latest>');
      }
      const source = flags.source && String(flags.source).toLowerCase() !== "all" ? String(flags.source).toLowerCase() : null;
      if (source && !historySources().some((s) => s.id === source)) {
        throw new StateError(`--source must be one of: ${historySources().map((s) => s.id).join(" | ")} | all`);
      }
      const rows = listHistory({ sources: source ? [source] : null, limit: Math.max(1, Number(flags.n) || 20) });
      if (sub === "show") {
        const ref = pos.slice(1).join(" ").trim();
        if (!ref) throw new StateError("history show needs a number from `atl history`, an id prefix, or \"latest\"");
        const picked = resolveHistoryRef(rows, ref);
        const transcript = await readTranscript({ source: picked.source, file: picked.file, limit: Math.max(1, Number(flags.n) || 200) });
        console.log(renderTranscript(transcript, { width: process.stdout.columns || 100 }));
        return;
      }
      console.log(renderHistoryList(rows, { sources: historySources() }));
      return;
    }

    case "map": {
      const sub = pos[0] || "status";
      let result;
      if (sub === "build") { buildMap(ROOT); result = mapStatus(ROOT); }
      else if (sub === "status") result = mapStatus(ROOT);
      else if (sub === "query") {
        const symbol = flags.symbol || pos[1];
        if (!symbol) throw new StateError("map query needs --symbol Name");
        result = queryMap(ROOT, symbol, Number(flags.limit) || 20);
      } else if (sub === "neighbors") {
        const symbolId = flags["symbol-id"] || pos[1];
        if (!symbolId) throw new StateError("map neighbors needs --symbol-id ID");
        result = neighbors(ROOT, symbolId, Number(flags.limit) || 20);
      } else throw new StateError("map commands: build | status | query --symbol Name | neighbors --symbol-id ID");
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case "context": {
      if (pos[0] !== "assemble") throw new StateError("context commands: assemble --task ID --query text [--max-tokens 800]");
      const task = flags.task ? loadState(ROOT).tasks[flags.task] : null;
      const query = flags.query || pos.slice(1).join(" ") || `${task?.title || ""} ${task?.objective || ""}`;
      if (!query.trim()) throw new StateError("context assemble needs --query text or --task ID");
      const result = assembleContext(ROOT, { taskId: flags.task || "ad-hoc", query, maxTokens: Number(flags["max-tokens"]) || 800, constraints: task?.completion_checks || [] });
      console.log(JSON.stringify(result, null, 2));
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
      if (subcommand === "learn") {
        const kind = pos[1];
        const text = pos.slice(2).join(" ").trim();
        console.log(JSON.stringify(learnLocal(ROOT, { kind, text, source: "explicit-feedback" }), null, 2));
        return;
      }
      if (subcommand === "forget") {
        console.log(JSON.stringify(forgetLocal(ROOT, pos[1]), null, 2));
        return;
      }
      throw new StateError(`Unknown memory command "${subcommand}". Use status, recall, remember, learn, or forget.`);
    }

    case "ready": {
      const { analyzeReadiness, renderReadiness } = await import("./lib/dependencies.mjs");
      console.log(renderReadiness(analyzeReadiness(loadState(ROOT))));
      return;
    }

    case "brain": {
      const sub = pos[0] || "list";
      if (sub === "claim") {
        const result = addClaim(ROOT, {
          ...flags.set,
          subject: flags.subject || flags.set.subject || null,
          status: flags.set.status || "UNKNOWN",
          source_id: flags.set.source_id,
          source_uri: flags.set.source_uri || null,
          source_content: flags.set.source_content,
        });
        console.log(`${result.duplicate ? "Known" : "Recorded"} ${result.claim.claim_id} (${result.claim.status})`);
        if (result.conflicts?.length) console.log(`Conflicts: ${result.conflicts.join(", ")}`);
        return;
      }
      if (sub === "source") {
        const sourceId = flags.set.source_id || pos[1];
        const content = flags.set.source_content;
        const result = archiveSource(ROOT, { sourceId, uri: flags.set.source_uri || null, content, result: flags.set.result || "ok", error: flags.set.error || null });
        console.log(`${result.duplicate ? "Known" : "Archived"} source ${result.source.id} (${result.source.result})${result.source.revision ? ` ${result.source.revision}` : ""}`);
        return;
      }
      if (sub === "status") {
        console.log(JSON.stringify(sourceStatus(ROOT), null, 2));
        return;
      }
      if (sub === "stale") { console.log(JSON.stringify(staleClaims(ROOT, { maxAgeDays: Number(flags.set.days || 30) }), null, 2)); return; }
      if (sub === "approve") { console.log(JSON.stringify(approveClaim(ROOT, pos[1], { note: flags.note[0] || "" }), null, 2)); return; }
      if (sub === "skill") {
        const skill = flags.set;
        if (pos[1] === "validate") { console.log(JSON.stringify(validateSkill(skill), null, 2)); return; }
        if (pos[1] === "promote") { console.log(JSON.stringify(promoteSkill(ROOT, { ...skill, gold_verified: String(skill.gold_verified) === "true", fixtures: String(skill.fixtures || "").split(",").filter(Boolean), validation: skill.validation || "deterministic" }), null, 2)); return; }
        console.log(JSON.stringify(listSkills(ROOT), null, 2)); return;
      }
      if (sub === "routine") {
        if (pos[1] === "register") { console.log(JSON.stringify(registerRoutine(ROOT, { ...flags.set, retry_limit: Number(flags.set.retry_limit), enabled: false }), null, 2)); return; }
        console.log(JSON.stringify(listRoutines(ROOT), null, 2)); return;
      }
      if (sub === "list") {
        console.log(JSON.stringify(listClaims(ROOT, { subject: flags.subject || null, status: flags.set.status || null }), null, 2));
        return;
      }
      if (sub === "context") {
        const pack = buildContextPack(ROOT, { query: flags.query || "", subjects: flags.subject ? [flags.subject] : [], maxClaims: Number(flags.maxClaims || 20) });
        if (flags.save) console.log(`Saved: ${saveContextPack(ROOT, pack, String(flags.save))}`);
        console.log(JSON.stringify(pack, null, 2));
        return;
      }
      throw new StateError("brain subcommands: source | status | claim | list | context | stale | approve | skill | routine");
    }

    case "research": {
      const R = await import("./lib/research.mjs");
      const sub = pos[0] || "list";
      const rest = pos.slice(1);
      const id = rest[0] && !String(rest[0]).startsWith("--") ? rest[0] : null;
      const splitList = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (sub === "list" || sub === "inbox") {
        const rows = R.listRecords(ROOT, {
          status: flags.status || null,
          priority: flags.priority || null,
          kind: flags.set.kind || null,
          person: flags.set.person || null,
          concept: flags.set.concept || null,
        });
        console.log(R.renderRecordList(rows));
        return;
      }
      if (sub === "show") {
        if (!id) throw new StateError("research show needs a record id (e.g. R-0001)");
        const rec = R.readRecord(ROOT, id);
        if (!rec) throw new StateError(`no research record ${id}`);
        console.log(R.renderRecord(rec));
        return;
      }
      if (sub === "add") {
        const url = rest.find((a) => !String(a).startsWith("--"));
        const rec = R.createRecord(ROOT, {
          title: flags.title,
          priority: flags.priority || "P2",
          kind: flags.set.kind || "post",
          people: splitList(flags.set.people),
          concepts: splitList(flags.set.concepts),
          sources: url ? [url] : [],
          repos: splitList(flags.set.repos),
          evidence: flags.set.evidence || "second-hand",
          atl_impact: flags.set.atl_impact || "",
          objective: flags.set.objective || "",
          checks: splitList(flags.set.checks),
          published: flags.set.published || null,
          body: flags.set.body || "",
        });
        console.log(`Filed ${rec.fields.id} — ${rec.fields.title}`);
        console.log(`Assess it: atl research set ${rec.fields.id} --set priority=P1 --set atl_impact="..."`);
        return;
      }
      if (sub === "set") {
        if (!id) throw new StateError("research set needs a record id");
        const rec = R.patchRecord(ROOT, id, flags.set, { actor: actorOf() });
        console.log(`Updated ${rec.fields.id}: ${rec.fields.title}`);
        return;
      }
      if (sub === "approve") {
        const rec = R.setRecordStatus(ROOT, id, "approved", { actor: actorOf(), note: flags.note[0] || "" });
        console.log(`${rec.fields.id} approved — promote it with: atl research promote ${rec.fields.id}`);
        return;
      }
      if (sub === "reject") {
        if (!flags.reason) throw new StateError("rejecting research needs --reason \"...\" (the decision log keeps it)");
        const rec = R.setRecordStatus(ROOT, id, "rejected", { actor: actorOf(), note: flags.reason });
        console.log(`${rec.fields.id} rejected: ${flags.reason}`);
        return;
      }
      if (sub === "promote") {
        const result = R.promoteRecord(ROOT, id, { actor: actorOf(), note: flags.note[0] || "" });
        if (result.already) console.log(`${id} was already promoted as ${result.taskId}`);
        else console.log(`Promoted ${id} → task ${result.taskId} (status: new). Pip will triage it.`);
        return;
      }
      if (sub === "transcript") {
        const url = rest.find((a) => !String(a).startsWith("--"));
        if (!url) throw new StateError("research transcript needs a YouTube url");
        const data = await R.fetchYoutubeTranscript(url);
        const saved = R.saveTranscript(ROOT, data, { recordId: flags.set.record || null });
        console.log(`Transcript saved: ${saved.markdown} (${saved.cues} cues, ${data.language}${data.auto ? ", auto-generated" : ""})`);
        return;
      }
      if (sub === "retro") {
        const findings = R.scanRetros(ROOT);
        if (!findings.length) {
          console.log("No retrospective patterns found — no repeat attempts, recurring blockers, or escalations in state.");
          return;
        }
        let filed = 0, dup = 0;
        for (const f of findings) {
          try {
            const rec = R.fileRetroFinding(ROOT, f);
            console.log(`filed ${rec.fields.id} — ${f.title}`);
            filed++;
          } catch (err) {
            if (err.existingId) { dup++; console.log(`known: ${err.existingId} — ${f.title}`); }
            else throw err;
          }
        }
        console.log(`${filed} filed, ${dup} already known. Review with: atl research list --status pending`);
        return;
      }
      if (sub === "graph") {
        const graph = R.exportGraph(ROOT);
        console.log(`graph.json: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
        return;
      }
      if (sub === "status") {
        console.log(JSON.stringify(R.researchStatus(ROOT), null, 2));
        return;
      }
      if (sub === "brief") {
        const intel = await import("../scripts/intel-brief.mjs");
        const offline = rest.includes("--offline") || String(flags.set.offline) === "true";
        const scan = offline
          ? { perSource: [{ id: "(offline)", type: "—", status: "ok", note: "index re-render only", items: 0 }], filed: [], skipped: 0, ran_at: new Date().toISOString() }
          : await intel.runBriefScan(ROOT);
        const file = intel.writeBrief(ROOT, scan, { offline });
        console.log(`Brief written: ${file}`);
        for (const s of scan.perSource) console.log(`  ${s.status.padEnd(7)} ${s.id} — ${s.note}`);
        return;
      }
      throw new StateError('research subcommands: (list) | inbox | show <id> | add <url> | set <id> | approve <id> | promote <id> | reject <id> | transcript <url> | retro | graph | status | brief');
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

    case "run": {
      await runWorkerLoop(pos[0], { overnight: false });
      return;
    }

    case "overnight": {
      if (pos[0] === "status") {
        console.log(JSON.stringify(reconcileOvernightRun(ROOT), null, 2));
      } else if (pos[0] === "recover") {
        const resumed = await resumeOvernightRun(ROOT, {
          confirm: flags.confirm === true || flags.confirm === "true",
          maxMinutes: Number(flags["max-minutes"] || 120),
          maxSessions: flags["max-sessions"] ? Number(flags["max-sessions"]) : null,
        });
        console.log(JSON.stringify(resumed, null, 2));
      } else if (flags.all === true) {
        await runQueueLoop({ overnight: true });
      } else {
        await runWorkerLoop(pos[0], { overnight: true });
      }
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

    case "projects": {
      const sub = pos[0] || "list";
      if (sub === "register") {
        if (pos.length > 1 && !String(pos[1]).trim()) throw new StateError("projects register path cannot be empty");
        const target = pos[1] || ROOT;
        const project = registerProject(target, { name: flags.title || path.basename(target), maxConcurrent: Number(flags.set.maxConcurrent || 1), allowExisting: true });
        console.log(`Registered ${project.root} as ${project.id}`);
      } else if (sub === "list") {
        const snapshot = supervisorSnapshot();
        if (flags.json) console.log(JSON.stringify(snapshot, null, 2));
        else {
          console.log("Registered repositories (local run targets):");
          for (const item of snapshot.projects) console.log(`  ${item.id}  ${item.name}  ${item.root}  (max concurrent: ${item.maxConcurrent})`);
          if (!snapshot.projects.length) console.log("  None yet. Register one with: atl projects register <absolute-path>");
        }
      } else if (sub === "concurrency") {
        console.log(JSON.stringify(setSupervisorDefaults({ maxConcurrent: Number(pos[1]) }), null, 2));
      } else throw new StateError("projects: register | list | concurrency <1..5>");
      return;
    }

    case "backup": {
      const sub = pos[0] || "list";
      if (sub === "create") console.log(JSON.stringify(createBackup(ROOT, { label: flags.label || "manual" }), null, 2));
      else if (sub === "list") console.log(JSON.stringify(listBackups(ROOT), null, 2));
      else if (sub === "restore") console.log(JSON.stringify(restoreBackup(ROOT, pos[1]), null, 2));
      else throw new StateError("backup: create | list | restore <id>");
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
          if (e.kind === "check" && e.check && ![...t.completion_checks, ...(t.integrated_checks || [])].includes(e.check)) {
            problems.push(`${t.id}: evidence references unknown check "${e.check}"`);
          }
        }
        if (t.assigned_worker && !["pip", "rowan", "sage", "beacon"].includes(t.assigned_worker)) {
          problems.push(`${t.id}: bad worker ${t.assigned_worker}`);
        }
      }
      for (const item of loadQueue(ROOT).items) {
        if (!known.has(item.id)) problems.push(`execution queue references unknown task ${item.id}`);
      }
      for (const e of state.log) {
        if (e.task !== null && e.task !== undefined && e.task !== "-" && !known.has(e.task) && e.event !== "intake") {
          problems.push(`log references unknown task ${e.task}`);
        }
      }
      if (cfg.intake?.azure?.enabled && !process.env[cfg.intake.azure.token_env || "AZDO_PAT"]) {
        problems.push(`azure intake enabled but ${cfg.intake.azure.token_env || "AZDO_PAT"} is not set`);
      }
      if (cfg.intake?.github?.enabled && (cfg.intake.github.repos || []).length) {
        const ghAuthed = await ghCliAuthenticated();
        if (!ghAuthed && !process.env.GITHUB_TOKEN) {
          problems.push("github intake enabled but gh is not logged in and GITHUB_TOKEN is not set (private repos will 404 — run: gh auth login, or atl intake disable github)");
        }
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
      process.exitCode = cmd && !["--help", "-h", "help"].includes(cmd) ? 1 : 0;
  }
}

// One state owner (issue #34): when a live project daemon owns the state, a
// mutating command hits the writer gate in state.mjs. Acquire the exclusive
// writer lease and retry — but only if this process has not written yet, so
// a mid-command ownership change never re-executes partial work.
const LEASE_DENIAL = /state is owned by the project daemon/;

async function main() {
  if (checkRuntimeMismatch()?.delegated) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await dispatch();
      return;
    } catch (error) {
      if (
        attempt === 2
        || !(error instanceof StateError)
        || !LEASE_DENIAL.test(error.message)
        || process.env.ATL_WRITER_LEASE
        || hasWrittenState()
      ) throw error;
      let lease;
      try {
        lease = await acquireWriterLease(ROOT, {
          argv: process.argv.slice(2).join(" "),
          waitMs: Math.max(1000, Number(process.env.ATL_LEASE_WAIT_MS) || LEASE_WAIT_MS_DEFAULT),
        });
      } catch (leaseError) {
        // The owner died while leasing: the bootstrap path applies now.
        const status = await daemonStatus(ROOT).catch(() => ({ alive: false }));
        if (status.alive) throw leaseError;
        continue;
      }
      process.env.ATL_WRITER_LEASE = lease.token;
      const renew = setInterval(() => { void renewWriterLease(ROOT, lease.token); }, 45000);
      renew.unref?.();
      try {
        await dispatch();
        return;
      } finally {
        clearInterval(renew);
        try { await releaseWriterLease(ROOT, lease.token); } catch { /* TTL reclaims it */ }
        process.env.ATL_WRITER_LEASE = undefined;
      }
    }
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
