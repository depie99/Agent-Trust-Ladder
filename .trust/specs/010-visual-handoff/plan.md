# Plan — 010 visual handoff without vendoring

Spec: approved 2026-10-21 · Dose: Standard

Tasks:

- [ ] T1 Verify structural show-me output — files: `runtime/lib/show-me.mjs`, `runtime/atl-manager.mjs` — verify: `node runtime/atl-manager.mjs show-me --save` — done when output reflects real repository files.
- [ ] T2 Verify visual PR output and evidence boundaries — files: `runtime/lib/visual-pr.mjs`, docs — verify: `node runtime/atl-manager.mjs visual-pr --title "ATL review"` — done when the body is generated without claiming unavailable screenshots.
- [ ] T3 Verify no vendor footprint — files: `.gitignore`, docs, package files — verify: `git status --short`; `rg -n "\.humanlayer|humanlayer/tasks" --glob '!*.lock'` — done when third-party directories are absent from the repository.
