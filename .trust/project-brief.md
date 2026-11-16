# ATL project brief
Updated: 2026-11-15. Source: local checkout `7f5defc`, including uncommitted files.

## Map
- Node 22 ESM package; CLI entry: `runtime/atl-manager.mjs`; HTTP API: `runtime/lib/control-plane-server.mjs`.
- Plan Studio drafts and reviews: `runtime/lib/plan-studio.mjs`; task state: `runtime/lib/state.mjs`; queue book: `runtime/lib/queue.mjs`.
- Execution: `runtime/lib/launch.mjs` and `runtime/lib/worker.mjs`; provider selection: `runtime/lib/providers.mjs`.
- Routine records: `runtime/lib/routines.mjs`; browser Control Plane and docs are separate surfaces.
- Manager data lives under `.trust/manager`; provider CLIs and GitHub are external boundaries.

## Commands and verification
- Package scripts include `npm run ui:css:check`, `npm run plugins:test`, `npm run docs:check`, and `npm run skills:check`.
- `.github/workflows/runtime-verify.yml` runs Node verification scripts on a platform matrix.
- Locally observed passing: `node verification/plan_studio_test.mjs`, `node verification/routine_test.mjs`, `node verification/approval_test.mjs`.
- Full CI and live provider/GitHub behavior were not run in this audit.

## Standing boundaries
- Plan review fingerprint must remain fresh at approval (`plan-studio.mjs`); approval creates plan tasks and a queue, not an automatic worker run.
- State and queue are separate JSON stores with atomic file replacement; cross-store transaction or outbox is not demonstrated.
- Routine scheduler persists queued run records with idempotency keys; `routines.mjs` does not launch a worker.
- Worker launch has provider preflight, timeout, lease and local usage recording; remote remaining quota is explicitly unknown in `launch.mjs`.
- Exact action approvals are tested as revision-bound and single-use; merge authority remains human-owned.

## Risk register
- Working tree contains extensive pre-existing tracked and untracked changes. Preserve it; do not reset or broadly stage.
- The local branch is two commits behind `origin/main`; this audit describes the local checkout, not current remote behavior.
- Separate state/queue/routine files may diverge on interruption; recovery must be demonstrated before unattended dispatch.
- Any draft PR or merge workflow crosses an external service boundary and needs current-commit evidence.

## OPEN
- Owner and approval policy for this implementation package.
- Whether the two remote commits or current uncommitted work change these findings.
- Live provider capabilities, remote quota and GitHub permissions.
