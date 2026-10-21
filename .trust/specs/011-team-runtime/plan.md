# Plan — 011 usable ATL team runtime

Spec: approved 2026-10-21 · Dose: Standard

Tasks:

- [ ] T1 Verify install/init/role guidance — files: `docs/team-playbook.md`, `docs/team.html`, `runtime/README.md`, `skills/atl-team/SKILL.md` — verify: docs search plus `node runtime/atl-manager.mjs --help` — done when commands and boundaries agree.
- [ ] T2 Verify bounded local worker lifecycle — files: `runtime/lib/worker.mjs`, `runtime/atl-manager.mjs`, `verification/worker_test.mjs` — verify: `node verification/worker_test.mjs`; dry-run commands — done when sessions stop at declared limits.
- [ ] T3 Verify the overnight claim boundary — files: docs and runtime — verify: `rg -n "hidden daemon|open laptop|claude --cloud|overnight" ...` — done when local and cloud capabilities are not conflated.
- [ ] T4 Preserve completion checks from indented inbox bullets — files: `runtime/lib/intake.mjs`, `verification/intake_test.mjs` — verify: `node verification/intake_test.mjs` — done when the intake format used by the owner produces real task gates.
