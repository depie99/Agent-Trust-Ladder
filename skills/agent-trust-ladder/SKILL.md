---
name: agent-trust-ladder
description: Plan and execute non-trivial software changes with a spec-first, evidence-gated Trust Ladder. Use for agent workflows, autonomous engineering policies, significant features, defects, migrations, and cross-service changes; skip trivial isolated edits.
---

# Agent Trust Ladder

Use this skill to make AI-assisted engineering more trustworthy, not more bureaucratic. Apply controls proportionate to ambiguity, impact, and reversibility.

## Start with scope and context

1. Inspect repository instructions, protected work, architecture, existing specs, ownership, verification, and deployment boundaries.
2. Establish the smallest Context Pack needed to understand the outcome, non-goals, actors, domain terms, constraints, acceptance examples, and decision rights.
3. Mark unknowns as OPEN and uncertain claims as ASSUMPTION. Do not turn either into product behavior without authorization.
4. For behavior-changing work, create or update a bounded task contract before implementation.

Read [the policy reference](references/trust-policy.md) for high-risk, cross-boundary, or autonomy-advancement work.

## Spec-to-evidence loop

1. Specify observable behavior: preconditions, success, alternatives/failures, postconditions, rules, and acceptance examples.
2. Clarify material omissions: identity/authorization, data ownership, concurrency, retries, interfaces, security/privacy, rollout, and rollback.
3. Map approved behavior to the existing architecture and Project Constitution.
4. Split the plan into small, ordered, independently verifiable tasks.
5. Implement the approved slice. For a failure, form a falsifiable hypothesis, then rerun narrow and broader relevant checks.
6. Record what changed, why, impact, observed behavior, checks actually run, gaps, and residual risk.

Plans, checked tasks, broad coverage, and another agent's assertion are not proof.

## Trust levels

- L0: assist; human owns change and verification.
- L1: safe, scoped, reversible implementation and diff inspection.
- L2: repeatable feedback loop with diagnostic repair.
- L3: project-specific behavioral evidence and evidence packet.
- L4: bounded investigation, impact analysis, and regression protection.
- L5: coordinated isolated work with integration evidence.
- L6: bounded repeatable automation with retry/stop/rollback controls.
- L7: selectively autonomous, audited low-risk task classes only.

Never increase a class without evidence that its relevant failures can be detected, reviewed, contained, and recovered from.

## Stop and escalate

Stop when product intent is ambiguous; credentials, production, external spending, or publication needs authority; data loss, security/privacy, or compliance is involved; required verification is unreliable; or retry budgets are exhausted.

Never hide a failure, weaken a meaningful test to get green output, overwrite protected work, or claim a verifier ran when it did not.
