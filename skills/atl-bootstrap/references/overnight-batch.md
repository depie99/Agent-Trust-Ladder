# Bounded overnight batch

Version 1 is one finite, sequential batch: a fixed task list, concurrency 1, an approved wall-time limit and a per-task attempt limit. Runtime and a skills-only installation use the same checkpoint state machine, so an interrupted batch produces the same outcome on either surface.

This is not a scheduler, durable compute, OS isolation or an enforced token quota. The host machine must stay available for the whole batch. Missing telemetry stays `unknown`, and a spend limit the host cannot enforce is labeled unenforceable.

## Rules

1. Scope is fixed at creation. Adding or reordering tasks mid-batch is a new batch.
2. Concurrency is 1 until atomic admission accounting exists.
3. Attempts are counted per task in the checkpoint, not in a runner process. Restarting never resets the limit.
4. Settled work is never dispatched again, even after a restart.
5. An item left `running` when a runner disappears becomes `needs_reconciliation`. Its external effect is unknown, so it is not replayed until an owner resolves it.
6. At the deadline no new item starts; remaining items become `skipped` with the deadline as the reason.
7. A checkpoint whose hash does not match its content is invalid. It cannot grant completion or erase attempt accounting.
8. A second runner for the same batch is refused while a lease is active.

## Checkpoint

The checkpoint is JSON with `version`, `kind`, `id`, `concurrency: 1`, `limits` (`max_minutes`, `max_attempts`, `max_sessions`), `deadline_at`, a `lease`, one `items` entry per task (`task`, `status`, `attempts`, `reason`, `receipt`) and a `log`. Item statuses are `pending`, `running`, `succeeded`, `failed`, `blocked`, `exhausted`, `interrupted`, `needs_reconciliation` and `skipped`.

## Skills-only runbook

The host agent drives the loop with the bundled helper; there is no daemon and no manager service.

```sh
node scripts/batch-runner.mjs create batch.json --id tonight --tasks T-1,T-2,T-3 --minutes 240 --attempts 2 --sessions 6
node scripts/batch-runner.mjs next batch.json          # prints the next task or a stop reason
node scripts/batch-runner.mjs claim batch.json T-1     # records the attempt before work starts
# ... run the task with the host's own tools ...
node scripts/batch-runner.mjs settle batch.json T-1 succeeded --reason "verified locally"
node scripts/batch-runner.mjs reconcile batch.json     # after any restart with an in-flight item
node scripts/batch-runner.mjs summary batch.json       # morning summary; exits 0 only when complete
```

Attach the matching `developer-delivery` receipt for each succeeded task and keep the batch checkpoint next to the project evidence. The summary lists every task, its terminal status, attempt count, receipt verdict and the smallest remaining human decision.

## Runtime adaptation

The Control Plane adapts the same helper: it records readiness before dispatch, reuses the existing launch and recovery paths one task at a time, stops at the deadline, reconciles before resuming, and writes a morning summary that links the receipt for every succeeded task. Existing queued work is preserved when a batch is created or stopped.
