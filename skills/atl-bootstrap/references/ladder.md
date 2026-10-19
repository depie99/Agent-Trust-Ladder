# Trust Ladder — levels, gates, and policy

Autonomy is demonstrated capability, not aspiration. A project holds different levels per task class, and levels are earned per class in this repository — they never transfer from another project, model, or prompt.

## Levels

| Level | Delegated capability | Minimum evidence | Explicit limit |
|---|---|---|---|
| L0 Assist | Explain, search, draft, suggest edits | Human inspects every output | No independent change claim |
| L1 Safe implementer | Discover repo, make reversible scoped edits, inspect own diff | Instruction discovery, git safety, successful local review | Human verifies behavior |
| L2 Feedback-loop implementer | Run and respond to relevant tests/static checks | Repeatable commands plus one diagnose-repair-reverify loop | Checks may miss behavior |
| L3 Behavior verifier | Prove accepted behavior project-specifically | Acceptance examples mapped to credible checks; evidence packet | No authority to change intent/policy |
| L4 Bounded investigator | Investigate defects/changes across one bounded context | Reproducible diagnosis, impact analysis, review, regression evidence | No unsafe cross-boundary or production action |
| L5 Coordinated delivery | Coordinate isolated workers on a bounded plan | Ownership, integration evidence, independent review | Shared assumptions are not independent verification |
| L6 Bounded automation | Repeatable low-risk outer loop | Retry/time limits, stop gates, rollback, monitoring, repeated success | No unbounded retries or irreversible actions |
| L7 Selective autonomy | Complete designated low-risk classes under policy | Sustained audited history, reliable verification, rollback evidence, owner approval | Never blanket autonomy |

## Advancement gate

Before raising a task class, answer and record (see `modes/trust.md`):

1. What exact class advances, and what remains excluded?
2. Which failure modes matter and how is each detected?
3. What capability/check was added?
4. Which positive **and negative** cases were observed?
5. How many representative successful runs exist?
6. Can the verifier fail silently or share the implementation's faulty assumption?
7. What is the rollback/containment path, and has it been rehearsed where relevant?
8. Which human approvals remain mandatory?
9. When does this assessment expire or require revalidation?

If evidence is weak, stale, contradictory, or non-representative: **do not advance.**

## Downgrade triggers

Downgrade or pause a task class after: a regression in that class, verifier unreliability, a relevant dependency or architecture change, automation that cannot be verified, or an expired assessment. Record the downgrade in `.trust/ledger.md` with what was observed.

## Conservative starting posture

~~~yaml
task_classes:
  docs_and_examples:     { ceiling: L5, approvals: [review-before-merge] }
  isolated_refactors:    { ceiling: L4, approvals: [review-before-merge] }
  feature_work:          { ceiling: L3, approvals: [approved-spec] }
  migrations:            { ceiling: L2, approvals: [owner, rollback-review] }
  auth_payments_privacy: { ceiling: L2, approvals: [security-review] }
  production_ops:        { ceiling: L1, approvals: [explicit-human-authorization] }
~~~

This template is not a claim about any project. Replace it with evidence-backed local policy during `bootstrap` / `trust`. A repo without running CI or a working verifier cannot hold L3 or above in any class, regardless of history.
