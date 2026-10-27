# Project assessment

Assess only what matters to the request. Record `OBSERVED`, `ASSUMPTION`, or `OPEN`; absence is not a failing score.

## Need signals

| Signal | Observe | Route implication |
|---|---|---|
| Context | instructions, ownership, glossary, ADRs, architecture map | Missing/stale context → bootstrap; terminology conflict → domain modeling |
| Intent | bounded outcome, non-goals, actor, acceptance behavior | Vague or consequential → frame/grill; already agreed → do not interview again |
| Shape | named domain/data model, module boundaries, interface ownership | Cross-boundary or scattered logic → architecture/design specialist |
| Feedback | real build/test/lint commands, reproduction surface, CI reliability | No credible loop → create or repair verification before increasing autonomy |
| Risk | auth, privacy, money, migration, production, irreversibility, blast radius | Critical dose; explicit approvals and rollback evidence |
| Scale | one slice, many call sites, multi-session program, concurrent tickets | Choose plan, wayfinding, task graph, or orchestration proportional to scale |
| Change type | investigation, defect, performance, feature, refactor, review, delivery | Select one matching primary playbook |
| Evidence | acceptance examples, negative cases, runtime observation, independent review | Missing evidence becomes a gate, never an optimistic pass |
| Recovery | revert, flag, migration rollback, containment, owner | Weak recovery lowers effective autonomy |
| Prompt readiness | raw symptom, desired outcome, acceptance examples, approved plan, existing diff/PR | Missing readiness → frame/specify; existing work → verify/review/audit; approved plan → implement |

## Project need verdict

State one of:

- `READY`: existing context and feedback support the requested workflow.
- `NEEDS-FOUNDATION`: a prerequisite such as ownership, commands, domain language, or verification is missing.
- `NEEDS-DECISION`: a human-owned intent or risk choice blocks the route.
- `NEEDS-CAPABILITY`: a required tool, integration, or specialist skill is unavailable.
- `UNSAFE-NOW`: the action cannot be credibly detected, contained, or recovered from in the current environment.

Prefer the narrowest repair. Do not prescribe a full framework setup when one missing command, document, or test seam is enough.

The user does not need to identify the workflow. Infer it from the strongest signal: vague intent requires framing; bounded intent without observable acceptance requires specification; approved behavior without repository mapping requires planning; an approved plan enables implementation; existing work with a trust question requires verification, review, or audit. Record the inference as `OBSERVED`, `ASSUMPTION`, or `OPEN` when it affects the route.
