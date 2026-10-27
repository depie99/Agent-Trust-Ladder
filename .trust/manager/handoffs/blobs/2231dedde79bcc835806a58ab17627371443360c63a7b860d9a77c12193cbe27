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
