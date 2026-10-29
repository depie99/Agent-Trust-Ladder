# Knowledge and learning

ATL retains source-backed claims, context, and lessons locally. Learning means recorded knowledge and bounded policy calibration; it does not retrain provider model weights.

## Inspect and recall

Open **Knowledge** and inspect a claim's source and revision before reuse.

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
