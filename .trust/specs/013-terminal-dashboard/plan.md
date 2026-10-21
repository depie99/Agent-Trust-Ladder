# Plan — 013 terminal dashboard

Spec: approved by the current implementation request · 2026-10-21 · Dose: Standard

## Approach and key decisions

- Build a zero-dependency, read-only `atl dashboard` TUI over the existing `state.json`, `feed.jsonl`, and inbox files.
- Keep the existing CLI and state machine authoritative; the dashboard is a projection, never a second state store.
- Use the existing ATL visual language: graphite background, violet primary accent, mint progress, amber attention, and coral alerts.
- Use a lifecycle graph plus task list, selected-task detail, live feed, next actions, and an explicit source-file reader.
- Refresh automatically and on `r`; show a visible syncing state so stale data is not mistaken for live state.
- Provide `--once` and plain rendering for redirected terminals and deterministic verification.

## Impact

Files expected to change:

- `runtime/atl-manager.mjs` — expose the new command and flags.
- `runtime/lib/dashboard.mjs` — snapshot projection, ANSI/ASCII rendering, interactive loop, file/feed views.
- `runtime/README.md` — discoverability and keyboard controls.
- `verification/dashboard_test.mjs` — deterministic rendering contract.

Files at risk:

- `runtime/lib/state.mjs`, `runtime/lib/feed.mjs`, and `.trust/manager/*` are read-only inputs; no schema or state mutation is planned.
- Existing uncommitted files are protected and must remain outside the patch.

Boundary contracts: local terminal capabilities only. No network, deployment, external service, merge, or production boundary is crossed.

## Pre-mortem

| Failure mode | Detection | Rollback / containment |
|---|---|---|
| TUI truncates or corrupts content at narrow widths | plain render test at 80 and 120 columns; manual terminal run | use `--once`; remove only dashboard import/command and new module |
| Dashboard shows stale or misleading state | refresh reads the authoritative files; loading indicator and timestamp are visible | exit dashboard; state machine remains unchanged |
| Enter cannot find a task source file | source resolver reports the resolved path or an explicit not-found message | no file mutation; continue using `show`/`feed` |

## Constitution compliance

Complies with the repository's evidence-first rules: no worker, merge, deploy, external messaging, or state mutation is introduced. The existing `validate` data failure is pre-existing and remains an open item.

## Tasks

- [x] T1 Add a read-only dashboard projection and renderer — files: `runtime/lib/dashboard.mjs` — verify: `node verification/dashboard_test.mjs` — observed PASS for lifecycle counts, selected task, feed, source resolution, loading-safe rendering, ANSI-free plain output, and widths 80/120.
- [x] T2 Wire `atl dashboard` / `atl ui` and safe flags into the CLI — files: `runtime/atl-manager.mjs` — verify: `node runtime\\atl-manager.mjs dashboard --once --plain` — observed live portfolio output, alias smoke PASS, and unchanged `state.json` SHA-256 before/after.
- [x] T3 Document the dashboard entry point and controls — files: `runtime/README.md` — verify: `rg -n "dashboard|CONTROL ROOM|Enter|--once" runtime/README.md` — observed all discoverability/control references present.
- [x] T4 Re-run targeted static and lifecycle checks and inspect the diff — files: changed files only — verify: `node --check runtime\\atl-manager.mjs; node --check runtime\\lib\\dashboard.mjs; python verification\\atl_manager_lifecycle_model.py; python verification\\atl_manager_lifecycle_model.py --mutation-test` — observed all targeted checks PASS; `git diff --check` emitted only pre-existing line-ending warnings.
- [x] T5 Repair the interactive affordance and visual theme — files: `runtime/lib/dashboard.mjs`, `runtime/README.md`, `runtime/atl-manager.mjs` — verify: real TTY keyboard path plus dashboard tests — observed focus highlight, `FOCUS n/5`, Tab/number navigation, colored panel surfaces, source/feed navigation, and clean quit.
- [x] T6 Refresh the per-user install and recheck the user-facing command — files: `C:\\Users\\Sanaz\\.atl\\runtime` (generated install copy) — verify: `node scripts\\install.mjs --no-path`, `atl --help`, `atl ui --once --plain`, state hash — observed dashboard command present, static snapshot footer honest, and state hash unchanged.

## Verification plan

- Deterministic renderer assertions for content, state counts, source reader resolution, loading state, and width 80/120.
- CLI smoke with `--once --plain`; compare state file hash before/after to prove read-only behavior.
- Existing manager lifecycle baseline and mutation control.
- Manual TUI observation on the available terminal: initial syncing state, narrow-width lifecycle graph, Enter/Esc source view, feed/help view, refresh, and quit. Browser-style resize automation was not available; deterministic width 80/120 renderer coverage is included instead.

## Execution evidence

- Real TTY showed `SYNCING` spinner, two-row lifecycle graph at narrow width, source-file view for T-001, full feed view, help view, refresh, and clean quit behavior.
- Follow-up TTY review showed the original selection defect was caused by testing `--once --plain`; the interactive route now visibly highlights the focused row and exposes `Tab`/`1..9` navigation. `--once` now labels itself `SNAPSHOT` and does not advertise selection controls.
- The user install was refreshed with `--no-path`; no PATH edit or manager-state mutation occurred.
- Pre-existing `node runtime\\atl-manager.mjs validate` remains failing on two historical evidence strings in T-003/T-005; this dashboard change does not alter state validation or those records.

Suggested next mode: `verify` for a separate review pass before any merge or release.
