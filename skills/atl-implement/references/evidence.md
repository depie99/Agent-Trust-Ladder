# Evidence — verification, packets, and delivery gates

Generated tests are hypotheses until run. Coverage signals exercised code; it is not proof of complete specified behavior. Plans, checked task boxes, and another agent's assertion are not proof.

## Verification layers

| Layer | Evidence |
|---|---|
| Specification | Review decision, consistency/traceability check, acceptance examples |
| Static | Formatting, lint, typecheck, policy/schema analysis |
| Unit | Invariant, branch, and transformation tests |
| Integration | Database, queue, service, auth, contract tests |
| End-to-end | Real user journey with observable assertions |
| Non-functional | Accessibility, security, performance, resilience, localization |
| Operations | Migration rehearsal, observability, rollback, feature-flag behavior |

Select the smallest credible set that covers the changed risks (`modes/verify.md`). For Critical work, all layers with material exposure are required or explicitly waived by an authorized owner.

## Evidence packet (Critical dose)

~~~markdown
# EV-<NNN>
- Task/spec IDs: TC-..., UC-..., FR-..., NFR-..., C-...
- Scope and commit/diff reviewed:
- Environment and fixture/data version:
- Checks executed: command, date, result, relevant output:
- Acceptance examples observed:
- Independent review: reviewer / method / findings:
- Known gaps, waived checks, and approver:
- Rollback/containment status:
- Trust impact: no change | proposed advancement | regression
~~~

Never state a check passed unless it ran in the stated environment. Report skipped or unavailable checks separately from passing checks.

## PR / delivery readiness

A change is ready for review only when applicable gates are satisfied:

- Brief/spec current; required intent approvals recorded.
- Acceptance and risk cases have credible evidence.
- Relevant static, unit, integration, E2E, and non-functional checks ran — or were explicitly waived by an authorized owner.
- Migrations, compatibility, observability, rollout, and rollback were considered.
- The actual diff/status/generated files were reviewed for scope and unrelated work.
- Independent review occurred where risk, novelty, or policy requires it.
- Evidence states results, gaps, residual risk, and next action truthfully.

PR-ready is not permission to merge, deploy, publish, contact third parties, or alter production.

## Completion report (Standard and Critical)

~~~markdown
# Execution Report — <NNN> <slug>
## Objective and task class
## Context / source-of-truth decisions
## Specs and contracts changed
## Assumptions, OPEN items, approvals
## Implementation scope (actual diff)
## Verification and observed results
## Repair history (what failed, how diagnosed)
## Evidence packet / verdict
## Residual risk and waivers
## Trust level before → after (if changed)
## Next safe action
~~~

## Definition of done

~~~text
understood intent
+ current specification or a justified exception
+ bounded implementation
+ relevant deterministic verification
+ observed acceptance behavior
+ appropriate review
+ captured evidence and disclosed residual risk
= earned trust
~~~

The environment creates trust by making failure observable, recoverable, and reviewable. The agent earns only the autonomy that this evidence supports.
