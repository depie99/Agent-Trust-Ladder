---
name: atl-ui-review
description: Inspect and improve an implemented page or UI against its product intent, design system, interaction, responsive, accessibility, and runtime quality requirements. Use when the user asks to evaluate, critique, test, polish, or fix an existing interface and wants evidence from the real rendered artifact rather than a generic design opinion. Skip for purely greenfield visual ideation with no implemented surface, backend-only work, or formal accessibility certification.
---

# ATL UI review and repair

Review the interface people actually experience, then repair the highest-impact observed defects. Preserve the product's intended character; do not turn every interface into the same fashionable style.

This skill owns UI inspection and the bounded fix loop. `$atl` still owns workflow dose, authorization, lifecycle gates, and the final trust decision.

## Establish the contract

Before judging appearance, identify:

- the page's audience, primary task, and required outcome;
- the approved brief, design system, component library, brand constraints, and reference screens that actually apply;
- supported viewport classes, input methods, themes, locales, and important states;
- whether the request authorizes review only, proposed fixes, or implementation;
- the real runtime entry point and available inspection tools.

If product intent is unclear, state a narrow working assumption. Do not invent brand rules or claim universal taste as a standard.

## Inspect the real surface

Run the product when possible. Inspect the rendered UI at its actual delivery sizes and exercise real controls. Source code, a build log, component names, or a single screenshot are not substitutes for runtime observation.

Choose representative coverage rather than arbitrary screenshots:

1. the primary path at a common desktop and mobile viewport;
2. the most visually or behaviorally demanding component;
3. loading, empty, error, disabled, focused, validation, success, and overflow states when applicable;
4. keyboard-only operation, zoom/reflow, reduced motion, and alternate theme or locale when supported;
5. transitions, interruption, reset, back navigation, and recovery for stateful interactions.

Record what was actually observed. Use `PASS`, `FAIL`, `NOT OBSERVED`, or `NOT APPLICABLE`; never convert missing evidence into a pass.

## Evaluate independent quality axes

Use [references/ui-quality-standard.md](references/ui-quality-standard.md) for the questions and [references/inspection-matrix.md](references/inspection-matrix.md) to select evidence.

Keep these axes separate until the verdict:

1. **Intent and task clarity** — the user can identify the purpose, next action, hierarchy, and outcome.
2. **Visual system** — layout, typography, spacing, color, imagery, density, and component treatment form a coherent hierarchy at delivery size.
3. **Interaction and state** — affordances, feedback, transitions, validation, interruption, reset, and recovery correspond to authoritative application state.
4. **Responsive behavior** — reflow, resizing, touch use, content priority, and overflow remain usable rather than merely shrinking.
5. **Accessibility** — semantics, keyboard path, focus, labels, contrast, motion preferences, target size, and assistive output are checked proportionally. This review is not a formal conformance certification.
6. **Runtime quality** — errors, missing assets, unstable layout, loading behavior, and performance are reported only from suitable runtime evidence.
7. **System consistency** — repeated patterns use the project's tokens and components unless a deliberate exception improves the task.

Do not collapse these into a decorative numeric score unless the project already defines a validated scoring rubric. Averages hide blockers.

## Turn observations into findings

Every actionable finding must contain:

~~~text
Severity: Blocker | Major | Minor | Polish
Axis: <one quality axis>
Where/state: <route, component, viewport, theme, and state>
Observed: <specific evidence>
Expected: <brief, project rule, or named usability principle>
User impact: <task, comprehension, access, trust, or efficiency consequence>
Fix direction: <smallest credible correction; not premature implementation detail>
Recheck: <how the same condition will be observed again>
Confidence: High | Medium | Low
~~~

Severity follows impact, not visual conspicuousness:

- **Blocker** prevents a primary task or access for a supported user group.
- **Major** causes likely failure, serious confusion, loss of data, or broad inconsistency.
- **Minor** adds friction or weakens clarity without blocking completion.
- **Polish** improves craft after functional and accessibility risks are controlled.

Group repeated symptoms under a shared cause such as a broken token, layout primitive, or state model. Do not produce a long list of duplicate pixel complaints.

## Repair in evidence-gated loops

When fixes are authorized, follow [references/fix-loop.md](references/fix-loop.md): preserve a baseline, change the smallest responsible layer, rerun relevant checks, then observe the same viewport and state again.

Prioritize in this order unless project constraints justify otherwise:

1. blocked tasks, misleading state, data loss, and accessibility barriers;
2. broken hierarchy, navigation, responsiveness, and recovery;
3. systemic visual inconsistency;
4. local craft and polish.

After two cosmetic attempts fail to improve the same issue, stop tweaking symptoms. Reconsider the layout model, component boundary, content structure, or state representation.

## Report honestly

Return:

- scope and product assumptions;
- environments, viewports, states, and input methods actually inspected;
- prioritized findings with evidence;
- fixes made and why;
- before/after evidence for repaired conditions;
- regressions run;
- unobserved areas and tool limitations;
- a verdict: `TRUSTWORTHY`, `CONDITIONALLY TRUSTWORTHY`, or `NOT TRUSTWORTHY` for the inspected scope.

Keep four claims distinct: **implemented**, **observed**, **measured**, and **not checked**. Never fabricate captures, interactions, accessibility results, or performance measurements.
