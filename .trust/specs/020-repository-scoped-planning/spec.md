# Spec 020 — Repository-scoped imports and planning

## Problem

An imported request (Azure #6341) landed in the ATL workspace that happens to host
the control-plane server. Registering the real target repo (S2H, `${PROJECTS}\S2H`)
under Projects only records supervisor metadata (`~/.atl/supervisor.json`: id, name,
root, session cap) — Plan Studio keeps inspecting the server's own cwd, because the
project root is where `atl ui` was started (`ATL_PROJECT` env or `process.cwd()`,
`runtime/atl-manager.mjs`). Nothing links the import to the repo it belongs to, so
plans get grounded against the wrong codebase and only an amber warning stands in
the way.

## Decision

Keep ATL's per-project state model ("like git": state, drafts, queues, evidence live
in the starting project). Do **not** restructure the server into a multi-tenant app.
Instead, give each imported request, plan draft, plan task, and execution workspace an
explicit **repository binding**, resolved against the existing global supervisor
registry, and enforce it server-side at every transition. This is the delta between
"registration as metadata" and "the project as organizational boundary" — without
duplicating state stores.

## Binding schema (additive; existing data stays valid)

- `task.repository_ids` (ordered array of repository IDs) — imported requests may
  affect several repositories. `task.repository_id` and `task.repository_name` remain
  the first-link compatibility/display fields. Plan-created executable tasks bind to
  exactly one repository, inherited from that repository's approved plan.
- Draft envelope `artifact.json` gains `repository: { id, name, root, revision, captured_at }`
  (nullable for legacy/unassigned drafts). `repository.revision` is the repo's `git
  rev-parse HEAD` captured at review/approve time — the planning revision.
- Queue object gains `repository_id` (nullable) when created by an approval.

Legacy objects without the fields are **unassigned**: they keep today's behavior
(plan against the server project root). No migration step needed; existing imports
survive by construction.

## Registry contract

`resolvePlanRepository(root, loaded)` (new export, `runtime/lib/plan-studio.mjs`)
resolves the binding in this order: `loaded.repository` (draft envelope) →
`loaded.repository_id` → source task's `repository_id`. It validates against the
supervisor registry (`supervisorSnapshot()`): id must be registered, path must exist
(realpath) and contain `.git`. Failures **throw honest errors that block planning and
execution without deleting the request** (e.g. "assigned repository is missing on
disk … reassign or re-register; the request itself is kept"). Unassigned resolves to
`repoRoot: null`, meaning: inspect the ATL project root, exactly as today.

## Enforcement points (no UI-only filtering)

1. **Import** — `POST /api/intake/import` accepts `repository_ids` (with singular
   `repository_id` compatibility); each ID is validated against the registry
   server-side; `importCandidates(..., { repositoryIds })` stamps created tasks.
   Duplicate refresh never clobbers an existing assignment.
2. **Assign / move** — `POST /api/intake/repository` accepts the full ordered
   `{ taskId, repositoryIds }` list (empty unassigns; singular `repositoryId` remains
   compatible). Refused (409) when the request already has a plan
   (`plan_reviewed_by_draft` or any draft whose `source_task_id` points at it) —
   explicit handling requirement: the owner must remove/replan first; the API never
   silently re-points an existing plan.
3. **Planning inspection** — `planningEvidence(root, artifact, { repoRoot })` and
   `validatePlanGrounding(root, artifact, { repoRoot })` accept an inspection base.
   All Plan Studio routes (`/api/plan/local|generate|review|approve|regenerate`) and
   `runPlanProvider` resolve the binding from the draft/source task and pass
   `repoRoot`; the review fingerprint, evidence snapshot, and grounding checks all
   read the bound repo, so a plan is provably based on the intended codebase.
4. **Approval** — `approvePlanDraftUnlocked` recomputes evidence/grounding against
   the bound repo, stamps created queue tasks with `repository_id`/`repository_name`,
   stamps the queue, and captures `repository.revision` (HEAD) into the draft
   envelope. Approval is blocked when the binding cannot be resolved.
5. **Execution** — `ensureWorkspace` (`runtime/lib/workspace.mjs`) resolves
   `task.repository_id` through the registry and sources the task worktree from that
   repo (`git worktree add`), taking precedence after explicit `config.repos` and
   before the project-root fallback. A bound task whose repo is missing or not a git
   repo **throws at dispatch** — the task fails honestly and stays in place.
6. **API responses** — `draftResponse` includes `repository` so the UI renders the
   binding; task payloads carry `repository_id`/`repository_name`.

## UI (surgical)

- Import panel: multi-select "Affected repositories" (registered projects via
  `GET /api/supervisor`; none selected means the current workspace), sent with the
  import. A request affecting multiple repositories gets a separate scoped plan and
  queue in each; all branches retain the same imported source request.
- Imported-request rows and Studio source context: repository badge; assign/move
  control for unplanned requests; the amber "correct repository" notice becomes an
  assign-and-continue flow when the source has no binding, and a green
  "Planning in `<name>` · rev" chip when it does.
- Queue/task surfaces show the repository badge.

## Work map and manual task assignment

- Projects is a work map, not only a registry: each repository exposes a request →
  plan → queue → executable task relationship, with dependency IDs visible on task
  rows. The repository registry remains available as a secondary details section.
- Unassigned imported requests open the same multi-repository association dialog as
  Sources; plan pinning rules continue to protect existing drafts and queues.
- Manual task create/edit can select one registered repository before work starts.
  The server refuses reassignment for imported requests, plan-created tasks, tasks
  with a workspace, or tasks beyond the new/pending/queued/triaged pre-execution states.

## Out of scope (phase 2, documented not built)

Project-scoped navigation tree, per-project UI workspaces, "Open workspace here"
launcher, TUI repository badges, per-repo evidence dashboards. The binding schema
above is the foundation those would consume.

## Acceptance criteria → tests (`verification/plan_repository_scoping_test.mjs`)

1. Import with `repository_id` stamps tasks; re-import does not clobber assignment.
2. Assign/move endpoint: unassigned → assigned works; move with an existing plan → 409.
3. `planningEvidence`/`validatePlanGrounding` with `repoRoot` read the bound repo, not
   the ATL project (asserted via repo-specific file fingerprints), and unchanged
   without `repoRoot` (legacy behavior preserved).
4. Approval inherits `repository_id` onto queue tasks + queue, captures HEAD revision.
5. Approval blocked when the bound repo directory is deleted (request kept).
6. `ensureWorkspace` for a bound task creates a worktree sourced from the registered
   repo; missing repo blocks dispatch with an honest error.
7. Old drafts/tasks without binding behave exactly as before (unassigned → project root).
