# Research and source navigation

Research records hold reviewed improvement proposals. Source maps support code navigation. Both assist planning; neither replaces reading source and running verifiers.

## Review a candidate

```sh
atl research list
atl research status
atl research brief --offline
```

Inspect the candidate’s sources, status, proposed application, and acceptance evidence before review or promotion. `research/index.json` and `research/records/` form the catalog. See [research README](../research/README.md). Promotion alone does not prove a production improvement.

## Build and query the source map

```sh
atl map build
atl map status --json
atl map query --symbol queue
```

Rebuild after relevant changes. Inspect neighbors, then confirm relationships in source; symbol matches do not prove runtime reachability.

## Assemble bounded context

```sh
atl context assemble --task T-001 --query "queue prerequisites" --max-tokens 4000
```

Replace the task ID and query. Inspect included sources, omissions, and the token boundary before passing context to a provider. Keep credentials and unrelated project data out of reusable records.

Source: `runtime/lib/research.mjs` and navigation/context modules in the [file catalog](repository-map.md). See the generated [CLI reference](cli-reference.md) for installed command syntax.
