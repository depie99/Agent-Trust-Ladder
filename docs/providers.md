# Providers and access

Choose a ready provider and an eligible model before execution. Authentication, model capability, workspace access, and browser access are separate launch inputs.

## Configure a provider

Open **Settings** and inspect built-in readiness. Install and authenticate the chosen CLI, or configure an API provider with its base URL, protocol, credential, and models. A supported CLI subscription and an API key are different authentication paths.

```sh
atl providers
atl provider templates
```

Inspect [CLI reference](cli-reference.md) before changing provider keys or overrides. Keep credentials out of task descriptions, screenshots, and research records.

## Validate model selection

Configure resource-policy model tiers and relative cost order. Inspect the effective task provider/model and role overrides in launch preview. A cheaper incapable tier must be rejected before spend.

Cost order is a local ordering, not a currency estimate. Execution reports identify the configured model; undocumented provider substitutions remain unknown. See [model routing](model-routing.md) and [resource policy](resource-policy.md).

## Review execution and browser access

Use Settings to inspect access mode and readiness probes before a task needs files or a rendered UI. Discussing a task in Ask ATL does not grant a fix request access. Saving access settings does not prove completion.

## Recover authentication or quota errors

Preserve provider errors and quota evidence. Unknown remote capacity remains unknown. Before fallback, inspect whether the alternative is permitted, ready, and capable. Re-run preview after fixing configuration.

Source: `runtime/lib/providers.mjs`, `userProviders.mjs`, `execution-access.mjs`, `browser-access.mjs`, `provider-quota.mjs`. Checks: `verification/execution_access_test.mjs`, `browser_access_test.mjs`, `provider_quota_failover_test.mjs`.
