---
name: atl-plan
description: Map an approved software specification onto the real codebase as an impact-aware, independently verifiable implementation plan.
---

# Trust Ladder: Plan

This is the independently invocable `plan` workflow from Agent Trust Ladder. Run only this workflow for the current invocation.

## Shared contract

- Discover repository instructions, protected work, and real verification commands before acting; never invent a command.
- Preserve the user's scope and authority. Passing evidence cannot approve intent, expand scope, or authorize merge, deploy, publication, spending, production access, or irreversible actions.
- Mark consequential unknowns `OPEN` and unverified claims `ASSUMPTION (source)`; do not silently turn either into behavior.
- Never hide a failure, weaken a meaningful check for green, overwrite unrelated work, or claim a verifier ran when it did not.
- Use bounded loops with explicit stop conditions. Humans own ambiguous intent, risk acceptance, waivers, and irreversible decisions.
- Spend context deliberately: read metadata first, then only this mode and its relevant references; do not repeat unchanged evidence or load unrelated skills.
- End with the artifact or verdict produced, open items, and the next safe action. Do not silently run the next Trust Ladder workflow.

## Workflow

# Mode: plan — map approved behavior onto this codebase

Goal: a technical plan and task list in which every task is executable and independently verifiable — each specific enough that an agent could do it without extra context.

## When

The spec is approved. If the spec status is not approved, go back (Critical dose: this is a hard stop).

## Steps

1. **Discover impact by reading code, not guessing:** callers of touched interfaces, data model, config, dependencies, contracts, monitoring. List files expected to change *and* files at risk of breaking without being changed.
2. **Constitution check:** compare the approach with the project brief's standing rules. A conflict needs either a different approach or a recorded exception (Critical: an ADR).
3. **Pre-mortem — the plan's most valuable lines.** For the three most likely failure modes: how each would be *detected*, and the *rollback*.
4. **Decide technical choices** as one short block each: Decision / Rationale / Alternatives considered. No research essays.
5. **Break into tasks.** Each task has: a single outcome, prerequisites, expected files, **the exact verifier command**, and a definition of done that means *verified*, not merely edited. Order for early feedback: foundation → one behavior per acceptance example → polish. Where feasible put the failing test first (Critical dose: mandatory for behavior tasks).
6. **Write `plan.md`:**

~~~markdown
# Plan — <NNN> <slug>
Spec: approved <date> · Dose: Standard
## Approach (≤10 lines) and key decisions (Decision / Rationale / Alternatives)
## Impact
<files to change; breakage risk; data/migrations; contracts; rollout/rollback>
## Pre-mortem
<failure mode → detection → rollback>
## Constitution compliance (or recorded exceptions)
## Tasks
- [ ] T1 <single outcome> — files: ... — verify: `<command>` — done when: <observed result>
- [ ] T2 ...
## Verification plan
<smallest credible set for this change — see modes/verify.md>
~~~

Gate: Critical dose requires explicit human approval of the plan before `implement`.

End with: plan path, task count, suggested next mode (`implement`).
