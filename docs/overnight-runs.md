# Overnight runs

An overnight run executes approved work within session, concurrency, and time limits. It needs a running machine, a ready provider, and execution authority. It cannot guarantee an error-free delivery from an arbitrary description.

## Prepare and launch

1. Complete task contracts and reviewed plans, including prerequisite handoffs.
2. Select the queue and inspect resource policy and provider readiness.
3. Preview and read every blocker, model selection, and allowance.
4. Confirm the intended bounded run and watch its first session.

```sh
atl launch --dry-run
atl launch --confirm --max-minutes 120 --max-sessions 8
```

These are example limits, not a promise of eight successful tasks. Other gates can constrain execution. See [resource policy](resource-policy.md).

## Monitor, stop, and recover

Follow **Queues**, **Activity & Logs**, and **Usage & Limits**. Use the exposed stop operation and inspect resulting state. Reconcile an existing run after a restart before launching again. Preserve failed commands, output, revisions, and blockers. Apply bounded repairs and rerun checks; do not reset counters to evade limits. See [queue recovery](queue-recovery.md) and [reliability](task-run-reliability.md).

## Assess delivery

Inspect each task’s current-revision checks, independent review, diagnostics, captured changes, and delivery record. Verify prerequisite artifacts were consumed. Missing usage remains unknown.

Task completion, a local delivery branch, a draft PR, a merged PR, and production deployment are distinct outcomes. Record the actual boundary reached. Remote actions need the corresponding permission and checks.

## Reproduce the offline exercise

Run `node verification/run_mock_regression.mjs` from the ATL clone. It records per-test evidence and aggregate results under `.atl-evidence/mock-regression/`. The [recorded run](mock-system-e2e-2026-10-29.md) separates failures, accomplishments, and lessons. Fixture workers establish orchestration behavior; they do not prove real model quality or production delivery.
