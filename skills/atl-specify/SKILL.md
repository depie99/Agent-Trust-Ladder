---
name: atl-specify
description: Define observable software behavior and acceptance examples before implementation. Use when intent is bounded but behavior still needs an explicit human approval gate.
---

# Trust Ladder: Specify

This is the independently invocable `specify` workflow from Agent Trust Ladder. Run only this workflow for the current invocation.

## Shared contract

- Discover repository instructions, protected work, and real verification commands before acting; never invent a command.
- Preserve the user's scope and authority. Passing evidence cannot approve intent, expand scope, or authorize merge, deploy, publication, spending, production access, or irreversible actions.
- Mark consequential unknowns `OPEN` and unverified claims `ASSUMPTION (source)`; do not silently turn either into behavior.
- Never hide a failure, weaken a meaningful check for green, overwrite unrelated work, or claim a verifier ran when it did not.
- Use bounded loops with explicit stop conditions. Humans own ambiguous intent, risk acceptance, waivers, and irreversible decisions.
- End with the artifact or verdict produced, open items, and the next safe action. Do not silently run the next Trust Ladder workflow.

## Workflow

# Mode: specify — define observable behavior before code

Goal: a spec that two competent readers turn into the same acceptance tests. Detail scales with the dose, not with ego.

## When

A brief exists (or the request is concrete but behavior is not pinned). Direct dose never specifies.

## Steps

1. Reread the brief; skim the real code paths in scope — names, states, current behavior.
2. Write the spec. Standard dose = the spec-lite template below. Critical dose = full practice in [references/spec-core.md](references/spec-core.md).
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
