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
