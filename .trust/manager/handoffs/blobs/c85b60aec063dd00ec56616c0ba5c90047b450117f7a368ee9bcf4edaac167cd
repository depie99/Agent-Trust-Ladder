# UI review and fix skill brief

## Outcome

Add a directly invocable ATL skill that evaluates an implemented page or interface against product intent and applicable UI standards, fixes authorized issues in bounded loops, and reports runtime evidence honestly.

## Constraints

- The skill must work independently and through the `$atl` router.
- It must inspect the real rendered surface when available.
- Visual, interaction, accessibility, responsive, and runtime claims remain separate.
- Missing observations cannot be reported as passes.
- The workflow preserves project-specific design direction and avoids universal style prescriptions.
- It is a scoped engineering review, not formal accessibility certification or user research.

## Acceptance examples

- Given an implemented page with a real runtime, when the skill reviews it, then findings identify state, viewport, evidence, user impact, fix direction, and recheck method.
- Given authority to fix, when a finding is repaired, then the same rendered condition is observed again and adjacent regressions are checked.
- Given only source code or unavailable browser tooling, when the skill reports, then visual and interaction axes are marked `NOT OBSERVED` rather than passed.
- Given a greenfield request with no implemented UI, when routing, then this skill is not presented as runtime validation.
