---
name: atl-frame
description: Turn a vague engineering request into a bounded brief with explicit unknowns, constraints, acceptance examples, rollback, and an appropriate process dose.
---

# Trust Ladder: Frame

This is the independently invocable `frame` workflow from Agent Trust Ladder. Run only this workflow for the current invocation.

## Shared contract

- Discover repository instructions, protected work, and real verification commands before acting; never invent a command.
- Preserve the user's scope and authority. Passing evidence cannot approve intent, expand scope, or authorize merge, deploy, publication, spending, production access, or irreversible actions.
- Mark consequential unknowns `OPEN` and unverified claims `ASSUMPTION (source)`; do not silently turn either into behavior.
- Never hide a failure, weaken a meaningful check for green, overwrite unrelated work, or claim a verifier ran when it did not.
- Use bounded loops with explicit stop conditions. Humans own ambiguous intent, risk acceptance, waivers, and irreversible decisions.
- Spend context deliberately: read metadata first, then only this mode and its relevant references; do not repeat unchanged evidence or load unrelated skills.
- End with the artifact or verdict produced, open items, and the next safe action. Do not silently run the next Trust Ladder workflow.

## Workflow

# Mode: frame — turn a vague request into a bounded brief

Goal: close the gap between what the user means and what the agent would assume, **before any code exists**. Most failed agent runs are not coding failures; they are framing failures.

## When

The request is an idea, a complaint, or a wish without bounded scope. Skip for trivial edits (Direct dose) and when a current brief already bounds the work.

## Steps

1. **Ground in the project.** Read the project brief (or discover it). Locate the owning area in code and skim what exists today — similar features, adjacent contracts, current behavior. Never frame from the prompt alone.
2. **Draft the smallest useful intake:**

   | Area | Minimum |
   |---|---|
   | Outcome | User problem, desired result, success signal, non-goals |
   | Actors | Who/what uses it; permissions; tenancy |
   | Scope | Boundary, interfaces touched, data touched |
   | Constraints | Security, privacy, performance, cost, compatibility |
   | Evidence | What observable check would prove success |
   | Decision rights | Who approves; what requires escalation |

3. **Ask the frontier in one round.** List every material unknown as numbered questions:
   - One round, not a dripping interrogation. *Material* = the answer would change the design, the dose, or the acceptance test.
   - Each question carries a **recommended default**, phrased so a plain "yes" accepts it.
   - Cap: 5 questions (Standard dose), 8 (Critical). Rank by blast radius.
   - Explicitly surface the boring gaps agents otherwise guess at: identity/authorization, duplicate submission/retry/concurrency, empty states, data retention, interface compatibility, rollout/rollback.
4. **Classify and record.** Answers become decisions. Unanswered stay `OPEN:`. Guesses stay `ASSUMPTION: (source)`. Nothing silent.
5. **Set the dose** — Direct / Standard / Critical — in one line with the reason. Critical triggers: irreversible, cross-service, production data, auth/payments/privacy, migrations.
6. **Write `brief.md`** in `.trust/specs/NNN-slug/` (NNN = next free number, slug = kebab-case outcome).

## Output template

~~~markdown
# Brief — <NNN> <slug>
Dose: Standard — <one-line reason>
## Outcome & success signal
## Non-goals
## Actors & permissions
## Scope (what changes / what must not change)
## Constraints
## Decisions (from user) · OPEN · ASSUMPTION
## Acceptance examples (draft Given/When/Then, 2–5)
## Rollback story (how this gets undone if it turns out wrong)
~~~

End with: the brief path, the dose, and the suggested next mode (`specify`).
