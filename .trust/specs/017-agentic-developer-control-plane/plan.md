# Plan — 017 agentic developer control plane

Spec: approved 2026-10-22 · Dose: Critical

This plan expands the earlier 016 command-console slice into a complete ATL
developer control plane. It preserves the current lifecycle/launch contracts,
absorbs the bounded command-console work, and adds a staged TUI shell, Plan
Studio, named queues, team/run observability, notifications, and honest usage
telemetry. The implementation gate is Critical, so consequential provider,
concurrency, quota, archive, and terminal-width assumptions are recorded below
instead of being silently inferred.

Implementation assumption recorded 2026-10-22: the explicit `atl-implement`
invocation authorizes the recommended defaults in the OPEN-decision section for
this pass—unknown remote quota, global concurrency one, explicit planning-call
confirmation, archive-before-hard-delete, and a 60-column minimum. These remain
reversible decisions and are not claims that provider quota is available.

Implementation evidence update 2026-10-22: the implementation slice is now
underway. T1–T4 are complete, and the first vertical slices of T5–T11 are
implemented: the TUI has a responsive wide sidebar, routeable Plan Studio,
named-queue projection, Team/Alerts/Usage pages, a safe `:` command console,
and persisted provider-neutral usage observations. The standalone HTML
prototype and this brief were used as product references only; their demo
state is not treated as ATL runtime evidence. Remaining work is provider-call
UI integration, deeper queue/run controls, notification actions, full role
brief lineage, and final documentation/human-pilot review.

## Approach and key decisions

1. Establish versioned persistence contracts and a read-only control-plane
   snapshot before changing page composition.
2. Build the shell/design tokens and one responsive page before migrating every
   existing screen; use real 60/80/120-column evidence at each step.
3. Keep all actions behind domain modules and an allowlisted command registry;
   the TUI never executes arbitrary shell text or becomes a second state store.
4. Add task CRUD/archive and Plan Studio before expanding queue/team pages, so
   the new shell has a complete developer entry path.
5. Evolve the singleton queue into named queues with a safe global concurrency
   default and an explicit per-queue run policy.
6. Normalize run/session/feedback/brief/log/notification state into linked
   objects so every team view has an authoritative source and a deep link.
7. Treat provider quota as optional telemetry: show local budgets and observed
   usage now; show remote remaining only when an adapter verifies it.
8. Execute the implementation with `atl-implement` bounded loops: do one task,
   run its verifier, inspect the diff, repair only with new evidence, and stop
   on authority or contract ambiguity.

### Key decisions

| Decision | Rationale | Alternatives considered |
|---|---|---|
| Add a normalized control-plane read model | Pages need linked task/queue/run/team/usage data without each page rereading files differently. | Let every page assemble its own snapshot; rejected because stale/mismatched views would be likely. |
| Archive instead of hard-delete | Evidence, queues, session logs, and audit history must remain recoverable. | Delete task JSON; rejected because it breaks evidence and references. |
| One global active provider session by default | Prevents accidental token/spend amplification while multi-queue support lands. | Start all queues in parallel; deferred until aggregate resource and usage gates exist. |
| Provider-neutral usage adapter | Codex/Claude/custom providers expose different local and remote telemetry, and some expose none. | Infer remaining quota from token counts; rejected as unsafe and misleading. |
| Human approval between generated planning stages | Provider output can alter scope, files, cost, and risk; structured output is advisory until accepted. | Fully automatic plan-to-run; rejected for the Critical first release. |
| Persistent sidebar plus command palette | Visible IA scales better than a growing single-letter shortcut list while retaining fast expert paths. | Shortcut-only navigation; rejected by the current overflow/discoverability evidence. |

## Impact

### Expected implementation surface

| Area | Files likely to change or be added | Contract risk |
|---|---|---|
| Persistence and read model | `runtime/lib/state.mjs`, `runtime/lib/queue.mjs`, `runtime/lib/control-plane.mjs` (new), `runtime/lib/notifications.mjs` (new), `runtime/lib/usage.mjs` (new) | Schema migration, stale references, concurrent writes |
| TUI shell/rendering | `runtime/lib/dashboard.mjs`, `runtime/lib/tui-layout.mjs` (new), `runtime/lib/tui-components.mjs` (new), `runtime/lib/tui-theme.mjs` (new) | Width/height overflow, focus loss, regressions in existing screens |
| Commands and task editing | `runtime/lib/command-console.mjs` (new), `runtime/lib/task-workspace.mjs` (new), `runtime/lib/composer.mjs`, `runtime/atl-manager.mjs` | CLI/TUI semantic drift, unsafe input, archive semantics |
| SDD/TDD planning | `runtime/lib/plan-studio.mjs` (new), `runtime/lib/skill-router.mjs`, `runtime/lib/worker.mjs`, `runtime/lib/providers.mjs` | Provider spend, malformed model output, skill authority boundaries |
| Queues/runs/team | `runtime/lib/queue.mjs`, `runtime/lib/launch.mjs`, `runtime/lib/feedback.mjs`, `runtime/lib/history.mjs`, `runtime/lib/dashboard.mjs` | Run cancellation, multi-queue isolation, truthful state |
| Verification | new `verification/*_test.mjs`, existing control-room/recovery/worker/lifecycle tests | False green, fixture coupling, migration regressions |
| Documentation | `runtime/README.md`, `USAGE.md`, `docs/control-room.html` only after runtime contract stabilizes | Docs drifting from actual UI |

### Migration and rollback

- Migrate the current `.trust/manager/queue.json` to a named `default` queue
  without changing task ids or dropping membership.
- Keep migrations idempotent and write an archive/backup before replacing a
  persisted file. A failed migration leaves the original readable.
- New run/notification/usage files are additive; the existing feed, state, and
  session logs remain readable during a staged rollout.
- If a new page fails, the existing dashboard route remains available through a
  compatibility mode; no provider execution depends on the new renderer.
- Do not modify unrelated dirty worktree files or rebuild generated docs until
  the runtime contract and tests pass.

## Pre-mortem

| Failure mode | Detection | Rollback/containment |
|---|---|---|
| The TUI becomes a pretty second state machine | `atl validate` or lifecycle model detects transitions that bypass `state.mjs`; UI snapshot disagrees with CLI | Keep actions in domain modules, reject direct page writes, disable the new route and return to the existing dashboard. |
| Multi-queue launches duplicate work or exceed provider budget | A temp-project concurrency test sees one task in two active runs, aggregate sessions exceed policy, or queue membership changes mid-run | Default to one active runner, use run ids/leases, pause new launches, and migrate back to the default queue view. |
| Plan Studio spends tokens or mutates scope without approval | Provider call occurs before approval, malformed output is persisted as canonical state, or secrets appear in prompts/logs | Make provider call and artifact commit separate explicit effects; store raw draft only; discard unapproved output without touching task state. |
| Usage panel gives false confidence | Remote adapter returns stale/partial data but UI displays a percentage without source/freshness; tests pass fabricated values | Require source/status/confidence fields; display `unknown`; keep local budget authoritative and suppress automated launch on stale critical telemetry. |
| The shell hides evidence at narrow widths | 60/80-column render tests find rows wider than panels, lost selection, or missing blocker tails | Use one shared viewport/layout primitive, fail tests on overflow, and fall back to single-page focus mode. |
| The five-bot view becomes a noisy log wall | Team page cannot identify next action, feedback state, or latest brief in a synthetic run | Use role cards plus drill-down links and notification dedupe; keep raw transcripts behind a log viewport. |

## Constitution compliance and exceptions

- **State authority:** compliant if all mutations remain in `state.mjs`, queue,
  recovery, feedback, launch, and new domain modules; the TUI consumes a
  read-only projection.
- **SDD/TDD:** compliant. Plan Studio persists intent/spec/plan/verifier
  artifacts and requires observable acceptance examples before implementation.
- **Provider containment:** compliant. Provider calls are explicit, selected,
  logged, budgeted, and never triggered by rendering or arbitrary commands.
- **Human gates:** compliant. Permissions, credentials, quota ambiguity, spend,
  active checkout, deployment, publication, and hard deletion remain human
  decisions.
- **Auditability:** compliant. Queue/run/feedback/notification/usage changes
  carry ids, timestamps, source, actor, and affected object.
- **Exceptions:** none recorded. OPEN-017-01 through OPEN-017-05 must be
  resolved before implementation expands beyond the safe defaults.

## Tasks

- [x] T1 Freeze versioned persistence contracts and migrations — files: `runtime/lib/state.mjs`, `runtime/lib/queue.mjs`, `runtime/lib/control-plane.mjs` (new), `runtime/lib/notifications.mjs` (new), `runtime/lib/usage.mjs` (new), `config/manager-state-contract.json` — verify: `node verification/control_plane_contract_test.mjs` — done when: PASS observed: queue v1 migrates to v2 with a backup and idempotent rerun; named queue isolation, archive, notifications, usage snapshots, and the normalized control-plane snapshot pass in an isolated temp project. `atl validate` remains the next integration gate.
- [x] T2 Build the responsive TUI shell and shared design primitives — files: `runtime/lib/dashboard.mjs`, `runtime/lib/tui-layout.mjs` (new), `runtime/lib/tui-components.mjs` (new), `runtime/lib/tui-theme.mjs` (new) — verify: `node verification/tui_layout_test.mjs`, `node verification/dashboard_test.mjs`, `node verification/control_room_ui_test.mjs` — done when: PASS observed for responsive modes at 60/80/120 columns, bounded evidence wrapping, semantic badges, and all existing dashboard/control-room UI regressions; layout selection now uses the shared geometry mode.
- [x] T3 Implement task workspace CRUD with safe archive/restore — files: `runtime/lib/task-workspace.mjs` (new), `runtime/lib/state.mjs`, `runtime/lib/dashboard.mjs`, `runtime/lib/queue.mjs`, `runtime/lib/command-console.mjs` (new) — verify: `node verification/task_workspace_test.mjs`, `python verification/atl_manager_lifecycle_model.py`, `python verification/atl_manager_lifecycle_model.py --mutation-test` — done when: PASS observed for create/edit/archive/restore, queue cleanup, active-run archive safety, and the lifecycle contract/mutation model; archive removes active visibility without hard deletion.
- [x] T4 Implement the internal ATL command console — files: `runtime/lib/command-console.mjs` (new), `runtime/lib/dashboard.mjs`, `runtime/atl-manager.mjs` — verify: `node verification/tui_command_console_test.mjs`, `node verification/dashboard_test.mjs`, `node verification/control_room_ui_test.mjs` — done when: PASS observed for `why`, allowlisted queue/task actions, completion, bounded output, existing dashboard action-bar compatibility, and control-room UI regressions; arbitrary shell text, unknown commands, and launch confirmation bypasses are rejected.
- [x] T5 Build Plan Studio with provider-backed staged SDD/TDD artifacts — files: `runtime/lib/plan-studio.mjs` (new), `runtime/lib/skill-router.mjs`, `runtime/lib/providers.mjs`, `runtime/lib/worker.mjs`, `runtime/lib/dashboard.mjs`, `runtime/prompts/` — verify: `node verification/plan_studio_test.mjs` — done when: intent → frame → specify → route → plan artifacts are schema-validated, skill/provider/model selection is visible, raw input is immutable, usage/approval gates are explicit, and unapproved provider output cannot mutate canonical task state. PASS observed 2026-10-22: staged specify/route artifacts schema-gated with persisted stage files, raw intent immutable across stage advances, explicit confirmation + local-budget usage gate refuse unsafe/exhausted provider calls, provider/model/role recorded on the draft envelope, unapproved output leaves state.tasks empty, approval idempotent.
- [x] T6 Add named multi-queue management and safe run policies — files: `runtime/lib/queue.mjs`, `runtime/lib/launch.mjs`, `runtime/lib/dashboard.mjs`, `runtime/atl-manager.mjs` — verify: `node verification/multi_queue_test.mjs` — done when: queues can be created, renamed, archived, reordered, inspected, dry-run, paused/resumed, and launched independently; legacy queue migration works; default global concurrency and aggregate budgets are enforced. PASS observed 2026-10-22: rename/reorder(clamped)/pause/resume/inspect/dry-run via module + `queue` console subcommands; per-queue `queueId` launch with paused refusal; run-lock lease enforces default global concurrency of one (stale dead-pid lease never blocks); dry-run previews named queues and reports the gate honestly; legacy v1 migration remains covered by `control_plane_contract_test.mjs`.
- [x] T7 Add the Team page and normalized role/session briefs — files: `runtime/lib/control-plane.mjs`, `runtime/lib/dashboard.mjs`, `runtime/lib/launch.mjs`, `runtime/lib/history.mjs`, `runtime/lib/roles.mjs` — verify: `node verification/team_panel_test.mjs` — done when: Mira/Pip/Rowan/Sage/Beacon cards show current task, queue, provider/model, phase, session, latest brief, feedback state, and log/evidence links from one consistent snapshot. PASS observed 2026-10-22: `createControlPlaneSnapshot` now carries a `team` section (role contracts + current task/queue/provider/model/phase/session-summary/brief/feedback per role); Team screen renders linked cards with compact phases below 70 columns and safety-relevant feedback on its own unclippable line; identical renders prove the snapshot is not mutated; width bounded at 60/80/120.
- [x] T8 Add Runs/Overnight control and interruption UX — files: `runtime/lib/launch.mjs`, `runtime/lib/feedback.mjs`, `runtime/lib/dashboard.mjs`, `runtime/lib/notifications.mjs` (new) — verify: `node verification/run_control_plane_test.mjs` — done when: preview/confirm/pause/resume/stop/retry flows are visible, interrupt preserves truthful task/run state, per-session completion briefs are linked, and untouched queue work is not misreported as failed. PASS observed 2026-10-22 with real spawned workers: preview is pure and lease-free, unconfirmed launch refused, pause-after-bot keeps tasks at their gates, stalled workers get one narrated Mira retry then an honest manager-authority block, budget-exhausted tasks record "not reached" without failure labels, session briefs are disk-discoverable with role/status links, run.json records run_id/queue/status lifecycle and the lease is released; operator abort truthfulness remains covered by `run_abort_test.mjs`.
- [x] T9 Add merged Logs, Feedback, and Notifications pages — files: `runtime/lib/dashboard.mjs`, `runtime/lib/feedback.mjs`, `runtime/lib/history.mjs`, `runtime/lib/notifications.mjs` (new), `runtime/lib/feed.mjs` — verify: `node verification/notification_log_test.mjs` — done when: filters, follow/history, dedupe, acknowledge/snooze, checkpoint/interrupt feedback, and source-object links work without losing editor/scroll context. PASS observed 2026-10-22: repeat signals fold into the newest unread copy with a visible ×count badge; snooze hides items until expiry with an explicit `snoozed` filter; severity/task/queue/run filters; `notify list|ack|snooze` console commands; notifications render task/queue/run source links; render proven deterministic and non-mutating of editor/scroll context; checkpoint/interrupt feedback and follow/history remain covered by `feedback_test.mjs`, `control_room_ui_test.mjs`, and `history_test.mjs`.
- [x] T10 Add provider-neutral usage snapshots and risk indicators — files: `runtime/lib/usage.mjs` (new), `runtime/lib/providers.mjs`, `runtime/lib/launch.mjs`, `runtime/lib/history.mjs`, `runtime/lib/dashboard.mjs` — verify: `node verification/usage_telemetry_test.mjs` — done when: local budgets are authoritative, observed session usage is persisted with source/freshness, optional remote adapters produce verified remaining/reset values, stale/unknown values are explicit, and thresholds notify without inventing quota. PASS observed 2026-10-22: persistence round-trips source/status/confidence/captured_at; freshness labels fresh/stale/never-captured; remote adapters record `verified` numbers only — unverified payloads and failures persist explicit `unknown`; `usageGate` blocks exhausted local budgets and never blocks unknown remote quota; warning/exhaustion post deduplicated notifications while unknown limits stay silent; the Usage screen renders freshness + confidence; runs post the threshold check with observed budgets.
- [x] T11 Add responsive, keyboard, mouse, and error-state acceptance coverage — files: `verification/tui_layout_test.mjs`, `verification/control_room_ui_test.mjs`, `verification/dashboard_test.mjs`, `runtime/lib/dashboard.mjs` — verify: `node verification/tui_layout_test.mjs` — PASS observed 2026-10-22: shared task/run/blocker journeys pass at 60/80/120 columns with keyboard paths, resize, empty/loading/error/blocked/running/success states, stable focus, optional mouse capture, bounded diagnostics, and direct control-plane projection rendering. Follow-up live review fixed the medium-width route switcher, route-Enter fall-through, CLI-prefixed in-TUI commands, long-input viewport, and SGR click/key collision; the installed runtime was refreshed and the interactive 80-column path was exercised.
- [x] T12 Synchronize CLI/help/documentation with the new control plane — files: `runtime/atl-manager.mjs`, `runtime/README.md`, `USAGE.md`, `docs/control-room.html` — verify: `rg -n "Plan Studio|Queues|Team|Notifications|Usage|archive|command palette|unknown" runtime/README.md USAGE.md docs/control-room.html runtime/atl-manager.mjs` — PASS observed 2026-10-22: command/TUI routes, safe defaults, provider usage limitations, archive semantics, and human-gate behavior are documented.
- [x] T13 Run the complete implementation gate and inspect scope — files: all files touched by T1–T12 — verify: all JS verification files plus both lifecycle Python checks and `git diff --check` — PASS observed 2026-10-22: full sweep, mutation model, and diff check completed successfully; pre-existing dirty worktree files were preserved. Post-review sweep also passes after the live interaction repairs.

## Verification plan

### Acceptance slices

1. **Foundation:** migrate a copied current project to named queues; validate
   state, queue, run, notification, and usage records; repeat migration twice.
2. **Shell:** render the current long T-001/T-003 blockers at 60/80/120; verify
   no row exceeds its owning panel and every critical continuation is reachable.
3. **Task/command:** create, edit, archive, restore, and `why` a task entirely
   in the TUI; inspect state/feed/audit output after each mutation.
4. **Plan Studio:** use a fake provider adapter first, then a real provider only
   after explicit approval; verify malformed, timed-out, refused, and approved
   outputs independently.
5. **Queues/runs:** create two queues, dry-run each, launch one with the default
   single-session policy, pause/interrupt, deliver feedback, and confirm the
   other queue remains unchanged.
6. **Team/logs/notifications:** simulate all five roles and inspect one linked
   chain from role card to task, queue, session, brief, evidence, and log.
7. **Usage:** exercise local budget, observed token metadata, remote adapter
   success, adapter failure, stale data, unknown quota, warning threshold, and
   reset display. Never assert a remote number without adapter evidence.
8. **Full regression:** run all existing JS/Python checks, lifecycle mutation
   models, install/recovery/control-room tests, then rerun the UI review.

### Implement-mode stop conditions

- Maximum two evidence-changing repairs for the same failure class.
- Maximum four major repair cycles for the entire implementation slice.
- Stop and report if provider/account authority, quota API scope, concurrency,
  archive semantics, or a required verifier remains unresolved.
- Never weaken a lifecycle, migration, usage-source, or layout assertion to turn
  the suite green.
- After every task, inspect the actual diff and preserve all unrelated dirty
  worktree changes.

## Required human decisions before `atl-implement`

Resolve OPEN-017-01 through OPEN-017-05 in `brief.md`. Recommended defaults:

- show remote quota as `unknown` until a provider-specific adapter is verified;
- keep global concurrency at one for the first release;
- require explicit confirmation for each provider planning call unless the user
  later approves a bounded workflow policy;
- implement archive/restore using a new explicit `archived` state only after the
  lifecycle contract/model are updated together;
- support 60 columns as the minimum and show a resize notice below it.

Suggested next mode: `implement` after the OPEN decisions are approved.
