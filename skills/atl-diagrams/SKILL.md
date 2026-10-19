---
name: atl-diagrams
description: Create, update, review, and synchronize clean technical diagrams for architecture, flows, lifecycles, dependencies, ownership, and change impact. Use when a visual artifact materially improves comprehension or must stay aligned with engineering evidence.
---

# ATL diagrams

Use a diagram only when it reduces a real comprehension cost. ATL owns routing, authority, and the final evidence verdict; `atl-tech-docs` owns audience, source alignment, and documentation freshness; this skill owns the visual artifact.

## Route

1. **Define the diagram contract.** Record audience, decision the picture supports, scope, non-scope, source of truth, artifact format, owner, and update trigger.
2. **Choose the smallest useful format.** Use clean SVG for stable standalone visuals, standalone HTML when the diagram needs explanation or responsive presentation, architecture SVG for services and trust zones, and Excalidraw when people need to edit the picture together.
3. **Extract the model.** List nodes, relationships, direction, ownership, boundaries, and evidence status before styling. Prefer five to nine primary elements; split a crowded picture into focused diagrams.
4. **Compose for comprehension.** Choose a layout that matches the relationship: left-to-right for flow, top-to-bottom for lifecycle, swimlanes for ownership, layered stacks for architecture, and hub-and-spoke for dependencies. Keep labels short and put detail in nearby prose.
5. **Generate accessibly.** Add a title and description, meaningful alternative text, readable labels, non-color cues, sensible contrast, and a legend only when it reduces ambiguity. Keep connectors behind nodes, use semantic colors, and avoid remote assets, decorative gradients, glows, or animation.
6. **Separate picture from proof.** Check every node and edge against code, configuration, deployment contracts, or observed runtime. Mark inferred or unknown boundaries. A diagram communicates structure; it does not prove that behavior works.
7. **Verify the artifact.** Parse the source, open or render the output, inspect desktop and narrow layouts when applicable, check links and embedding, and review source plus rendered output together. If the artifact consumer or external behavior is unobserved, keep the verdict conditional.
8. **Return an evidence packet.** Include the diagram contract, layout rationale, source and rendered paths, directly observed versus inferred contracts, checks run, owner/update trigger, fallback, and remaining unknowns.

## Authoring backend

The MCP Market Diagram Maker & Visualizer may be used as an authoring backend. Choose `clean-svg`, `architecture-svg`, or `excalidraw` according to the contract. Do not claim the tool ran unless it was actually invoked. If it is unavailable, create a native SVG/HTML artifact using the same quality rules and report the fallback.

Read only the reference needed for the request:

- [format-selection.md](references/format-selection.md) for choosing and structuring an artifact;
- [quality-checklist.md](references/quality-checklist.md) before publishing or reviewing a diagram.

## Stop conditions

Stop for an owner decision when the audience, source of truth, publication owner, or meaning of a boundary is materially unclear. Report `conditionally valid` when an artifact consumer, deployment boundary, or external-service behavior cannot be observed.
