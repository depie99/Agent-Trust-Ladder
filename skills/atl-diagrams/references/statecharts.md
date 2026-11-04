# Statecharts and model-check evidence

Use this mode to explain transitions, event ordering, retries, lease ownership, recovery, or a failed invariant. Ordinary architecture and data relationships stay in the existing diagram modes.

## Ownership and execution

`atl-formal-verification` owns the property, executable model, bounds, mutation check, and code mapping. `atl-diagrams` owns readable state/action labels and source plus rendered artifacts. ATL owns the verdict. A rendering never upgrades the evidence level.

Discover the installed PStack `statechart` skill before choosing a compiler command. Read its current `SKILL.md` and rendering reference; invoke the supplied compiler rather than implementing a second TLC parser or approximating checker semantics with regex. Follow the installed version's requirements for Java, TLC, runtime, and Pele. Do not automatically install dependencies during a read-only control-plane inspection.

When the compiler is unavailable, say so. An existing verifier may still run. Preserve its actual result and write a small native Mermaid/SVG projection with the abstraction documented; do not claim PStack, TLC, or Pele executed. A manually written state machine without a checker run is a design/contract diagram only.

## Result contract

Keep the model, config, view, raw checker output, report, Mermaid source, and rendered SVG together in a fresh repository evidence folder. Record the model/code revision, command, tool versions, bounds, assumptions, invariant names, result, and unchecked rules. Distinguish pass, violation, timeout, tool/model error, and partial exploration. Absence of a chart or a marked node is never evidence of success.

Use labels that describe observable behavior. Preserve guards and actor boundaries. If a projection combines good and bad concrete states, retain the distinction between definite and possible violations; do not hide it with a friendly label. Retain each reported counterexample path and its rule identity when simplifying. Explain omitted edges, symmetry, constraints, or partial exploration that affect interpretation. Handle intended terminal states explicitly in the executable model rather than suppressing deadlocks indiscriminately.

Describe failures as numbered actions and replay them in the implementation. If replay disagrees, investigate model drift before claiming a product defect. Keep violations visible when code currently fails; do not change the property to get a green chart.

## Rendering and themes

For compiler-generated charts prefer Pele, using the installed skill's rendering instructions. Keep Mermaid as the portable source and supply an SVG alongside it. Apply Pele CSS variables and semantic classes for light/dark, blueprint, or illustrated styles requested by the reader. Theme choices must preserve readable labels, guards, violation marks, and counterexample paths. On renderer failure keep the source/report available and report the rendering error. Do not load remote scripts or upload private models from a diagram modal.

## ATL control-plane placement

- Task Diagram / Review changes: show the live task's current state, permitted outgoing transitions, actors, and requirements from `config/manager-state-contract.json`. Label it **Contract only**. This is neither event history nor a model-check result. Keep the complete Mermaid contract available for inspection.
- Verification evidence: record revision-bound model results through the existing evidence workflow. A stale report cannot approve newer code. Missing checker output remains unknown.
- Planning and specification: use a proposed statechart to review lifecycle behavior before code changes; label it proposed until reconciled with the executable contract.
- Queue/worker/recovery diagnosis: use formal models for competing claims, retries, lease expiry, cancellation, and resume ordering when the invariant justifies the cost. Keep this work explicit; opening Diagram must not start a checker or worker.

The modal's compact native SVG is a local view of the enforced ATL contract. It does not embed the PStack compiler or a generic uploaded-SVG viewer. Attachments, arbitrary model execution, and checker-result ingestion require their own implemented consumer before claiming they are supported.

## Upstream basis

Adapted integration guidance, not a vendored compiler: PStack v0.15.36, revision `c742dd6`, `pstack/skills/statechart/SKILL.md` and `pstack/skills/create-formal-verification-skill/SKILL.md` in `cursor/plugins` on GitHub; Pele documentation at `pele.run`. Resolve installed commands from the actual installation, not this provenance record.
