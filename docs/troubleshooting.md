# Troubleshooting

Preserve the failing operation, exact message, task ID, and revision. Repeating an unchanged launch is not recovery.

## Installation or wrong project

Require Node 22+. Open a new terminal after installation or use the installed shim. Check the directory and `ATL_PROJECT` before initialization or changes. A reused URL may serve a different project; inspect its process and title.

## Issues are missing

Inspect source enablement, base/collection URL, project/repository selection, and the credential surface — a server environment variable (`JIRA_TOKEN`, `AZDO_PAT`), a UI session token, or a remembered (DPAPI) connection credential. A rejected Azure credential is fixed with `atl intake connect azure --token -` (pipe the PAT) or **Issue sources → connection card → Re-authenticate** in the browser. Saving, previewing, and importing are separate steps. Follow [issue sources](issue-sources.md) and [providers](providers.md).

## Plan approval fails

Read unresolved questions, findings, artifact version, source revision, and review binding. Update and review the artifact instead of retrying stale evidence. See [plan contract](plan-studio-contract.md).

## Queue is blocked

Use `atl why T-001` for the actual task. Inspect prerequisites, handoffs, provider readiness, approvals, and allowance. Preserve the blocker and follow [queue recovery](queue-recovery.md).

## Provider stops or quota fails

Inspect error and run state. Confirm a fallback is permitted, ready, and capable. Unknown capacity and missing tokens remain unknown. See [providers](providers.md) and [execution reports](execution-reports.md).

## The Control Plane stops responding or fetches fail

The Control Plane runs as one state-owner daemon per project, recorded in `.atl/daemon.json`. A stale daemon record — for example after a crashed host process — makes client calls fail to fetch. Run `atl daemon status`, then `atl daemon stop`, and reopen with `atl ui`. If a CLI command reports that the writer lease is busy, it names the holding process; run the command again to retry, or stop the daemon first.

## The browser reports owner-session errors after a restart

Every server start rotates the owner session, so a browser tab kept open across a restart receives `403` with an invalid owner session or CSRF token until the page is reloaded. Reload the tab; the session is stored outside the project under `~/.atl/sessions/`.

## Ask ATL does not fix work

Check discussion versus fix mode, approval of the exact request, and workspace access. Contextual conversation alone does not authorize execution or satisfy review. See [Ask ATL](ask-atl.md).

## A task has no useful diff

Inspect its source baseline and output capture. A missing baseline cannot be honestly replaced with arbitrary current HEAD. See [change review](task-change-review.md).

## Search or diagrams fail

Run `npm ci`, `npm run docs:build`, and `npm run docs:check`. Use `npm run docs:serve` instead of `file:`. Inspect browser errors and retain the page and diagram source when reporting a failure.

## Report a reproducible problem

Include expected/actual behavior, minimal synthetic input, command, revision, verifier output, and affected source boundary. Remove credentials and private issue content before sharing.
