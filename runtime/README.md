# ATL runtime

The runtime coordinates persistent tasks, queues, providers, bounded execution, review, and evidence. Agent skill instructions in `skills/` are a separate layer.

## Install and start

Require Node.js 22+ and Git. Follow [getting started](../docs/getting-started.md) for per-user installation and project initialization. In this clone inspect commands with `node runtime/atl-manager.mjs --help`.

From an application with ATL installed:

```sh
atl init
atl ui --port 4317
```

`atl ui` and `atl control-plane` start the browser server; `atl tui` opens the terminal. Check any `ATL_PROJECT` override before acting.

## Find implementation and contracts

| Boundary | Read |
|---|---|
| Runtime layers | [Architecture](../docs/architecture.md) |
| Tasks, queues, plans, ledgers, handoffs, Brain | [Resource model](../docs/resource-model.md) |
| Every command | [CLI reference](../docs/cli-reference.md) |
| Owner-session API | [API reference](../docs/api-reference.md) |
| Policy and providers | [Configuration](../docs/configuration.md), [providers](../docs/providers.md) |
| Execution and recovery | [Overnight runs](../docs/overnight-runs.md), [recovery](../docs/queue-recovery.md) |
| Tests and setup | [Development](../docs/development.md), [verification](../verification/README.md) |

`lib/state.mjs` consumes the runtime's `config/manager-state-contract.json`. Task state is only one store; related records have their own files. Read the owner module and verifier before changing persistence.

## Diagnose a result

Inspect objective, current checks, implementation revision, independent review, and delivery boundary. A transcript or done badge alone does not establish production deployment. Follow [troubleshooting](../docs/troubleshooting.md).
