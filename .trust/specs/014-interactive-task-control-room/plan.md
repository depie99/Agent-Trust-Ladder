# Plan — 014 interactive task control room

Maps [brief.md](brief.md) onto the runtime as of 2026-10-21. Dose: Standard → Critical
(provider dispatch crosses provider/auth/workspace/spend boundaries).

## Design decisions (resolving the brief's OPEN items to its recommended defaults)

- **OPEN-001** → per-role provider profiles in `config/manager.json` under `providers`
  (`{ default: "codex", auth: "subscription", by_role: {} }`). `by_role.sage = "claude"`
  is an explicit override; unset roles use the default.
- **OPEN-002** → Codex CLI (`codex exec`) and Claude Code (`claude -p`) local executables.
  No Desktop adapter in this slice.
- **OPEN-003** → the composer saves an immutable raw draft under
  `.trust/manager/drafts/` immediately, then creates the canonical `new` candidate.
  Resubmitting identical text is idempotent by `intake_key = composer:<sha1-12>`.
- **OPEN-004** → imports are read-only. No write-back to GitHub/Azure anywhere.

**Containment decision:** the TUI never launches a provider process. The launch preview
screen renders the exact plan and prints the confirming command (`atl launch --confirm`).
Dispatch lives only in the CLI behind `--confirm`, sequential, bounded, reusing the
existing `driveTaskUntilGate` semantics. The dashboard watches progress live through
state.json + feed.jsonl + session logs, which it already projects.

## Architecture

| Unit | File | Job |
|---|---|---|
| Provider discovery + profiles | `runtime/lib/providers.mjs` (new) | PATH scan for `codex`/`claude`; `providerProfile(config)`, `providerForRole(profile, role)`; actionable "not found" messages |
| Execution queue | `runtime/lib/queue.mjs` (new) | persistent `.trust/manager/queue.json` (membership: id, added_at, added_by); add/remove/list/clear; membership ≠ keyboard focus |
| Composer + import apply | `runtime/lib/composer.mjs` (new) | deterministic normalization of free text (reuses `parseIntakeFile`); immutable drafts; `composeTask`; `importCandidates` shared by CLI `intake` and TUI import screen (dedupe, createTask, deterministic route, feed, log) |
| Launch engine | `runtime/lib/launch.mjs` (new) | `driveTaskUntilGate` moved here unchanged (gains `resolveWorker(role)` + provider preflight); `buildLaunchPlan`; `executeLaunchQueue` (sequential, shared budget, block-and-move-on, ends with saved brief) |
| CLI | `runtime/atl-manager.mjs` | new commands `compose`, `queue`, `launch`, `providers`; intake loop refactored onto `importCandidates`; `providers` section in `defaultConfig()`; queue sanity in `validate` |
| TUI | `runtime/lib/dashboard.mjs` | new screens: compose (`c`), import (`i`), packet review/edit (`v`), queue (`x`), launch preview (`l`), providers (`p`), sessions (`s`); queue badge in portfolio; help/footer updated |
| Verification | `verification/control_room_test.mjs` (new) | acceptance A–E at logic level in a temp project |

## Data contracts

- `queue.json`: `{ version: 1, updated_at, items: [{ id, added_at, added_by }] }`.
  Local and removable; its loss degrades to the CLI-only flow (rollback story).
- Draft files: `.trust/manager/drafts/<date>/<time>-<slug>.md`, frontmatter
  (`intake_key`, `source`, `created_at`) + verbatim user text. Never rewritten.
- Session logs stay at `.trust/manager/overnight/<task>/session-NN-<role>.log`.

## Must-not-change guarantees (from the brief)

- `state.json` and `config/manager-state-contract.json` untouched; every TUI mutation
  goes through the same `createTask` / `transition` / `addEvidence` / `logEvent` /
  `feedPost` functions the CLI uses, with honest actors (manager overrides logged as manager).
- `worker.mjs` stays provider-neutral; no LLM call from the TUI renderer (deterministic
  `routeTask` only; Jev remains a CLI `--smart` opt-in).
- Secrets never written to task files, drafts, feed entries, or prompts.

## Contract ledger (provider-dispatch boundary)

| contract | expected behavior | proof observation | owner | rollback/containment | evidence level (target) |
|---|---|---|---|---|---|
| discovery | missing executable blocks launch with actionable message, no spawn | unit test D + `atl providers` + `launch --dry-run` | providers.mjs | hide launch actions | locally proven |
| launch plan | preview lists exactly queued tasks with role/provider/workspace/auth/budget/containment | `launch --dry-run` + TUI preview + test C | launch.mjs | queue.json removable | locally proven |
| dispatch containment | no spawn without `--confirm`; provider failure → no agent, task not `in_progress`, blocker + feed event | test D + dry-run | launch.mjs | rollback story in brief | locally proven |
| state authority | state advances only via observed transitions/evidence | existing state contract + `atl validate` | state.mjs | unchanged | locally proven |
| canonical task model | composer/import reuse `createTask` fields + `intake_key` dedupe | tests A/B | composer.mjs | drafts removable | locally proven |
| real provider session | `codex exec`/`claude -p` execute a role session in the workspace | requires the user's confirmed run (spend authorization is a human gate per brief) | worker.mjs | bounded budgets + timeouts | still unknown → conditional |

## Verification plan

1. `verification/control_room_test.mjs` — temp project: compose idempotency + draft saved;
   import dedupe by intake_key; queue membership persistence + preview order; provider
   missing → plan blocker + no spawn + task outside `in_progress`; launch plan contents;
   `executeLaunchQueue` refuses without queue.
2. Full existing suite re-run (`worker`, `dashboard`, `intake`, install, lifecycle…).
3. Real CLI pass in a temp `ATL_PROJECT`: `init → compose → queue add → launch --dry-run`
   → `providers` → `validate`; `dashboard --once` renders new panels in plain mode.
4. Negative gates: `launch` without `--confirm` refuses; compose of duplicate text adds
   no second task.

## Documentation impact

`runtime/README.md` (control-room section) + `USAGE.md` (new commands) + `usage()` text.
GitHub Pages docs (docs/*.html) intentionally not rebuilt in this slice — noted in the
verdict as a known gap for a docs pass.
