# Mode: specify — define observable behavior before code

Goal: a spec that two competent readers turn into the same acceptance tests. Detail scales with the dose, not with ego.

## When

A brief exists (or the request is concrete but behavior is not pinned). Direct dose never specifies.

## Steps

1. Reread the brief; skim the real code paths in scope — names, states, current behavior.
2. Write the spec. Standard dose = the spec-lite template below. Critical dose = full practice in [references/spec-core.md](../references/spec-core.md).
3. **Spec-writing rules** (both doses):
   - One normative rule per statement. Define vague words (fast, valid, large, secure) by threshold, boundary, or source.
   - Number the main flow; alternatives and failures cite the step where they diverge.
   - Include when relevant: empty states, authorization, duplicate submission/retry/idempotency, concurrency, migration, rollback.
   - Observable behavior, not implementation: actors, inputs, state changes, outputs, errors, timing.
   - Separate fact / decision / OPEN / ASSUMPTION. Never bury a business rule inside an implementation task.
4. **Self-check before showing** (six passes, borrowed from spec-kit's analyze):
   duplication · ambiguity · underspecification · constitution conflicts (**always critical**) · coverage (every brief outcome has a spec answer) · terminology drift.
5. **Intent gate:** show the spec and ask for explicit human confirmation of intent ("approved" or "change X"). A well-formatted spec is not an approved spec.

## Output template (spec-lite, Standard dose)

~~~markdown
# Spec — <NNN> <slug>
From: brief.md · Status: draft | approved (by <who>, <date>)
## Behavior
1. <main flow, numbered>
   - 2a. <alternative/failure at step 2>
   - 3a. <alternative/failure at step 3>
## Rules (normative)
## Acceptance examples
| Given | When | Then |
|---|---|---|
## Out of scope
## OPEN / ASSUMPTION
~~~

End with: spec path and status; suggested next mode (`plan`).
