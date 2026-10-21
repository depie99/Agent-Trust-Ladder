---
name: atl-maintain-verification
description: Maintain ATL's project-local verification skill, contract mapping, baseline checks, and mutation checks after verification-related changes.
---

# Maintain ATL verification

Use this specialist when a verification skill, formal model, evidence contract, or verifier command changes. Treat the verification loop as shared infrastructure: a green product check is not enough if the local skill is missing, stale, or no longer catches its negative control.

## Run

From the repository root:

```powershell
python scripts\maintain_verification_skill.py
```

The command checks the project-local skill assets, confirms the manager contract is valid JSON, runs both ATL model baselines, and runs both mutation checks. A mutation check must fail internally with a counterexample and then report `MUTATION TEST PASSED`.

## Review triggers

Run this maintenance loop when:

- `verification/` models or their commands change;
- `config/manager-state-contract.json` or `runtime/lib/state.mjs` changes;
- a local verification skill's scope, assumptions, or drift rule changes; or
- packaging, installation, or documentation could stop a cold agent from finding the verifier.

## Interpretation

- Missing assets, invalid JSON, a baseline failure, or a mutation failure is a maintenance failure.
- `CONTRACT DRIFT` is a modeling failure that requires updating the contract, model expectations, and local skill together.
- A passing maintenance loop is bounded evidence for this verification infrastructure; it does not prove the entire product or external runtime.

## Handoff

Report the command, baseline results, mutation results, changed verification surfaces, remaining unverified behavior, and whether the next safe action is implementation, review, or delivery.
