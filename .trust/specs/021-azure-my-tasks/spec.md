# Spec 021 — Azure "My Tasks" dashboard page

Status: approved-by-owner (owner-provided specification, Persian, 2026-11-11). This file is the
English working record; the owner's message is authoritative for intent.

## Outcome

A "My Tasks" page in the ATL Control Plane dashboard shows work items assigned to the authenticated account across owner-selected projects, grouped by project and Area Path and refreshed by a server-side scheduler independently of the browser. Items in Proposed, InProgress, and Complete categories are shown; Removed items are excluded.

## Non-goals (v1, fixed by owner)

- One Azure connection (the existing one), multiple selected projects.
- No email/messenger notifications, no automatic task execution, no writes to Azure.
- "Area" means Area Path. No cross-connection support yet.

## Behavior contract

### Fetch (step 1)
- Identity "me" resolves from the authenticated connection via `_apis/ConnectionData`; assignment
  matches by Azure identity id, never by display name. Account name is visible in settings.
- WIQL per project: `[System.TeamProject] = @project AND [System.AssignedTo] = @Me`, all work item
  types, all iterations. Detail fetch: `workitemsbatch` in chunks of 200 ids — the intake path that
  slices to 100 items is NOT reused. api-version stays 6.0 (current self-hosted Server).
- Closed/removed classification uses each project's per-type state categories
  (`workitemtypes/{type}/states`, category Proposed/InProgress/Complete/Removed). Names like
  `Done`/`Closed` are never hardcoded; custom types and states work.
- Optional missing fields never fail the fetch. Item key = connection + project + id; a revision
  change updates the same record. Removal from the active list happens only after a complete,
  successful fetch of that project.

### Store + scheduler (step 2)
- Data lives in an independent local store (`<root>/.trust/manager/my-tasks/store.json`), never as
  ATL executive tasks; the page never writes to Azure.
- Settings live in `config/manager.json` under `myTasks`: `enabled` (independent feature flag —
  turning it off stops the scheduler), `schedule_on`, `interval_minutes` (5/15/30/60 or custom
  1–1440, default 15), `projects` (selected names).
- One concurrent check per connection; a manual request during a run joins the same run (returns
  the active run id). Manual "check now" works regardless of the schedule.
- Settings and last successful results survive restarts. On service start, if the check is due, run
  once; missed checks never accumulate (no catch-up loops).
- A failing project never blanks other projects; its last successful data stays with a stale badge.
- Transient/network failures: exponential backoff capped at 15 minutes; `Retry-After` honored.
  Auth failure (401) pauses automatic checks until reconnect; permission failure (403) is limited
  to that project.
- The PAT comes only through the existing connection mechanism (`currentAzureToken` → DPAPI store
  or `AZDO_PAT`); it never appears in API responses, logs, or settings. Work-item HTML is
  sanitized server-side before storage/serving.

### APIs (step 2)
- `GET  /api/my-tasks/projects` — accessible projects + resolved identity.
- `GET/POST /api/my-tasks/settings` — read/save settings (validated; save restarts/stops scheduler).
- `POST /api/my-tasks/check` — manual check → `{ run_id, joined }`.
- `GET  /api/my-tasks/status` — run state, scheduler state, next due time.
- `GET  /api/my-tasks/items` — records + per-project freshness/error. `GET /api/my-tasks/item?key=`
  — one record's details.
- `POST /api/my-tasks/tick` — evaluate the schedule at a caller-supplied clock (mirrors
  `/api/routines/tick`; this is how the simulated-clock tests drive the scheduler).

### UI (step 3)
- Setup: connection status (existing saved connection reused), identity confirmation, project
  multi-select, interval choice, schedule toggle.
- KPI strip: active and completed counts, new items (first seen < 24h), connection status, last successful check,
  next check. "Check now" button independent of schedule.
- Collapsible project and Area Path groups. Row: id, title, type, category-colored state (Proposed blue, InProgress amber, Complete green), priority, sprint, description excerpt, last change, new badge. Completed items remain visible; Removed items are excluded. Row opens a detail panel: full description (sanitized HTML,
  excerpt, last change, new badge. Row opens a detail panel: full description (sanitized HTML,
  dir=auto), acceptance criteria, assignee, tags, "Open in Azure" link.
- Search over title/id/description text; filters: project, area, type, state; default sort priority
  then last change.
- Designed states: loading, empty, disconnected, stale. Persian/RTL via the existing locale layer;
  keyboard-operable rows and groups; desktop and mobile.

## Acceptance examples

1. 130 assigned items (mock) all land in the store; no 100-item silent drop; custom type/state
   classified via states API; `Done`-named-but-Proposed states stay listed.
2. Re-check updates title/state/assignee on the same record (no duplicates); an item closed or
   reassigned elsewhere disappears from the active list only after its project fetched fully.
3. Project B fails mid-run: project A stays fresh, B keeps its last successful records flagged stale.
4. Simulated clock: tick at T runs (first run due); T+5m does not; T+16m runs; interval change and
   schedule off/on reflected; service restart with overdue due fires exactly one catch-up check.
5. Manual check while a run is in flight joins it (same run id, `joined: true`).
6. 401 pauses the scheduler until reconnect; 403 marks only that project; Retry-After pushes the
   next attempt.
7. HTML with `<script>` never reaches the store; UI shows sanitized content; empty description and
   long Persian/English text render fine.
8. Real Azure verification is explicitly deferred: until the owner compares results with the
   equivalent Azure query, the live connection is NOT claimed verified.

## Verification

- `verification/my_tasks_fetch_test.mjs` — fetch/classification/sanitize/merge, per-project isolation.
- `verification/my_tasks_scheduler_test.mjs` — simulated-clock lifecycle, join, backoff, auth pause,
  restart persistence (server-level, mock transport).
- `verification/my_tasks_ui_journey_test.mjs` — Playwright: setup → check → groups → search/filter →
  detail panel, RTL/keyboard sanity.
- Re-run affected existing suites: control_plane_server_test, azure_issue_journey_test.
