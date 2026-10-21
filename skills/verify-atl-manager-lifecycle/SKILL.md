---
name: verify-atl-manager-lifecycle
description: Verify ATL manager state transitions and evidence gates when runtime/lib/state.mjs or manager lifecycle behavior changes.
---

# Verify ATL manager lifecycle

Use this project-local skill when a change touches `runtime/lib/state.mjs`, transition actors, completion evidence, review gates, or the manager statuses in `runtime/atl-manager.mjs`.

## Property

An ATL task cannot reach `in_review` without a workspace and observed check evidence, cannot reach `verifying` without an approved Sage review, and cannot reach `done` without passing completion checks.

## Run

```powershell
python verification\atl_manager_lifecycle_model.py
python verification\atl_manager_lifecycle_model.py --mutation-test
```

The model is dependency-free and exhaustively explores its finite gate state space. The mutation check deliberately submits `in_progress → in_review` without workspace/evidence and requires a counterexample. A mutation failure is a verifier failure, not a product finding. A contract mismatch exits with `MODEL ERROR: CONTRACT DRIFT` and requires model/skill review before the change can be trusted.

## Scope and assumptions

- Source of truth: `config/manager-state-contract.json`, consumed by `runtime/lib/state.mjs`.
- Modeled code: the shared transition contract and its `workspace`, `evidence`, `review`, and `all_checks_pass` requirements.
- Modeled actors: Pip, Mira, Rowan, Sage, and Beacon only through the gate effects they produce.
- Bound: all reachable combinations from one new task in this finite model; no external intake, filesystem persistence, Mem0, workspace creation, or JavaScript exception behavior is modeled.
- A passing model is bounded evidence, not proof of the entire runtime.

## Drift rule

If the status list, transition table, or required evidence changes, update `config/manager-state-contract.json` and the model's explicit expectations together, then rerun both commands. The model intentionally fails with `CONTRACT DRIFT` when those expectations diverge. Do not weaken an invariant to make a changed implementation pass; first decide whether the product contract intentionally changed.
