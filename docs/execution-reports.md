# Execution & resources report

## Inspect a report

1. Open a task or queue and inspect **Execution & resources** and its session history.
2. Read provider/model, stage, allowance, retry, and quota-switch records together.
3. Compare token totals with session coverage; unknown usage is not zero.
4. Inspect current checks and independent review before reusing the result as calibration evidence.
5. For overlapping queues, inspect distinct task membership rather than summing totals as project usage.

Expected result: an observed account of configured execution and reported usage. For missing telemetry, retain the unknown/partial label and inspect the source transcript; do not invent a token or billing estimate.

Task rows and queue cards display reported token totals with session coverage.
Task details and queue details include stages, configured provider/model pairs,
session history, model switches and budget history. These are lifetime task
totals through the current stage, including repair and review retries.
Quota failures and automatic provider/model replacements are retained in the
same session timeline and quota failover history. Their consumed sessions and
reported tokens remain in totals even when a backup finishes the task.

The execution ledger at `.trust/manager/execution-ledger.jsonl` records a stable
session id at start and an updated record at exit. The latest record for that
id wins: start, completion and repeated ingestion cannot double-count a session.
Provider/model fields describe the actual launch configuration; a provider's
internal routing or undisclosed model substitution cannot be inferred.

Token collection accepts recognized CLI summaries and structured turn/result
usage events. Structured turn events are summed within a process; cached input
is included in input, not added a second time to the total. A plain `tokens used`
summary supplies only the reported total. Unsupported or missing usage remains
null. The UI shows partial totals and the number of sessions with unknown usage;
an active or interrupted session without final telemetry is not zero tokens.
These are CLI-reported observations, not provider billing verification. No
price, token estimate, remote quota or model capability is guessed.

Existing overnight session summaries are read without changing task state.
Where no stored token field exists, the final 256 KiB of the transcript is
inspected for a CLI usage summary. Old records cannot reliably reconstruct
individual multi-turn structured events, missing sessions or missing budget
decisions. They remain visibly partial. Raw prompts and transcripts are not
copied into the execution ledger or learning memory.

A queue report sums the lifetime reports of its distinct current member tasks.
It also includes shared model planning, regeneration and plan review sessions
matched by draft id, once per queue. Shared planning is not arbitrarily charged
to each task. Queues with overlapping task membership are separate views;
adding their totals together is not a project-wide spending total.

## Project memory and adaptation

After a worker session, an immutable source snapshot of the task and its queue
reports is archived in the existing project brain. Evidence-linked claims make
the observations available in Knowledge. Planning sessions publish their own
source snapshots. Repeated ingestion of an unchanged report is idempotent.

The bounded learning memory is `.trust/manager/resource-learning.json`.
Only done tasks with a current, non-invalidated independent review and an
observed successful Beacon completion enter the calibration cohort. Failed or
timed-out sessions do not become success samples. Samples retain the task,
packet revision, complexity, risk, observed session count, review rejection
count and immutable source revision. Legacy records without a recorded effort
classification remain reportable but do not train resource decisions.

For the same observed complexity and risk, at least three other completed tasks
are required to replace the default initial estimate with the observed 75th
percentile session count (minimum three sessions). Two completed tasks that
required review repairs raise the required model tier by one. Both effects are
shown in decision reasons. History is bounded to the latest thirty comparable
tasks, from a retained set of five hundred. A task cannot train its own retry.

This updates runtime estimates and selection rules through project evidence;
it does not retrain model weights or rewrite ATL source code. Model allowlists,
owner-controlled budgets, explicit run caps, workspace/browser permissions and
independent verification gates still apply. Disabling automatic resources
disables use of the calibration. Removing the resource-learning file resets
calibration while preserving the original execution ledger and brain sources.

Checks: `node verification/execution_report_test.mjs`,
`node verification/resource_policy_launch_test.mjs`,
`node verification/execution_report_ui_test.mjs`.
