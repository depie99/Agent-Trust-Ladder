# Mode: implement — execute the plan with a self-correcting loop

Goal: implement exactly the approved slice, correcting itself against real evidence. An agent's value is not writing a function; it is tying execution, validation, and repair into one loop.

## When

A plan exists (or the user asked for a bounded fix within the stated dose). If the request drifts from the plan mid-run, that is a spec change — stop and reframe; do not silently absorb it.

## Loop (per task, in order)

1. Do the task within its file scope.
2. Run its verifier. **Observe real output.**
3. Pass → mark `[x]` and record the observed result next to it (a checkmark alone is not a completion state).
4. Fail → diagnose with **new evidence**: read the actual output, reproduce when possible, form a falsifiable hypothesis, apply the smallest repair, rerun the narrow check, then the relevant broader checks.

### Budgets

- Same failure class: max **2** evidence-changing repairs, then stop and report.
- Major repair cycles: max **4** per task list.
- A retry without new evidence, new instrumentation, or a materially different approach is not progress.

### Hard lines

- Never weaken, delete, or skip a meaningful test or assertion to get green. If a check is genuinely wrong, say why and get agreement (Critical dose: always).
- After each task, re-read the actual diff: scope leaks, stray generated files, unintended edits → fix or revert immediately.
- Keep artifacts current as you go — task states, new OPEN items, decisions — not in a final dump.
- Follow repo commit conventions; never commit or push unless authorized.

## Stop and escalate

Stop instead of improvising when: intent is ambiguous or conflicting; authority is missing (credentials, production, spend, publication, irreversible deletion); a required verifier is missing or unreliable; budgets are exhausted; protected work is at risk. Report: facts, evidence so far, the exact decision needed, a recommended safe default, and what can still proceed safely.

End with: per-task states, evidence collected so far, suggested next mode (`verify`).

## Delivery receipt

When implementation reaches a reviewable local result, read `../references/developer-delivery.md` and use the bundled `../scripts/developer-delivery.mjs` helper. Bind required checks and separate review to the exact final content manifest, including relevant dirty and untracked files. A successful worker exit or an imported receipt is not delivery evidence.

Record each finding with a stable ID, severity, affected requirement/path and disposition. Only a passing recheck on the current content revision resolves one; risk acceptance needs an authorized decision with a reason. Write both the JSON receipt and its Markdown rendering (`render <receipt> --output <file>`) into project-local evidence with relative artifact links.

## Bounded overnight batch

When the user asks for a finite unattended batch, read `../references/overnight-batch.md` and drive `../scripts/batch-runner.mjs` one task at a time with concurrency 1. Scope, wall-time and attempt limits are fixed in the checkpoint before any work starts. Record every attempt in the checkpoint, never reset an attempt limit after a restart, and stop dispatching at the deadline. An item that was in flight when the host stopped becomes `needs_reconciliation`: report the unknown external effect instead of replaying it. The host must remain available; the skill does not provide a scheduler, durable compute or an enforced token quota.

Read `../references/project-verifier.md` when the project has an acceptance behavior to reproduce. Use the existing verifier or the bundled `../scripts/project-verifier.mjs`; first observe the genuine failure, then repair the product and rerun the same check plus any independent readback.

## UI implementation gate

When a task changes an interactive surface, source edits and static tests are not sufficient evidence. Reinstall or restart the executable surface, replay the reported input against the running TUI or browser, and verify the visible target identity and route after the event. Keep renderer, hit-test, and regression tests on one geometry/state model. Record any browser or PTY interaction that was not actually replayed as `NOT OBSERVED`.

For the control-plane work, read `.trust/specs/017-agentic-developer-control-plane/feedback-pattern.md` before claiming completion. Its completion rule is binding for the reported route/tab/selection defects.
