# Local API reference

This route index is extracted from literal API paths in `runtime/lib/control-plane-server.mjs`. It is a source-navigation aid, not a versioned OpenAPI schema. Parameterized/constructed routes may require following their handler.

## How to inspect a request

Use the Control Plane's supported operation and inspect its browser request and source handler. Check the handler's HTTP method, payload validation, owner-session requirements, and response before writing a client. Do not infer an allowed method from a path name.

## Owner-session boundary

The browser server binds to loopback by default. Browser-origin mutations use same-origin and owner-session/CSRF checks. Origin-less command-line requests remain supported by the outer guard; inspect each route rather than assuming universal session authentication. Some sensitive read operations, including change review, also require the owner cookie and `x-atl-csrf` header. A copied URL alone is insufficient authority. The browser client demonstrates the supported request flow.

Read `runtime/lib/session-auth.mjs`, route guards in `control-plane-server.mjs`, and `verification/owner_session_approval_test.mjs` before integrating. Keep tokens out of logs and URLs.

## Harness planning and execution tools

The bundled MCP host exposes atl_plan_*, atl_run_*, atl_program_*, and atl_project_bootstrap tools. Every tool requires an absolute project path and routes to that project local daemon. The shared internal HTTP adapter is POST /api/harness/<operation>. Plan approval creates a queue; run start consumes a fingerprinted preview and requires exact developer authorization. Program recovery requires evidence for each uncertain dispatch. These routes are internal; harness clients should use the tool contracts in runtime/lib/plugin-host.mjs.


## Literal route index

| Path | Source |
|---|---|
| `/api/approvals` | `runtime/lib/control-plane-server.mjs` |
| `/api/assistant` | `runtime/lib/control-plane-server.mjs` |
| `/api/backups` | `runtime/lib/control-plane-server.mjs` |
| `/api/backups/preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/batch` | `runtime/lib/control-plane-server.mjs` |
| `/api/brain` | `runtime/lib/control-plane-server.mjs` |
| `/api/browser-access` | `runtime/lib/control-plane-server.mjs` |
| `/api/command` | `runtime/lib/control-plane-server.mjs` |
| `/api/daemon` | `runtime/lib/control-plane-server.mjs` |
| `/api/daemon/lease` | `runtime/lib/control-plane-server.mjs` |
| `/api/daemon/lease/release` | `runtime/lib/control-plane-server.mjs` |
| `/api/daemon/lease/renew` | `runtime/lib/control-plane-server.mjs` |
| `/api/daemon/shutdown` | `runtime/lib/control-plane-server.mjs` |
| `/api/delivery` | `runtime/lib/control-plane-server.mjs` |
| `/api/dispatch/preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/events` | `runtime/lib/control-plane-server.mjs` |
| `/api/execution-access` | `runtime/lib/control-plane-server.mjs` |
| `/api/harness/` | `runtime/lib/control-plane-server.mjs` |
| `/api/harness/program/link` | `runtime/lib/control-plane-server.mjs` |
| `/api/health` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/azure/iterations` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/connections` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/credentials/azure` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/credentials/github` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/history` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/history/clear` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/import` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/repository` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/sources` | `runtime/lib/control-plane-server.mjs` |
| `/api/memory` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/check` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/item` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/items` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/jira/` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/preparation` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/preparation/` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/preparations` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/projects` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/repository-bindings` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/review` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/review/retry` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/reviews/ensure` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/reviews/status` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/settings` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/status` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/tick` | `runtime/lib/control-plane-server.mjs` |
| `/api/my-tasks/triage` | `runtime/lib/control-plane-server.mjs` |
| `/api/navigation` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/approve` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/archive` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/candidate` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/card` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/clarify` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/drafts` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/generate` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/local` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/publish` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/publish-preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/question-progress` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/refine` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/regenerate` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/repair` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/review` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/review-cancel` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/review-progress` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/source-refresh` | `runtime/lib/control-plane-server.mjs` |
| `/api/projects/assign-task` | `runtime/lib/control-plane-server.mjs` |
| `/api/projects/map` | `runtime/lib/control-plane-server.mjs` |
| `/api/providers` | `runtime/lib/control-plane-server.mjs` |
| `/api/resource-policy` | `runtime/lib/control-plane-server.mjs` |
| `/api/routines/recover` | `runtime/lib/control-plane-server.mjs` |
| `/api/routines/run` | `runtime/lib/control-plane-server.mjs` |
| `/api/routines/runs` | `runtime/lib/control-plane-server.mjs` |
| `/api/routines/tick` | `runtime/lib/control-plane-server.mjs` |
| `/api/run` | `runtime/lib/control-plane-server.mjs` |
| `/api/run/preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/run/stop` | `runtime/lib/control-plane-server.mjs` |
| `/api/snapshot` | `runtime/lib/control-plane-server.mjs` |
| `/api/supervisor` | `runtime/lib/control-plane-server.mjs` |
| `/api/supervisor/run` | `runtime/lib/control-plane-server.mjs` |
| `/api/supervisor/stop` | `runtime/lib/control-plane-server.mjs` |
| `/api/task-change-diff` | `runtime/lib/control-plane-server.mjs` |
| `/api/task-changes` | `runtime/lib/control-plane-server.mjs` |
| `/api/task-changes/capture` | `runtime/lib/control-plane-server.mjs` |
| `/api/task-execution` | `runtime/lib/control-plane-server.mjs` |
| `/api/task-impact-children` | `runtime/lib/control-plane-server.mjs` |
| `/api/task-recovery` | `runtime/lib/control-plane-server.mjs` |
| `/api/task-review-state` | `runtime/lib/control-plane-server.mjs` |
| `/api/tasks/provider-route` | `runtime/lib/control-plane-server.mjs` |
| `/api/tasks/repository` | `runtime/lib/control-plane-server.mjs` |
| `/api/tasks/session-budget` | `runtime/lib/control-plane-server.mjs` |
| `/api/test-evidence` | `runtime/lib/control-plane-server.mjs` |
| `/api/usage/refresh` | `runtime/lib/control-plane-server.mjs` |
| `/api/verification-policy` | `runtime/lib/control-plane-server.mjs` |

## Verify behavior

Run `node verification/control_plane_server_test.mjs` and the feature-specific verifier from the [feature map](guides.md). This index does not claim every route was exercised during a documentation refresh.
