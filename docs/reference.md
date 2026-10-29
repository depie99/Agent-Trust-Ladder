# Trust vocabulary

Use these terms consistently in task packets, reviews, and delivery reports.

## Interpret the result

| Term | Meaning | How to inspect it |
|---|---|---|
| Objective | Bounded intended outcome | Read the task packet |
| Completion check | Observable acceptance condition | Run its verifier and retain output |
| Evidence | Recorded observation tied to an artifact/revision | Inspect task evidence and source |
| Independent review | A separate judgment on current changes | Read findings and revision binding |
| Blocker | A condition that prevents permitted progress | Read diagnostics and recovery |
| Done | Lifecycle completion under current runtime checks | Inspect current evidence, not just the badge |
| Delivery | A concrete output boundary | Distinguish local branch, PR, merge, deployment |
| Trust | Scoped autonomy justified by evidence | Review task class and evidence history |
| Process dose | Smallest sufficient engineering route | Use `$atl` and inspect routing reasons |

## Use a verdict honestly

A trustworthy result has current evidence for its claims. A conditional result states missing checks and conditions. An untrustworthy result lacks required evidence or violates its scope. These are review judgments, not substitutes for the literal runtime state contract.

## Choose a process

Start with framing for unclear intent, specification for unclear behavior, planning for codebase impact, implementation for approved work, verification for observed results, and audit for existing changes. Use the [skill catalog](skills.md) for contracts and [Jev](jev.md) for optional smart routing.

## Check a completion claim

Trace the task's source, objective, current checks, review, changes, and delivery boundary. A mock worker pass does not establish production correctness. See [resource model](resource-model.md) and [overnight runs](overnight-runs.md).
