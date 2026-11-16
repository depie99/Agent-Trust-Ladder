# Spec 022 — Reliable Azure task intake and Plan Studio preparation

Status: implemented (this wave)
Owner: Sanaz
Date: 2026-11-14
Supersedes: nothing. Extends Spec 021 (Azure My Tasks) and Spec 020 (repository-scoped planning).

## Problem

The My Tasks store holds 181 assigned Azure work items: 158 without descriptions, none with
acceptance-criteria fields. Plans generated for the #6376 family kept failing review because
unresolved repository questions were treated as answered. Two baseline defects blocked a
trustworthy inventory at the time this spec was written:

1. **Fetcher 400** — `workitemsbatch` was called with `fields` and `$expand: Relations` together;
   the owner's on-prem Azure Server rejects that combination ("The expand parameter can not be
   used with the fields parameter"), leaving `example-project` stale from 2026-11-13 with
   181 frozen records.
2. **State misclassification** — unknown/aliased state categories normalized to `inprogress`, so
   Done tasks (category `Completed` on their server) showed as In Progress (168 of 181 records).

## Goal

Make every assigned task understandable and give it a visible next step, preparing active work
first while accounting for the complete backlog. Success means: every task renders a useful
preview; implementation-ready tasks have concrete plans; incomplete tasks carry specific saved
follow-ups. External dependencies may remain, but surface early with an owner and a recovery
action.

## Design

### Baseline repairs

- Two-phase fetch: fields-only batch, then a degradable `{ids, $expand: Relations}` pass that
  attaches dependency links; a failing relations pass never fails the project read (warning in
  the run summary).
- Category aliases absorb server spelling drift (`completed → complete`); a missing category
  falls back to terminal state names only; per-type categories re-derive on every fetch instead
  of trusting cached mappings.

### Preparation records (`runtime/lib/task-preparation.mjs`)

One record per work item at `.trust/manager/my-tasks/preparations/<sha256(key)>.json`:
brief (understood outcome, existing behavior, requested behavior, scope, acceptance examples,
evidence reused from the short review with its coverage limitation kept), repositories
(resolved via the Spec-021 binding rules), questions split into `owner_decision` and
`investigation` kinds, bounded discovery runs stamped with the brief revision they observed,
next action, and handoff stamp. Writes are atomic with a per-record revision CAS (409 on
conflict). Azure is never written.

Derived status (computed on read, never stored): `historical` (complete — inventoried without
reopening), `not_prepared`, `needs_investigation`, `needs_answer` (≥1 open owner decision),
`ready` (brief complete, zero open questions). Inventory access seeds skeleton records for
active tasks only, from saved source content, so previews render before any provider call and
survive provider failure.

### Interfaces

- `GET /api/my-tasks/preparations` — inventory with statuses, counts, next actions, and
  request/plan linkage (`linked_request` from state.json + `planDraftIndex`). Review state
  (`reviews.json`) and plan/review state (`state.json` + plan-studio envelopes) stay separate
  provenance views; they are never merged.
- `GET /api/my-tasks/preparation?key=` — record, derived status, freshness, run currency,
  linkage.
- `POST /api/my-tasks/preparation/save|question|answer|investigate|handoff` — CAS-guarded
  mutations. `investigate` mode `manual` is free; mode `discovery` is one bounded provider
  request through the planning seam, refused before any spend when the provider is not ready,
  guarded against parallel in-flight runs, and recorded with its error on failure.
- `POST /api/plan/generate` — when the source request carries `prep_key`, generation is 409-locked
  until the record is `ready` (each open question listed as its own recovery reason) and the
  Azure revision is unchanged since preparation.

### Dashboard

My Tasks gains a Preparation tab (brief fields with explicit save, questions grouped by kind,
discovery runs with stale markers, bounded-discovery and handoff actions, linked request/plan
info), a preparation chip on cards, and a preparation filter. All strings are English/Persian
pairs; preparation states never replace the plan review and approval gates.

### Handoff

Idempotent by Azure remote id: an existing imported request is reused, otherwise one is created
via `importCandidates` with the brief as the objective, acceptance examples as completion
checks, and the `azure:<collection>:<project>:<id>:<rev>` intake key (identical to the Azure
intake adapter, so later syncs dedupe). Repository bindings merge only while planning has not
locked them. `prep_key`/`prep_revision`/`prep_handed_at` stamp the request.

## Verification

- `verification/my_tasks_fetch_test.mjs` — fields/$expand never combined, degradable relations
  pass, category alias + stale-cache re-derivation.
- `verification/task_preparation_store_test.mjs` — statuses, CAS, question kinds, discovery
  runs, idempotent handoff with planning-locked bindings, generation gate, active-only seeding,
  review-evidence limitation reuse.
- `verification/task_preparation_api_test.mjs` — HTTP contract incl. the #6376 dual-repo fixture
  (owner decision and investigation questions stay distinguishable through handoff and gating).
- `verification/task_preparation_ui_journey_test.mjs` — chips, filter, brief edit, question
  lifecycle, discovery run, handoff into Plan Studio, persistence, RTL labels.

Known pre-existing failures unrelated to this wave (verified red with this wave's client changes
reverted): `plan_studio_journey_test.mjs` (publish-preview step), `task_dependency_contract_test.mjs`
(`task_proposals` fixture drift).

## Non-goals

No automatic Azure comments or task updates; clarification stays inside ATL. "Preview" means the
task/plan preview surfaces already described. Owner approval requirements remain binding.
