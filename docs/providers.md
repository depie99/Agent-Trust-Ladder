# Providers and access

Choose a ready provider and an eligible model before execution. Authentication, model capability, workspace access, and browser access are separate launch inputs.

## Configure a provider

Open **Settings** and inspect built-in readiness. Install and authenticate the chosen CLI, or configure an API provider with its base URL, protocol, credential, and models. A supported CLI subscription and an API key are different authentication paths. Graphical API-key fields start masked and provide **Show/Hide** controls. In the terminal dashboard's provider wizard, the key starts masked; press **Ctrl+R** to show or hide it while entering.

```sh
atl providers
atl provider templates
```

Use `atl provider add <id>` or `atl provider key <id>` to enter a key at a hidden terminal prompt; **Ctrl+R** temporarily toggles visibility. Non-interactive shells can use `--key-env VAR`; `--key <secret>` is refused outright because command arguments can be retained in shell history and process listings. Inspect [CLI reference](cli-reference.md) before changing provider keys or overrides. Keep credentials out of task descriptions, screenshots, and research records.

## Built-in subscription providers

Supported built-ins are `codex`, `claude`, and `gapgpt`. Sign in through each CLI (`codex login` — choose **Sign in with ChatGPT**; `claude login`; `gapcode login`), then select the built-in for the whole project with `atl provider use codex` or `atl provider use claude`, or per task via **Actions → Provider / model**. Settings shows each built-in's sign-in state. Verify with `atl launch --dry-run`. A subscription login and an API key remain different authentication paths. For an API endpoint that speaks the OpenAI protocol, the `openai-http` worker requires `protocol=openai`, an HTTPS (or loopback HTTP) base URL without query or fragment, and an exact model id; planning calls against it stay bounded to one confirmed session with a 15-minute cap.

## Recover authentication or quota errors

Preserve provider errors and quota evidence. Unknown remote capacity remains unknown. Before fallback, inspect whether the alternative is permitted, ready, and capable. Re-run preview after fixing configuration.

If a subscription CLI rejects its session, sign in again with that CLI (`codex login`, `claude login`, `gapcode login`) and re-run the dry-run preview. If a taskboard rejects a credential, reconnect it from any surface: `atl intake connect azure --token -` (pipe the PAT), or in the browser **Issue sources → connection card → Re-authenticate**, or from the **My Tasks** card. The saved Azure credential also serves My Tasks and scheduled pulls; on Windows it can be remembered securely with DPAPI (**Remember securely**), and where DPAPI is unavailable the token stays a session credential. Automatic quota-failover substitutions are recorded as `resource_route` events and listed in the execution report's quota failover history.

## Validate model selection

Configure resource-policy model tiers and relative cost order. Inspect the effective task provider/model and role overrides in launch preview. A cheaper incapable tier must be rejected before spend.

Cost order is a local ordering, not a currency estimate. Execution reports identify the configured model; automatic quota-failover substitutions are recorded, not silent. See [model routing](model-routing.md) and [resource policy](resource-policy.md).

## Review execution and browser access

Use Settings to inspect access mode and readiness probes before a task needs files or a rendered UI. Discussing a task in Ask ATL does not grant a fix request access. Saving access settings does not prove completion.

## Recover authentication or quota errors

Preserve provider errors and quota evidence. Unknown remote capacity remains unknown. Before fallback, inspect whether the alternative is permitted, ready, and capable. Re-run preview after fixing configuration.

Source: `runtime/lib/providers.mjs`, `userProviders.mjs`, `execution-access.mjs`, `browser-access.mjs`, `provider-quota.mjs`. Checks: `verification/execution_access_test.mjs`, `browser_access_test.mjs`, `provider_quota_failover_test.mjs`.
