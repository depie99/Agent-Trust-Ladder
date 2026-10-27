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
for Windows and Linux. T-022's authorized recovery submitted the actual builder
handoff through the sandboxed client and advanced the task to `in_review`;
its blocker is cleared and its prior session usage is preserved. Independent
review conditionally approved the code integration at content revision
`5009dc2085d1b19aa4be6a1525dce1ba67ce83270ba25d42829091a9402829c0`.
Fresh rendered inspection remains pending because the Chrome connection is
unavailable; that gate has not been certified or replaced with static checks.

Passing these checks establishes the repaired paths. It cannot guarantee that
all future providers, machines or task implementations will never fail.
