# Outcome economics without a manager

`scripts/outcome-economics.mjs` reports what a run actually produced and how much of the usage is really measured. The Control Plane imports the same module, so the UI and a skills-only host report the same denominators, coverage and decision backlog.

## What is accounted for

`outcomeSummary(records)` joins attempts by `attempt_id`. A duplicated attempt is reported once (`duplicate_attempts_ignored`) and cannot inflate accepted outcomes. Counts cover `completed`, `accepted`, `failed`, `repaired`, `cancelled`, `blocked` and `running`.

Usage totals sum only attempts whose tokens were reported. Unknown attempts are counted separately with `coverage` of `complete`, `partial` or `unknown`, and a field that is only partly reported stays `null` instead of being under-counted. The module states the rule it follows: unknown usage is never priced as zero. `coverage_gaps` lists missing telemetry and calls that happened outside the admission boundary.

## Admission that cannot exceed its quota

```js
const ledger = createLedger({ window: "2026-11-04" });
const admitted = admitCall(ledger, { key: "provider:plan", cost: 4, limit: 10 });
settleCall(ledger, { reservation_id: admitted.reservation.reservation_id, actual: 3 });
saveLedger(root, ledger);
```

- A reservation is charged from the moment it is admitted and stays charged until it is settled, so a crash cannot free allowance by accident.
- `settleCall` without a measured charge records `unknown_effect` and `reconciliation_required: true`, keeps the reserved charge, and appears in `pendingReconciliation`. `reconcileCall` resolves it later with the real number.
- A settled charge is never rewritten twice, and a refused call does not consume the window.
- Enforcement is claimed only for calls routed through this wrapper. Host calls that bypass it are recorded with `recordGap` and reported as coverage gaps; the module does not advertise a hard ceiling for them.

## Review capacity

`reviewCapacity({ pending, limit, decisions })` marks admission `stopped` once pending reviews reach the limit, names the next decision, and keeps inspection and reconciliation available. A limit of zero cannot disable the cap.

## Known limits

The ledger is single-writer and file-based. `loadLedger` reports a corrupt ledger as `corrupt` with a `ledger-corrupt` gap instead of silently resetting allowances, but it cannot reconstruct charges that were never written. Currency and token units stay separate; nothing here forecasts spending.
