# My Tasks: briefs, reviews and task views

My Tasks groups assigned Azure work items into **To Do**, **In Progress** and **Done**, using Azure's state categories rather than hardcoded state names. Done starts collapsed and has a green border and background. Switch between List and Kanban; the workspace remembers filters, search, view and collapsed sections. Large sections load a few cards first, with **Show more** for the rest.

Opening a card reads its saved review. **At a glance** shows the short explanation, expected outcome and a rendered Mermaid diagram. **Review** contains findings, suggested checks and expandable code evidence. **Original task** keeps Azure's description, acceptance criteria and metadata. Suggested checks are not test results, and Azure's Done state does not establish that the implementation was verified.

## Background generation

The server maintains a durable, single-worker review queue under `.trust/manager/my-tasks/`. It runs independently of the browser and the Azure sync. It processes In Progress before To Do, then Done, ordered by priority and latest change. A job has a three-minute provider timeout and one retry for a transient failure. The configured ATL provider/model is reused; existing model restrictions, quota observations, run locks and concurrent-session capacity are respected. There is no automatic provider upgrade or new external service.

Every review records its source revision, repository snapshots, evidence, provider/model, language and ATL checklist versions. Task changes, code changes (including dirty files), repository binding changes and checklist changes invalidate the cache. Previous output stays readable with a **Needs updating** indication. Failed jobs have an explicit retry action; provider/auth/quota problems pause reviews without disabling My Tasks or removing task data.

The review language follows the ATL UI language. Switching language queues missing or outdated versions for every current task; returning to a cached language reuses it. Pending versions do not masquerade as completed reviews. Other-language versions remain available by explicit selection.

## Connect code

Open **Settings → Repository connections** to map an Azure project or Area Path to one or more registered ATL repositories. Use **Review → Repository override** for a specific task. Clear that override to inherit connections; saving an empty override intentionally keeps that task text-only.

Connection precedence is:

1. Explicit task override.
2. Exact source-URL association of an already imported Azure request.
3. Longest matching Area Path rule (whole path segments).
4. Project-level rule.

Repositories are never guessed from names. Unbound tasks still receive a task-text review, marked **Code not reviewed**. Connecting code queues an upgraded review. Missing repositories and absent evidence are reported as limitations. Evidence is a bounded selection of excerpts from the registered repositories; it is not an exhaustive repository audit. References are validated against the excerpts actually supplied to the agent.

Mermaid is bundled locally (12.2.0, MIT license in `runtime/assets/mermaid.LICENSE`) and rendered in strict mode. Graph node identities and source are generated from validated structured output. Observed nodes require evidence; proposed and unknown nodes have explicit labels. If diagram loading or rendering fails, the text flow remains available.

## HTTP interface

All mutations use the existing Control Plane owner/CSRF boundary.

| Method and path | Behavior |
| --- | --- |
| `GET /api/my-tasks/repository-bindings` | Returns `{bindings, repositories}`; registry entries expose IDs and names. |
| `POST /api/my-tasks/repository-bindings` | Saves `{rules:[{connection,project,area,repository_ids}],items:{[workItemKey]:repositoryIds}}` and queues affected reviews. |
| `GET /api/my-tasks/review?key=…&locale=en-US` | Reads `{review}`: state, saved result, evidence, provenance, Mermaid and other available locales. Returns 404 for a no-longer-assigned task. |
| `GET /api/my-tasks/reviews/status?locale=…` | Returns total, ready, queued, failed, running and paused state. |
| `POST /api/my-tasks/reviews/ensure` | Accepts `{locale:"en-US"|"fa-IR",resume?:true}`; deduplicates and queues missing/stale reviews. |
| `POST /api/my-tasks/review/retry` | Accepts `{key,locale}`; requeues that task and resumes a paused review queue. |

`GET /api/my-tasks/items?locale=…` adds `brief`, `review_status`, `review_version`, aggregate `reviews` and a stable opaque `workspace_key`. It does not include complete reviews or evidence. GET requests never invoke a model.

## Verification

- `node verification/my_tasks_reviews_test.mjs`: queue order, all states, bindings, actual Git excerpts, dirty/revision invalidation, restart, language cache, auth pause, retry ceiling and evidence validation.
- `node verification/my_tasks_ui_journey_test.mjs`: setup, saved views and filters, state grouping, tabbed details, sanitized originals, keyboard, language, mobile and project-list failure recovery.
- `node verification/my_tasks_review_ui_test.mjs`: 205 pre-generated reviews, bounded card batches, responsiveness, pure cached reads, repository override, diagrams/fallback and dark/light/RTL/mobile captures.
- Existing fetch, scheduler, server, Azure adapter and provider-model checks remain relevant.

Visual fixtures are saved under `.trust/specs/021-azure-my-tasks/evidence/review-ui/`. They contain synthetic tasks, not production review data.
# Priority and Jira Cloud

See [Urgency and Jira Cloud](my-tasks-triage-jira.md) for GLM Flash analysis,
mixed-source Kanban, OAuth/MCP connection and browser-approved Jira actions.

