# Spec — 011 usable ATL team runtime

Status: approved by explicit implementation request · 2026-10-21

## Behavior

1. Owner documentation explains install location, target-project location,
   `atl init`, intake, role contracts, worker commands, and morning checks.
2. The runner launches only an explicit bounded worker session and records logs
   and state transitions.
3. A session stops on failure, timeout, no status progress, terminal state, or
   time/session budget.
4. The worker prompt forbids merge, deploy, push, spending, policy mutation, and
   external messages unless a separate authorized workflow allows them.
5. A laptop being open without an explicit worker process does not imply work is
   happening.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| a target project | owner runs `atl init` | the project has a manager state scaffold |
| a task and worker CLI | owner runs `atl overnight ... --confirm` | bounded sessions launch and logs are written |
| a worker exits nonzero | runner observes it | the run stops and reports failure |
| no agent process is running | owner runs `atl wake` | ATL prints a one-shot report and does not pretend to work |
