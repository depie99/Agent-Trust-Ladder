# Local API reference

This route index is extracted from literal API paths in `runtime/lib/control-plane-server.mjs`. It is a source-navigation aid, not a versioned OpenAPI schema. Parameterized/constructed routes may require following their handler.

## How to inspect a request

Use the Control Plane's supported operation and inspect its browser request and source handler. Check the handler's HTTP method, payload validation, owner-session requirements, and response before writing a client. Do not infer an allowed method from a path name.

## Owner-session boundary

The browser server binds to loopback by default. Browser-origin mutations use same-origin and owner-session/CSRF checks. Origin-less command-line requests remain supported by the outer guard; inspect each route rather than assuming universal session authentication. Some sensitive read operations, including change review, also require the owner cookie and `x-atl-csrf` header. A copied URL alone is insufficient authority. The browser client demonstrates the supported request flow.

Read `runtime/lib/session-auth.mjs`, route guards in `control-plane-server.mjs`, and `verification/owner_session_approval_test.mjs` before integrating. Keep tokens out of logs and URLs.

## Literal route index

| Path | Source |
|---|---|
| `/api/approvals` | `runtime/lib/control-plane-server.mjs` |
| `/api/assistant` | `runtime/lib/control-plane-server.mjs` |
| `/api/backups` | `runtime/lib/control-plane-server.mjs` |
| `/api/backups/preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/brain` | `runtime/lib/control-plane-server.mjs` |
| `/api/browser-access` | `runtime/lib/control-plane-server.mjs` |
| `/api/command` | `runtime/lib/control-plane-server.mjs` |
| `/api/delivery` | `runtime/lib/control-plane-server.mjs` |
| `/api/dispatch/preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/events` | `runtime/lib/control-plane-server.mjs` |
| `/api/execution-access` | `runtime/lib/control-plane-server.mjs` |
| `/api/health` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/import` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/intake/sources` | `runtime/lib/control-plane-server.mjs` |
| `/api/navigation` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/approve` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/card` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/clarify` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/generate` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/local` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/publish` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/publish-preview` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/regenerate` | `runtime/lib/control-plane-server.mjs` |
| `/api/plan/review` | `runtime/lib/control-plane-server.mjs` |
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
| `/api/task-recovery` | `runtime/lib/control-plane-server.mjs` |
| `/api/tasks/provider-route` | `runtime/lib/control-plane-server.mjs` |
| `/api/tasks/session-budget` | `runtime/lib/control-plane-server.mjs` |
| `/api/usage/refresh` | `runtime/lib/control-plane-server.mjs` |

## Verify behavior

Run `node verification/control_plane_server_test.mjs` and the feature-specific verifier from the [feature map](guides.md). This index does not claim every route was exercised during a documentation refresh.
