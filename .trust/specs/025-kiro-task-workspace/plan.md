# Spec 025 — Kiro-style task workspace (Tasks page)

Owner-approved brief supplied 2026-11-16 with 8 Kiro reference screenshots.
Supersedes the task-detail/change-review dialogs inside the **Tasks** scope only.
Global nav, Plan Studio, Bots, Schedule, Artifacts pages are out of scope.

## Goal

Replace the task-detail modal and change-review popup with a focused two-column
task workspace: searchable task list left, workspace right. The primary screen
answers: what ATL is doing, what it changed, what passed, what the developer
must do next.

## Surfaces

- **Task list** (left): title, repository, latest useful outcome, attention
  indicator; search; filters All / Running / Needs attention / Completed.
- **Workspace** (right): header (title, repo/branch when recorded, one compact
  run indicator, expandable objective); views **Activity**, **Changes**,
  **Process**; bottom **Ask ATL** composer (existing assistant integration);
  relevant approval / recovery / review actions inline above it.
- **Activity**: expandable rows grouped by recorded ATL stage + attempt (repo
  prep, spec/planning, implementation, review, verification) exposing agent,
  commands, results, files, evidence. Active/failed step expanded first.
- **Changes**: embedded revision selection, file tree, pagination, diff
  inspection, evidence freshness (from `runtime/control-plane-changes.js`),
  file links from Activity/Process open the diff.
- **Process**: connected execution view — repository/workspace → recorded
  stages/attempts → changed files/artifacts → checks/review; nested branches
  for parallel work/retries. Selecting a file opens its diff.
- **Disclosures** (collapsed by default): acceptance criteria, full spec, task
  properties, browser config, resource/token tables, raw logs, lifecycle
  history. Result/blocker summary above the next action; full notes expandable.
- Browser approval inline only when it requires action.
- Narrow screens: list OR selected task with Back; selection, view, scroll,
  expansions survive refresh (localStorage/sessionStorage).

## Interfaces (additive)

- Read-only execution projection joining task events, execution sessions,
  captures and evidence by explicit task/run/session/revision ids: stage,
  attempt, actor, timestamps, outcome, file/evidence refs. Missing links say
  "Not recorded"; unattributed task-level files stay grouped under their
  capture; unrun work labelled planned. No new workflow engine; history needs
  no migration.
- Task inspection responses extended additively with the projection + repo
  context. Existing capture/diff APIs, auth checks, revision pinning preserved.
- Shared composition with the plugin task pane (`taskDetailBody` consumers).

## Files (expected)

- `runtime/lib/control-plane-server.mjs` — projection endpoint/extension.
- new `runtime/lib/execution-projection.mjs` — pure join, unit-testable.
- `runtime/control-plane-client.js` — tasks page two-column, workspace
  (Activity/Changes/Process), composer, disclosures, persistence.
- `runtime/control-plane-changes.js` — expose embeddable render (keep
  `open()` contract for existing callers/tests).
- `runtime/scss/_workspace.scss` + entry import; token-only, RTL-safe.
- `runtime/control-plane-i18n.js` — new strings en/fa.
- `verification/execution_projection_test.mjs` + workspace UI journey.

## Constraints

- Apply on top of the dirty worktree; never revert parallel waves
  (deepseek/batch/plan-studio files belong to other sessions).
- Keep green: task_changes_ui/api/test, control_plane_plugin_ui, responsive,
  server, modal, snapshot_delta, statechart suites.
- Marked [kiro-workspace] evidence under `.atl-evidence/task-workspace-20261116/`.
