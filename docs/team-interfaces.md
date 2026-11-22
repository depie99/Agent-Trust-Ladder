# Interface reference

Use the browser for daily ownership, the CLI for precise automation, and the terminal for keyboard inspection. Each surface uses runtime gates and shared records.

<a id="browser-menus"></a>
## Find a browser feature

| Surface | Purpose | How-to |
|---|---|---|
| Overview | Portfolio health and pending decisions | [Control Plane](control-room.md) |
| Tasks | Packets, evidence, prerequisites | [Tasks and queues](tasks-and-queues.md) |
| Shipped | Completed-task archive | [Tasks and queues](tasks-and-queues.md) |
| Issue sources | Configure, preview, import issues | [Issue sources](issue-sources.md) |
| My Tasks | Assigned issues, preparation, kanban board | [Task preparation](task-preparation.md) |
| Ask ATL | Discuss or authorize a bounded fix | [Ask ATL](ask-atl.md) |
| Plan Studio | Decompose and review a request | [Plan Studio](plan-studio.md) |
| Queues | Named work sets and bounded launch | [Overnight runs](overnight-runs.md) |
| Workflow runs | Plan chains as checked steps per task | [Overnight runs](overnight-runs.md) |
| Agent Team | Responsibilities and handoffs | [Team](team.md) |
| Projects | Register and supervise repositories | [Projects](projects-and-backups.md) |
| Approvals | Owner proposals and grants | [Approvals](projects-and-backups.md) |
| Operations | Routines, backup, restore | [Operations](projects-and-backups.md) |
| Batches | Run list, detail, and recipes | [Overnight runs](overnight-runs.md) |
| Knowledge | Source-backed claims and memory | [Knowledge](brain.md) |
| Activity & Logs | Decisions and sessions | [Recovery](queue-recovery.md) |
| Usage & Limits | Observed tokens, sessions, reliability | [Reports](execution-reports.md) |
| Settings | Providers, models, connections, budgets | [Providers](providers.md) |
| Task workspace: Review changes | Captured source/output differences | [Change review](task-change-review.md) |
| Task workspace: Process | Execution detail and code-impact graph | [Tasks and queues](tasks-and-queues.md) |

Scroll the sidebar, press **1–9** to jump to one of the first nine pages, or open the responsive menu when secondary navigation is hidden.

<a id="terminal-menus"></a>
## Use the terminal

```sh
atl tui
atl dashboard --once --plain
```

Use visible key hints for the current view. Browser shortcuts are separate. `atl ui` launches the browser server.

<a id="choose"></a>
## Use the CLI

Run `atl --help` for the installed version. The [generated reference](cli-reference.md) reflects this repository, which may differ from an older installation. Read [history bridge](codex-history-bridge.md) for transport into Codex.

<a id="shared"></a>
## Inspect shared state

Tasks, queues, approvals, ledgers, plans, handoffs, and Brain records are separate resources. Follow the [resource model](resource-model.md) and [file catalog](repository-map.md).
