# Diagram format selection

| Need | Format | Minimum shape |
|---|---|---|
| Stable concept, process, lifecycle, or change-impact view | Clean SVG | title/description, 5–9 nodes, directed edges where needed |
| Services, stores, queues, trust zones, or deployment topology | Architecture SVG | explicit zones, ownership, external boundaries, legend if needed |
| A visual plus explanatory copy and responsive navigation | Standalone HTML | embedded SVG, accessible text, responsive layout, no remote runtime dependency |
| Collaborative exploration or editable workshop output | Excalidraw | valid envelope, bound labels, readable grouping, source stored beside docs |

Model the relationships before choosing colors. Prefer one diagram per decision. Keep source and rendered files together and name them so a future maintainer can update both.

## Compact contract

```text
Audience:
Decision supported:
Scope / non-scope:
Source of truth:
Format and layout:
Owner / update trigger:
Known inferred or unknown boundaries:
```
