# Spec — 010 visual handoff without vendoring

Status: approved by explicit implementation request · 2026-10-21

## Behavior

1. `atl show-me` produces a structural handoff from inspected repository
   output, not a builder's unsupported summary.
2. `atl visual-pr` produces a reviewer-ready description with the smallest
   useful file/tree/flow view and truthful evidence boundaries.
3. For UI changes, before/after screenshots are included only when a real
   rendered artifact is available; otherwise the visual claim is marked
   unavailable.
4. Large file sets collapse into a grouped shallow view instead of an unreadable
   diagram.
5. No HumanLayer directory, task file, or vendor code is created in ATL.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| a multi-file runtime change | show-me runs | the output names changed files and a compact relationship view |
| a UI change with captured states | visual-pr runs | before/after images are linked with captions |
| no browser/render evidence | visual-pr runs | screenshots are marked unavailable, not invented |
| many changed files | a diagram is generated | nodes are grouped or omitted by an explicit threshold |
