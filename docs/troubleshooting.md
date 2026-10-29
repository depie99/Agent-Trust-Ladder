# Troubleshooting

Preserve the failing operation, exact message, task ID, and revision. Repeating an unchanged launch is not recovery.

## Installation or wrong project

Require Node 22+. Open a new terminal after installation or use the installed shim. Check the directory and `ATL_PROJECT` before initialization or changes. A reused URL may serve a different project; inspect its process and title.

## Issues are missing

Inspect source enablement, base/collection URL, project/repository selection, and authentication in the server environment. Saving, previewing, and importing are separate steps. Follow [issue sources](issue-sources.md).

## Plan approval fails

Read unresolved questions, findings, artifact version, source revision, and review binding. Update and review the artifact instead of retrying stale evidence. See [plan contract](plan-studio-contract.md).

## Queue is blocked

Use `atl why T-001` for the actual task. Inspect prerequisites, handoffs, provider readiness, approvals, and allowance. Preserve the blocker and follow [queue recovery](queue-recovery.md).

## Provider stops or quota fails

Inspect error and run state. Confirm a fallback is permitted, ready, and capable. Unknown capacity and missing tokens remain unknown. See [providers](providers.md) and [execution reports](execution-reports.md).

## Ask ATL does not fix work

Check discussion versus fix mode, approval of the exact request, and workspace access. Contextual conversation alone does not authorize execution or satisfy review. See [Ask ATL](ask-atl.md).

## A task has no useful diff

Inspect its source baseline and output capture. A missing baseline cannot be honestly replaced with arbitrary current HEAD. See [change review](task-change-review.md).

## Search or diagrams fail

Run `npm ci`, `npm run docs:build`, and `npm run docs:check`. Use `npm run docs:serve` instead of `file:`. Inspect browser errors and retain the page and diagram source when reporting a failure.

## Report a reproducible problem

Include expected/actual behavior, minimal synthetic input, command, revision, verifier output, and affected source boundary. Remove credentials and private issue content before sharing.
