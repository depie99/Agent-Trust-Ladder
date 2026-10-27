# Brief — 002 smart workflow control plane

Dose: Standard — this changes workflow selection and skill composition but does not itself authorize external writes, production changes, or autonomy increases.

## Outcome & success signal

Give users one easy entry point, `$atl <request>`, that understands the current project's needs and composes the smallest trustworthy workflow from native ATL, PStack, and Matt Pocock skills that are actually available.

Success means the user does not need to know the catalogs, the selected route names why each skill is necessary, unavailable dependencies are never faked, and all routed work remains under one consistent authority/evidence model.

## Non-goals

- Vendor or fork PStack or Matt Pocock skills.
- Automatically install or update third-party skills.
- Run multiple complete frameworks at once.
- Treat more skills, more agents, or more artifacts as higher trust.
- Allow specialist skills to bypass ATL approval, evidence, recovery, or autonomy gates.

## Scope

- Add a discoverable `$atl` control-plane skill.
- Assess context, intent, domain shape, feedback loops, risk, scale, evidence, and recovery only as relevant to the request.
- Select one primary playbook and add only specialists that cover distinct failure modes.
- Provide capability routing with native fallbacks.
- Make workflow choice visible in a compact manifest.
- Keep every existing `$atl-*` workflow directly invocable.

## Decisions

- D-001: PStack contributes rigorous task playbooks and engineering principles.
- D-002: Matt Pocock skills contribute composable intent, domain, task-graph, TDD, and separated-review techniques.
- D-003: ATL remains the control plane for authority, dose, lifecycle state, evidence truth, and earned autonomy.
- D-004: One primary playbook owns the run; external frameworks contribute leaf skills, not competing top-level processes.
- D-005: Capability selection is based on observed project need and current skill availability, with explicit fallback.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| a vague feature request and `grill-with-docs` is available | `$atl` assesses it | it routes clarification/domain work before specification and names the intent gate |
| a reproducible defect with credible tests | `$atl` assesses it | it selects the bug-fix playbook and omits unrelated planning ceremony |
| a large approved spec with independent tickets | `$atl` assesses it | it may route task-graph implementation only after checking isolation and integration ownership |
| a preferred PStack or Matt skill is unavailable | the route is built | ATL states the missing capability and uses the documented native fallback |
| passing tests exist but privacy approval is missing | a workflow reaches delivery | the route blocks; specialist success does not override the ATL gate |
| the project already has healthy domain docs and a current spec | `$atl` assesses it | it does not regenerate them or re-interview the user |

## Rollback story

`skills/atl/` is additive. Removing it restores the previous direct `$atl-*` entry points without migrating existing `.trust/` artifacts.
