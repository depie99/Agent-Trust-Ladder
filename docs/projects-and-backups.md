# Projects, backups, and approvals

Project registration supports multi-repository supervision. Approval records preserve owner decisions. Backups support recovery. Inspect each resource separately.

## Register and inspect projects

```sh
atl projects register
atl projects list
atl projects concurrency 2
```

Register from the intended application. Inspect **Projects** before using the supervisor. Shared concurrency is bounded; readiness and task gates can permit fewer sessions than the configured cap.

## Review approvals

Open **Approvals**, inspect scope and effects, then approve or reject the exact proposal. Queue membership does not imply permission for every privileged action. For a task, inspect `atl why T-001` before using its approval action. Use your actual task ID.

## Back up and restore

```sh
atl backup create --label before-maintenance
atl backup list
```

Choose a known snapshot and inspect restore preview in **Operations**. Restore changes persisted state and requires no active run. A backup is not source control or remote delivery evidence.

## Inspect routines

Use **Operations** and `atl routines` to inspect declarations, enablement, recorded runs, and recovery. A saved routine is not evidence of successful scheduled execution. Read its current scope before relying on it unattended.

Source: `runtime/lib/supervisor.mjs`, `supervisor-runner.mjs`, `approvals.mjs`, `backup.mjs`, `routines.mjs`. Locate matching verifiers in the [file catalog](repository-map.md).
