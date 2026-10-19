# Diagram workflow

Use a diagram only when it reduces a real comprehension cost: architecture topology, a cross-layer sequence, a lifecycle, an ownership boundary, or a change-impact graph with three or more meaningful relationships. Do not add a diagram to decorate a page or to replace a precise contract.

## Choose the artifact

- Use a clean SVG or standalone HTML for a stable explanation in a technical document or review.
- Use an editable Excalidraw artifact for collaborative exploration or a design discussion.
- Keep the diagram source beside the documentation when the tool provides a source format. Name the source and rendered output so they can be updated together.

The Diagram Maker & Visualizer is an optional production aid for these artifacts. It can generate presentation-ready SVG/HTML and editable Excalidraw outputs, with layouts such as layered stacks, swimlanes, and hub-and-spoke maps. Treat the tool as an authoring aid, not as a source of technical truth.

For the reusable artifact workflow, route to `atl-diagrams`. This skill remains the documentation owner: define the audience and source-of-truth contract, place the source and rendered output beside the relevant docs, and verify freshness and navigation.

## Evidence rule

Before publishing, write the diagram's scope and source of truth in nearby prose. Check every node and edge against the repository, configuration, deployment contract, or observed runtime. Link the diagram to the relevant evidence packet when it represents a changed system.

A diagram proves communication quality, not system behavior. It does not prove that an artifact is copied as drawn, that a callback reaches the intended route, or that an external service accepts the contract. Those claims require the matching command or runtime observation in ATL's contract ledger.

## ATL handoff

Record:

- audience and decision the diagram supports;
- layout chosen and why it matches the relationships;
- source file and rendered artifact;
- contracts directly observed versus inferred;
- owner and update trigger;
- fallback if the diagram tool is unavailable.

If the diagram's consumer, deployment boundary, or external-service behavior cannot be observed, keep the documentation verdict conditional and label the unknowns in the page.
