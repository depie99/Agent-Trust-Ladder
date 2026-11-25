# Knowledge and learning

ATL retains source-backed claims, context, and lessons locally. Learning means recorded knowledge and bounded policy calibration; it does not retrain provider model weights.

## Inspect and recall

Open **Knowledge → Claims** to filter by review status, freshness, or attention needed. Expand **Record details** for the full revision and the matching archived source record. **Sources** lists the archived records, while **Skills & routines** shows promoted skills and registered routines.

```sh
atl memory status
atl memory recall "queue recovery"
```

Read the [CLI reference](cli-reference.md) before adding or forgetting memory. Preserve failed attempts as well as successes.

## Trace evidence

Brain stores sources, immutable raw snapshots, claims, events, and context packs under `.trust/manager/brain/`. Remembered claims do not bypass task checks. See [resource model](resource-model.md).

## Learn from execution

Execution records preserve configured provider/model, sessions, and observed usage. Resource calibration uses qualifying verified history within configured limits. Missing tokens stay unknown. See [execution reports](execution-reports.md) for eligibility, sample minimums, and anti-self-training rules.

## Record a useful lesson

Include the original condition, action, output/failure, remedy, verification result, and reusable scope. Avoid secrets and universal conclusions from one fixture. The [mock report](mock-system-e2e-2026-10-29.md) records failures and accomplishments separately. Review research before promotion through [research and navigation](research-and-navigation.md).

Source: `runtime/lib/brain.mjs`, `memory.mjs`, `execution-report.mjs`, `resource-policy.mjs`. Locate corresponding verifiers in the [catalog](repository-map.md).
