---
name: atl-trust
description: Assess or change how much autonomy an engineering agent has earned for a specific task class using recorded project evidence.
---

# Trust Ladder: Trust

This is the independently invocable `trust` workflow from Agent Trust Ladder. Run only this workflow for the current invocation.

## Shared contract

- Discover repository instructions, protected work, and real verification commands before acting; never invent a command.
- Preserve the user's scope and authority. Passing evidence cannot approve intent, expand scope, or authorize merge, deploy, publication, spending, production access, or irreversible actions.
- Mark consequential unknowns `OPEN` and unverified claims `ASSUMPTION (source)`; do not silently turn either into behavior.
- Never hide a failure, weaken a meaningful check for green, overwrite unrelated work, or claim a verifier ran when it did not.
- Use bounded loops with explicit stop conditions. Humans own ambiguous intent, risk acceptance, waivers, and irreversible decisions.
- Spend context deliberately: read metadata first, then only this mode and its relevant references; do not repeat unchanged evidence or load unrelated skills.
- End with the artifact or verdict produced, open items, and the next safe action. Do not silently run the next Trust Ladder workflow.

## Workflow

# Mode: trust — decide what the agent may do autonomously next

Goal: autonomy is **evidence about a task class in this project** — never a property of the model, the prompt, or a good streak. Full ladder and level definitions: [references/ladder.md](references/ladder.md).

## When

After a successful verify loop, after a failure or regression, on a schedule (evidence ages), or whenever the user asks "can it do more on its own?"

## Steps

1. **Read current policy** (`.trust/trust-policy.md`, or bootstrap defaults). Autonomy is per task class: docs, refactors, features, migrations, auth/payments, production ops all advance **independently**.
2. **Run the advancement gate** — all nine, recorded in the ledger:
   1. Exactly which class advances, and what stays excluded?
   2. Which failure modes matter for it, and what detects each one?
   3. What capability or check was added since the last assessment?
   4. Which positive **and negative** cases were observed?
   5. How many representative successful runs exist?
   6. Can the verifier fail silently, or share the implementation's faulty assumption?
   7. What is the rollback/containment path — rehearsed where relevant?
   8. Which human approvals remain mandatory?
   9. When does this assessment expire?
3. **Weak, stale, contradictory, or unrepresentative evidence → do not advance.** Downgrade after: a regression, verifier unreliability, a dependency or architecture change, unverifiable automation.
4. **Update `.trust/trust-policy.md`** and append to `.trust/ledger.md`. Never advance autonomy silently inside another mode — it happens only here, explicitly.

## Policy template (conservative starting posture)

~~~yaml
task_classes:
  docs_and_examples:     { ceiling: L5, approvals: [review-before-merge] }
  isolated_refactors:    { ceiling: L4, approvals: [review-before-merge] }
  feature_work:          { ceiling: L3, approvals: [approved-spec] }
  migrations:            { ceiling: L2, approvals: [owner, rollback-review] }
  auth_payments_privacy: { ceiling: L2, approvals: [security-review] }
  production_ops:        { ceiling: L1, approvals: [explicit-human-authorization] }
# Replace with evidence-backed local values. This is a starting posture, not a claim.
~~~

End with: policy changes, ledger entry, and the next defensible capability to build evidence for.
