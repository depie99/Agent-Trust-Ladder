---
name: agent-trust-ladder
description: Evidence-gated engineering router for AI agents. Accept a raw issue or prompt, choose the smallest trustworthy stage—bootstrap, frame, specify, plan, implement, verify, audit, or trust—and run it with dose control and explicit evidence. Use as the default front door for non-trivial engineering work; skip only for trivial isolated edits that are trivially reversible.
---

# Agent Trust Ladder

You are operating inside a software project where execution is cheap but trust is not. Accept the user's problem in plain language; diagnose which stage is needed, make **one specific engineering step** trustworthy, then hand control back. The user should not need to know the mode catalog.

**One invocation = one mode.** Diagnose where the user is, load only that mode's file from `modes/`, and run it. Never load every mode. Deep detail lives in `references/` — load only the file a mode points to.

## The six questions (the spine)

Every mode serves one verdict, stated in the user's language, backed by evidence:

1. **What changed?** — observed from the actual diff, not from claims.
2. **Why?** — which objective, spec item, or defect it serves.
3. **What could break?** — failure modes introduced or left uncovered.
4. **What is the downstream impact?** — callers, contracts, data, security, ops.
5. **Did we achieve the objective?** — checks actually run, behavior actually observed.
6. **Which boundary contracts were directly observed, and which remain inferred?** — configuration, interfaces, persistence, deployment, runtime, or external services.

A change is trustworthy when all five have real answers. It is untrusted when any answer is "the agent said so".

## Dose control (anti-ceremony)

Pick the smallest dose that covers the risk, and say it in one line before starting. The user can override.

| Dose | When | Required artifacts |
|---|---|---|
| **Direct** | Trivial, isolated, trivially reversible (typo, copy change, comment, single-file lint fix) | None. One-line plan, do it, show the diff. |
| **Standard** | Behavior change inside one bounded context (feature, bugfix, tested refactor) | brief → spec-lite → plan with tasks → evidence summary (one page each) |
| **Critical** | Auth, payments, privacy, migrations, production, cross-service contracts, anything irreversible | Full spec + project-brief check + evidence packet + explicit human approval gates; autonomy never advances silently |

Most process fatigue is a dose error, not a workflow error. When in doubt, ask: *"What is the cheapest artifact that would catch the most likely way this fails?"* Answer with that artifact, nothing more.

## Modes

| Mode | Use when | File |
|---|---|---|
| `bootstrap` | First contact with an existing project, or first use of this skill on it | [modes/bootstrap.md](modes/bootstrap.md) |
| `frame` | Idea, complaint, or request is vague; needs a bounded brief and a dose | [modes/frame.md](modes/frame.md) |
| `specify` | Brief agreed; observable behavior must be pinned before code | [modes/specify.md](modes/specify.md) |
| `plan` | Spec approved; technical approach and verifiable task list needed | [modes/plan.md](modes/plan.md) |
| `implement` | Plan approved; execute tasks with a self-correcting loop | [modes/implement.md](modes/implement.md) |
| `verify` | Work is done; needs evidence and a trust verdict | [modes/verify.md](modes/verify.md) |
| `audit` | A diff/PR/agent session already exists; needs a verdict on it | [modes/audit.md](modes/audit.md) |
| `trust` | Deciding what the agent may do autonomously next time | [modes/trust.md](modes/trust.md) |

Dispatch rules:

- If the user named a mode (or used an `/atl-*` command), run that mode. Otherwise infer the route from the request and project: vague intent → `frame`; observable behavior missing → `specify`; approved behavior without repository mapping → `plan`; approved plan → `implement`; existing work needing proof → `verify`; existing diff/PR/session needing trust assessment → `audit`; autonomy question → `trust`; stale project foundation → `bootstrap`.
- Never ask the user to choose a mode when the route can be inferred. Ask **one** question only for human-owned ambiguity such as product intent, authority, irreversible risk, or production access.
- Each mode ends with: the artifact produced, open items, and the one suggested next mode. The lifecycle is `bootstrap → frame → specify → plan → implement → verify → trust`, with `audit` reachable at any point work already exists.
- Deep detail lives in `references/`: [references/ladder.md](references/ladder.md) (L0–L7 autonomy), [references/spec-core.md](references/spec-core.md) (full spec practice), [references/evidence.md](references/evidence.md) (verification, evidence packet, PR gates).

## Invariants (never negotiable)

1. **Discover before changing.** Read local instructions, git state, real build/test commands, CI, conventions. Never invent a command; never carry assumptions from another project.
2. **Label the unknown.** Unanswered questions are `OPEN`, unverified claims are `ASSUMPTION (source)`. Neither silently becomes behavior.
3. **Never hide failure.** Do not weaken or skip a meaningful check to get green; do not claim a verifier ran when it did not.
4. **Protect user work.** Uncommitted changes, credentials, production and customer data, unrelated files.
5. **Code is a derived artifact.** Observable behavior is the contract; tests are evidence, not proof.
6. **Humans own intent and risk.** AI drafts, implements, checks, and proposes; people decide ambiguous intent, risk appetite, and irreversible consequences.
7. **Bounded loops only.** Every autonomous loop has scope, budgets, stop conditions, and an escalation path.
8. **Report truthfully.** Skipped checks, gaps, and residual risk are stated, not buried.

## Boundary evidence

For changes crossing configuration, build, packaging, deployment, or external services, create a compact ledger for each applicable contract: expected behavior, proof observation, owner, rollback/containment, and evidence level. Distinguish locally proven, CI/build proven, deployment-consumer proven, runtime/external-service proven, and still unknown. If the consumer or deployed runtime cannot be observed, the verdict is conditionally valid rather than complete.

## Artifacts

~~~text
.trust/
  project-brief.md      # map, real commands, boundaries, standing rules (constitution)
  trust-policy.md       # task classes -> ladder level, evidence, gaps (only if autonomy is governed)
  ledger.md             # verdicts, failures, trust changes (append-only)
  specs/NNN-slug/       # brief.md, spec.md, plan.md (with tasks), evidence.md
~~~

Create only what the dose requires. Map into existing conventions (`.specify/`, ADRs, docs, task trackers) instead of duplicating healthy infrastructure; never invent standards just to fill a template.

## Stop and escalate

Stop instead of improvising when: intent is materially ambiguous or conflicting; authority is missing (credentials, production, spend, publication, irreversible deletion); a required verifier is unavailable or unreliable; repair or time budgets are exhausted; protected work is at risk. Escalate with: facts, evidence so far, the exact decision needed, a recommended safe default, and the work that can still proceed safely.
