# Recurring task blockers: causes and prevention

Observed 2026-10-27. Audience: maintainers operating task runs. Sources: T-022
worker transcripts and recovery records in `.trust/manager/overnight/T-022/`,
the task feed, the runtime implementation and executable verification suites.

## Why repeated retries failed

The worker could edit its isolated workspace but attempted to persist its
handoff in protected shared manager state and evidence storage. The sandbox
correctly refused that write. Implementation checks could pass while the task
remained `in_progress`. The runner treated the unchanged status as a stalled
worker, retried preparation and spent sessions without changing the missing
write mechanism. A separate credential failure affected direct launches that
had no live lease. Recognizing either error prevents wasted retries but does
not itself deliver a handoff.

The repaired path is: worker writes a scoped request inside its workspace;
manager authenticates the request against its task, role and live lease;
manager invokes the existing gated command; manager saves shared state and
evidence; worker receives the result. Worker sessions receive the local client,
not the manager mutation credential. Evidence packets remain under
`.atl-evidence/`. Direct and queue launches both acquire and release leases.
Credential lifetime covers the bounded worker session.

## Other observed failure chains

| Cause | How it becomes a blocker | Repair and prevention |
| --- | --- | --- |
| Overlapping upstream files | Integration dropped prior queue controls and plan context; reviewing only the small bidi patch missed the loss. | Compare each conflicting predecessor snapshot, restore prior behavior, run consumer regressions, require independent review of the composed output. |
| Hidden integration attempt cap | Two prior attempts could prevent a repaired task from launching despite unused visible task budget. | Use the persistent task session budget and count integration when the worker session starts. Preserve prior usage. |
| Installed API paired with newer project UI | Recovery button requested a route absent from the running installed server and displayed `not found`. | `ui-refresh` imports matching project server and assets together. Running older processes must be restarted with the repaired runtime. |
| Unscoped or stale worker credentials | Direct launches lacked a lease; a worker could not submit its role handoff. | Manager retains scoped credentials, validates lease generation for every command and releases the lease on exit. |
| Incomplete bidi coverage | Helper tests passed while queue log consumers still used plain escaping. | Exercise actual consumers and review dynamic logs, evidence, paths and timestamp cells; retain fresh rendered evidence for the current source revision. |

These are observed failure classes, not a claim that every historical blocker
had the same cause. No retry can manufacture provider access, human approval or
an unavailable browser connection.

## Prevention during every task run

1. Validate prerequisites, workspace and allowed commands before spending a
   worker session. Load the same runtime version for server and UI.
2. Establish a live lease and the workspace-local handoff channel. Keep manager
   state writes in the manager and evidence production in the worker workspace.
3. Reject cross-task, impersonated, expired and stale requests. Do not blindly
   replay an uncertain mutation after a timeout or channel shutdown.
4. Compose overlapping inputs explicitly. Preserve upstream behavior and run
   checks against the composed output, not just an isolated patch.
5. Obtain independent review, rerun completion checks and publish a verified
   handoff for the current content revision. Never clear a gate merely to make
   the UI appear successful.
6. On failure, retain exact output and classify the cause. Retry only after a
   demonstrated repair or changed evidence; retain visible session accounting.

## Executable evidence

- `verification/worker_channel_test.mjs`: real filesystem sandbox denies direct
  shared-state writes while the client completes builder, review and verifier
  transitions; cross-task, actor impersonation, escaped packet paths, expired
  credentials, stale leases and closed channels fail.
- `verification/worker_channel_launch_test.mjs`: actual spawned workers complete
  direct and queue runs through sandboxed clients and release leases.
- `verification/queue_recovery_delivery_test.mjs`: stale workspace, missing
  catalog, overlapping inputs, predecessor preservation and verified delivery.
- `verification/overnight_recovery_test.mjs`: restart boundaries and interruption
  recovery without silently reusing prior confirmation.
- `verification/ui_refresh_runtime_test.mjs`: the CLI loads matching project
  server code instead of pairing newer assets with installed API routes.

The handoff and UI-refresh regressions are included in the runtime CI matrix
for Windows and Linux. T-022's later October 28 recovery is recorded in
[the blocker ledger](../problems/enhancements/t022-ask-atl-recovery.md).
Fresh CSS and real Chrome observations now satisfy its two completion checks
at the current revision. Independent review and final completion remain
pending; the task remains blocked and its session usage is still 12/23.

## Diagnose a worker that exits without advancing

Ask ATL includes the current recovery plan, neighboring contracts, recent
check/review evidence and two bounded, redacted worker-log tails. Each issue
has an owner and next action. Fix mode consumes one remaining task session
and preserves exhausted repair history. Its output still needs independent
review; a successful assistant process does not approve or complete a task.

When a worker records a failed verification or unresolved review and exits
without advancing, the runner records that cause. Generic execution failures
cannot use `prepare-verified-inputs` as proof of repair. The latest valid
evidence for the current packet controls check and review gates, so an older
pass cannot hide a later failure. Pip repair instructions apply only to Pip;
workers cannot impersonate another role to rewrite acceptance ownership.

For task-local rendered evidence, run the current project's helper with the
task workspace as its argument:

```text
node runtime/lib/ui-review-preview.mjs .trust/manager/workspaces/T-022
```

Open its loopback URL using the connected browser. It serves the task's assets
with disposable UTF-8 fixture state under `.atl-evidence/ui-preview`, rejects
mutating HTTP requests, and does not copy live manager state. Inspect the
required surface and record DOM observations and screenshots against the task
revision. Creating the fixture alone does not pass a check, and this preview
does not replace downstream integrated review.

Passing these checks establishes the repaired paths. It cannot guarantee that
all future providers, machines or task implementations will never fail.

Ask ATL now provides task access controls, a project default for all built-in
GapCode/Codex models, and a local sandbox access check that does not use a
task session. See [Ask ATL conversations and workspace access](ask-atl.md)
for the recovery steps, permission scope and observed limits.
