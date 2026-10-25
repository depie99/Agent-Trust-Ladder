# Plan — Plan-owned queues and multi-plan overnight execution

## Summary

Turn each approved Plan Studio draft into its own named Plan Queue. The plan’s implementation steps become ordered ATL tasks in that queue; creation is deterministic and local, then execution remains previewed, budgeted, and explicitly confirmed.

## Key changes

- Extend plan approval so one approved draft:
  - creates a queue named from the plan title, with durable `plan_draft_id` metadata;
  - creates one ordered task per implementation step, linked to the same plan and step index;
  - adds all created tasks to that Plan Queue atomically;
  - remains idempotent: re-approving the same draft returns the existing queue/tasks without duplicates.
- Keep `Unqueued` as intake/manual backlog and `Default` for generic manual work; neither is treated as a Plan Queue.
- Update Plan Studio preview to show the generated task breakdown and the target queue before approval. Replace “Approve and create task” with approval language that accurately describes queue-and-task creation.
- Upgrade the Queues page into a Plan Queue portfolio:
  - show queue title, plan link, task count, runnable/blocked/done counts, budget, and latest activity;
  - open a queue detail view with its ordered tasks, task statuses, blockers, evidence, and plan summary;
  - preserve generic queues and archived queues distinctly from Plan Queues.
- Add multi-queue dispatch selection:
  - allow one queue, selected queues, or all runnable Plan Queues;
  - preview the exact selected queues, task order, providers, blockers, shared budget, and no-side-effect guarantee;
  - execute sequentially with global concurrency `1`, using round-robin selection across selected queues.
- During a multi-queue overnight run, a blocker or approval gate pauses/skips that queue for the run, records the reason, and continues with other selected queues. It never bypasses a gate, retries unchanged, merges, pushes, deploys, or sends external messages.
- Keep every run behind explicit confirmation. Multi-queue execution uses one visible shared time/session budget; reaching it stops the whole run and writes final per-queue results.

## Interfaces and persistence

- Add plan-queue metadata to queue records: source plan draft ID, display title, creation time, and archived state.
- Add plan-task metadata to generated tasks: plan draft ID, plan queue ID, implementation-step index, and dependency/order information.
- Extend `plan approve` and its control-plane response to return the canonical queue plus all generated task IDs.
- Add queue inspection/selection support for plan queues and multi-queue dry-run/confirm requests while preserving existing single-queue CLI behavior.

## Test plan

- Add failing tests first for:
  - approval of a multi-step plan creating one queue and ordered tasks;
  - repeated approval producing no duplicate tasks or queue;
  - a plan queue surviving reload and exposing task status/blocker detail;
  - manual/default queues remaining unaffected.
- Cover multi-queue preview and confirmed execution:
  - one queue, selected queues, and all runnable plan queues;
  - deterministic round-robin order;
  - one blocked queue skipped while another eligible queue continues;
  - shared session/time budget stopping the run with truthful evidence.
- Extend browser control-plane tests for Plan Studio approval, Queue detail visibility, multi-select preview, and confirmation gating.
- Run: `node verification/plan_studio_test.mjs`, `node verification/multi_queue_test.mjs`, `node verification/run_control_plane_test.mjs`, `node verification/control_plane_server_test.mjs`, and the relevant launch/queue regression suites.

## Assumptions

- “هر step یک Task” is the approved decomposition rule for v1.
- Approved plans are automatically queued but never automatically executed.
- Multi-queue runs use round-robin order, global concurrency `1`, and a shared explicit budget.
- A blocked queue is skipped for the current multi-queue run; its blocked state remains visible for manager recovery.
