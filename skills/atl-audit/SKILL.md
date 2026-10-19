---
name: atl-audit
description: Audit an existing diff, pull request, or agent session and report whether it is trustworthy, conditionally trustworthy, or not trustworthy. Read-only unless fixes are requested.
---

# Trust Ladder: Audit

This is the independently invocable `audit` workflow from Agent Trust Ladder. Run only this workflow for the current invocation.

## Shared contract

- Discover repository instructions, protected work, and real verification commands before acting; never invent a command.
- Preserve the user's scope and authority. Passing evidence cannot approve intent, expand scope, or authorize merge, deploy, publication, spending, production access, or irreversible actions.
- Mark consequential unknowns `OPEN` and unverified claims `ASSUMPTION (source)`; do not silently turn either into behavior.
- Never hide a failure, weaken a meaningful check for green, overwrite unrelated work, or claim a verifier ran when it did not.
- Use bounded loops with explicit stop conditions. Humans own ambiguous intent, risk acceptance, waivers, and irreversible decisions.
- End with the artifact or verdict produced, open items, and the next safe action. Do not silently run the next Trust Ladder workflow.

## Workflow

# Mode: audit — trust verdict on an existing diff, PR, or agent session

Goal: the review entry point for work you did not watch happen. "The agent updated 500 files — how do I know it worked?" Read-only: this mode changes nothing unless asked.

## When

A large diff, a foreign PR, an overnight agent run, or any change that must be blessed before merge or deploy. Also works as a self-check before handing work to a human reviewer.

## Steps

1. **Bound the subject:** exact commit range / PR / session. State what you reviewed and what you could not.
2. **What changed — from the diff itself**, not from claims. Classify every file: behavior / tests / config / deps / docs / generated / **unrelated**. Surface scope leaks and unexplained files first.
3. **Why — reconstruct intent.** Match changes to the brief/spec/tickets. Name every orphan change with no stated reason.
4. **What could break.** For behavior changes, enumerate failure modes: inputs, states, concurrency, authorization, data volume, dependency failures. Inspect the diff's own tests for **circularity** (asserting what the code does instead of what it should do) and weakened assertions.
5. **Downstream impact:** callers of changed interfaces, contracts, data/migrations, security surface, config and deploy implications.
6. **Did the objective get achieved?** Map claimed outcomes to acceptance evidence. Run the smallest credible checks yourself when authorized. List all missing evidence.
7. **Verdict and required follow-ups:**

~~~markdown
# Audit — <subject>
Reviewed: <range / PR / session>, <N> files, read-only
Verdict: trustworthy | conditionally trustworthy (conditions) | not trustworthy (reasons)
1–5: <the five questions, answered from evidence>
Orphan/unrelated changes: <...>
Evidence gaps: <...>
Required follow-ups: <each with owner + check>
~~~

Be honest about coverage: **reading a diff is not running it.** Say which conclusions come from execution and which from inspection.
