# Configuration reference

Configuration defines policy and defaults; state records what happened. Prefer supported browser/CLI operations, then inspect effective launch preview.

## Find the configuration

| File | Scope and purpose | How to change it |
|---|---|---|
| `config/manager.json` | Project intake, providers, budgets, routines, resources | Settings and Issue sources for supported fields |
| `config/manager-state-contract.json` | Runtime statuses, actor permissions, transitions | Read before changing lifecycle code |
| `config/model-routing.json` | Roster and model-routing policy | Inspect policy and run routing verifier |
| `config/skill-routing.json` | Skill discovery and routing | Inspect router and skill contracts |
| `docs/site.json` | Public source, route, title, group, description | Edit manifest and rebuild |
| `docs/sync.yml` | Verified documentation boundary | Advance after checks run |

User-scoped providers and registered projects have separate stores that can contain secrets. Do not copy a real local registry into a configuration example.

Read the generated [lifecycle reference](state-contract.md) for exact statuses, actor permissions, and required transition gates.

## Configure intake

Use environment variable names such as `JIRA_TOKEN` and `AZDO_PAT`; set values in the server environment. Enter connector base URLs rather than issue/taskboard browser URLs. See [issue sources](issue-sources.md).

## Configure resources

Open **Settings → Autonomous resources** and inspect enablement, allowances, caps, model tiers, and cost order. Saving policy does not start execution. Active-run restrictions can block changes. Preview afterward to verify the effective route.

See [resource policy](resource-policy.md) and [providers](providers.md) for semantics.

## Verify a change

```sh
python scripts/validate_model_routing.py
node verification/resource_policy_test.mjs
```

Run the relevant feature verifier for other configuration. Exact supported fields come from implementing validation code, not an arbitrary machine’s sample. Follow the [file catalog](repository-map.md).
