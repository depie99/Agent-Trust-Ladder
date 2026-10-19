# Diagram model registry

Choose the model from the relationship the reader must understand, not from the visual style.

| Reader question | Recommended model | Use when | Default format |
|---|---|---|---|
| What exists around the system? | System context / C4 context | People, external systems, and scope matter | clean SVG or architecture SVG |
| What is inside the system? | C4 container / component | Services, modules, stores, and dependencies matter | architecture SVG |
| How does work move over time? | Process flow / sequence / swimlane | Order, actors, handoffs, or decisions matter | clean SVG or Excalidraw |
| What states can it occupy? | Lifecycle / state machine | Transitions, retries, rollback, or terminal states matter | clean SVG |
| Where does it run? | Deployment view | Hosts, environments, packaging, and external boundaries matter | architecture SVG |
| Who owns or touches what? | Swimlane / responsibility map / hub-spoke | Teams, roles, handoffs, or specialist ownership matter | clean SVG or Excalidraw |
| What does this change affect? | Impact map / dependency graph | Consumers, contracts, docs, UI, tests, or rollback matter | clean SVG |
| Why was this option chosen? | Decision tree / trade-off map | Alternatives, constraints, and consequences matter | clean SVG or Excalidraw |
| What does the business do? | BPMN / value stream / customer journey | Business process, value delivery, or user experience matters | clean SVG or Excalidraw |
| What is the business model? | Business Model Canvas / capability map | Strategy, partners, activities, value, or capabilities matter | standalone HTML or Excalidraw |

## Intent classifier

Extract three fields before choosing:

```text
Audience: who will use the artifact?
Decision: what should they understand or decide after seeing it?
Relationship: structure, time, state, ownership, impact, choice, or value?
```

If two models are plausible, choose one primary model and name one alternative with the deciding question. Do not present a catalogue without a recommendation.

## Reference basis

- [C4 diagram types](https://c4model.com/diagrams) for architecture zoom levels and supporting dynamic/deployment views;
- [OMG BPMN 2.0](https://www.omg.org/spec/BPMN/2.0/About-BPMN) for business-process notation;
- [arc42 views](https://arc42.org/overview/) for context, building blocks, runtime, deployment, and cross-cutting architecture concerns.

## Format rule

- Polished, stable, public documentation: clean SVG or standalone HTML.
- Software/cloud topology: architecture SVG.
- Collaborative exploration: Excalidraw.
- Unknown format preference: choose clean SVG and continue.
