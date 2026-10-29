# Overnight reliability evidence ? 2026-10-28

Status: locally verified improvements; unattended overnight acceptance remains open.
Route: ATL bug fix, bounded implementation, verification, documentation sync.
Environment: Windows, local Node runtime; isolated fixture projects, no live paid provider.

## Trust verdict

1. Changed: routine persistence and deduplication, supervisor no-progress continuation and remaining time propagation, failure-aware inline assistant context, CI coverage and operator documentation.
2. Why: prevent lost scheduled records, preview suppression, repeated unchanged launches, and diagnosis without prior recovery evidence.
3. Risks: supervisor defers previously attempted tasks to a later invocation; provider judgment is not mechanically guaranteed; cross-process routine writes remain unserialized.
4. Downstream impact: routine run identity adds cron occurrence, preview and execution deduplicate separately, assistant context has additive fields, dispatcher accepts an optional exclusion set. Existing task gates and approvals remain in force.
5. Objective: the targeted local regressions pass. The overall overnight goal is not yet achieved.
6. Observed boundaries: persisted routine reload, supervisor dispatch through an injected launch function, assistant provider invocation through a stub, real worker-channel subprocesses, isolated queue recovery and delivery fixture. Live installed runtime, actual provider judgment, host reboot and remote CI were not observed.

## Passing checks

- `node verification/routine_test.mjs` ? persisted creations, preview separation, occurrence deduplication, disabled retries, malformed schedule isolation and corrupt-state containment.
- `node verification/supervisor_runner_test.mjs` ? independent progress after failure, no repeated no-progress launch, remaining time allowance.
- `node verification/control_assistant_test.mjs` ? recovery context, budget and invalidated evidence, existing approval and workspace constraints.
- `node verification/dispatcher_test.mjs` ? project fairness and dispatch bounds.
- `node verification/supervisor_test.mjs` ? project isolation and defaults.
- `node verification/overnight_recovery_test.mjs` ? interrupted provider containment and confirmed resume.
- `node verification/worker_channel_launch_test.mjs` ? actual child workers complete scoped lifecycle handoffs.
- `node verification/multi_queue_test.mjs` ? queue isolation, ordering, pause and run lock.
- `node verification/queue_recovery_delivery_test.mjs` ? stale inputs, contract repair, independent task progress, integrated output, restart replay and exhausted/owner-only recovery.
- `git diff --check` ? no whitespace errors in the final diff.

## Open overnight acceptance

Routine records still need an execution contract and dispatch linkage. The supervisor exits when idle. Multi-process state serialization, actual host restart recovery, and three bounded overnight trials (including interruption) remain unproven. No deployment, schedule activation or autonomy advancement occurred. CI was updated but not executed remotely.

Operator documentation: `docs/queue-recovery.md`, synchronized against the working-tree source hashes below. Claims describe local implementation, not an installed release. Rollback: revert only this change's runtime/test/documentation hunks; preserve routine history, task budgets, approvals and unrelated edits.

## Source SHA-256

- `runtime/lib/routines.mjs`: `4b6afeccdc3cf19f6818a99b62d0fa45596196897632cf2d84179667a98b8628`
- `runtime/lib/supervisor-runner.mjs`: `fe198e2cbdc3ff7a3de505fadde227503c8c181fe42bbfe26bce6442b4ef6fdf`
- `runtime/lib/dispatcher.mjs`: `7ae04f6a34f09eeff4447b47672470a62b07dc3e3cb9564fa3cafb84729bf0d7`
- `runtime/lib/control-assistant.mjs`: `1dbcddd1598fdc2abd45afcfdb558158fdbf90e0279f375a04af4153aa55d3ef`
