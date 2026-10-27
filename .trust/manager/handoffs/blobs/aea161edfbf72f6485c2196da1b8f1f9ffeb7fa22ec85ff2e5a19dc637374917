# Mode: verify — turn work into evidence and a verdict

Goal: answer the five questions with checks that actually ran. This is the skill's center of gravity: AI scales execution faster than humans scale verification, so every change ships with evidence attached.

## When

Work is implemented — this session or someone else's. Also after applying fixes from an `audit`.

## Steps

1. **Select the smallest credible set** that covers the *changed* risks — not everything, not nothing:

   | Layer | Evidence |
   |---|---|
   | Static | format, lint, typecheck, policy/schema checks |
   | Unit | invariants, branches, transformations |
   | Integration | database, queue, services, auth, contracts |
   | End-to-end | real user journey with observable assertions |
   | Non-functional | security, performance, accessibility, resilience |
   | Operations | migration rehearsal, observability, rollback, feature flags |

2. **Run them in the stated environment.** Generated tests are hypotheses until they have run. Never report a check as passing unless it ran here, now.
3. **Observe acceptance examples** from the spec as actual behavior, where possible.
4. **Produce `evidence.md`** — packet plus verdict:

~~~markdown
# Evidence — <NNN> <slug>
## Trust verdict (state in the user's language)
1. What changed: <from the real diff>
2. Why: <objective / spec items served>
3. What could break: <failure modes + how each is covered or NOT covered>
4. Downstream impact: <callers, contracts, data, security, ops>
5. Objective achieved: <observed behavior + checks run>
## Checks
<command — environment — result — relevant output>
## Skipped / unavailable checks and why
<never hidden>
## Known gaps, residual risk, recommended follow-ups
## Trust impact
none | proposed advancement (→ modes/trust.md) | regression
~~~

5. **Report skipped checks separately from passing ones.** A green summary with buried skips is a failed verification.

End with: the verdict; suggested next mode (`trust` if advancement was proposed, otherwise done).
