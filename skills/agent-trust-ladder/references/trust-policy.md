# Trust Ladder Policy Reference

## Project Constitution

Maintain concise version-controlled rules for architecture boundaries, data origin/validation/retention/recovery, identity and authorization, error/retry/logging/monitoring/rollback, and delivery/quality/compatibility/migration. Compare material plans against it; record justified exceptions as decisions.

## Minimum artifacts

| Artifact | Content |
|---|---|
| Context Pack | Outcome, non-goals, actors, domain terms, constraints, evidence, decision rights |
| Requirement | Atomic statement, owner/source, priority, measurable boundary |
| Domain model | Meaning, lifecycle, identity, relationships, invariants |
| Use case | Actor, goal, preconditions, observable main/alternative/failure flows, postconditions, examples |
| Task contract | Scope, linked specs, assumptions, plan, verification, rollback, approvals |
| Evidence packet | Scope, environment, checks run, observations, review, gaps/waivers, residual risk |

## Advancement gate

Before raising autonomy for a task class, record:

1. The exact class advancing and exclusions.
2. Relevant failure modes and how they are detected.
3. New capability/check and observed positive and negative cases.
4. Representative successful-run history.
5. Verifier blind spots and shared assumptions.
6. Rollback/containment path and rehearsal status.
7. Continuing human approvals and revalidation condition.

Weak, stale, contradictory, or non-representative evidence means no advancement.

## Delivery gate

Before review, confirm affected specs are current; approvals and acceptance evidence exist; required checks ran or were formally waived; migration, compatibility, observability, rollout, and rollback were considered; actual diffs were inspected; independent review occurred when warranted; and residual risk is visible.
