# Plan — 005 formal manager state model
Spec: approved 2026-10-21 · Dose: Standard

## Approach

Model the real `runtime/lib/state.mjs` manager lifecycle with a small dependency-free exhaustive reference model. Check the user-harming gates that ordinary examples can miss: no review without workspace and observed evidence, no verification without Sage approval, and no done state without passing completion checks. Keep the existing abstract ATL lifecycle model; this adds a code-mapped model rather than replacing it.

Decision: use a Python finite-state model instead of adding TLA+ tooling. It is reproducible in this repository today and is sufficient for the finite gate contract.

Decision: keep `config/manager-state-contract.json` as the single machine-readable state contract. The runtime consumes it, while the reference model validates its assumptions against it and fails loudly on drift.

Decision: generate a project-local verification skill with exact paths, commands, bounds, mutation behavior, and drift instructions so a cold agent can rerun it.

## Pre-mortem

- Model drifts from the state contract → detected as `CONTRACT DRIFT` before exploration → update the contract, model expectations, and local verification skill together, then rerun both model commands.
- Mutation does not fail → detected by `--mutation-test` → repair the invariant or harness before treating the suite as evidence.
- Passing model is mistaken for global correctness → prevented by explicit bounds/assumptions in the skill and README → retain runtime tests and review as separate gates.

## Tasks

- [x] T1 Add the manager state model and mutation check — files: `config/manager-state-contract.json`, `runtime/lib/state.mjs`, `verification/atl_manager_lifecycle_model.py`, `verification/README.md` — verify: `python verification/atl_manager_lifecycle_model.py` and `python verification/atl_manager_lifecycle_model.py --mutation-test` — done: runtime and model share the contract; baseline passed over 9 reachable states and the unsafe mutation was rejected with a counterexample.
- [x] T2 Add the cold-agent verification skill and route — files: `skills/verify-atl-manager-lifecycle/SKILL.md`, `config/skill-routing.json` — verify: `python verification/atl_manager_lifecycle_model.py --mutation-test` and route probe — done: formal requests select `atl-formal-verification`, and the local skill documents scope, command, counterexamples, and contract-drift failure.
- [x] T3 Inspect and run the broader checks — files: all changed files — verify: `python verification/atl_lifecycle_model.py`, `python verification/atl_lifecycle_model.py --mutation-test`, `node runtime/atl-manager.mjs validate`, `git diff --check` — done: all checks passed, package dry-run includes the new suite, and no generated artifacts were introduced.

## Verification plan

Baseline model: exhaustive bounded reachability over the manager statuses and gate evidence flags. Mutation model: inject a direct `in_progress → in_review` path without workspace/evidence and require a counterexample. This proves the model catches the selected class of regression; it does not prove external intake, persistence failure, or all JavaScript behavior.
