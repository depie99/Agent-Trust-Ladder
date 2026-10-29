# Feature and how-to map

Find the reader procedure, implementing boundary, and verification entry point for each feature. Module names are under `runtime/lib/` unless a full path is given; tests are under `verification/`.

## Choose a feature

| Feature | How-to | Main source | Verification entry point |
|---|---|---|---|
| Install and initialize | [Guide](getting-started.md) | `runtime/atl-manager.mjs` | `package_smoke_test.mjs` |
| Browser and terminal | [Guide](control-room.md) | `runtime/control-plane-client.js` | `control_plane_server_test.mjs` |
| Jira, GitHub, Azure and files | [Guide](issue-sources.md) | `intake.mjs, composer.mjs` | `issue_source_ui_journey_test.mjs` |
| Plans, clarification and publishing | [Guide](plan-studio.md) | `plan-studio.mjs, plan-publish.mjs` | `plan_contract_test.mjs, plan_publish_test.mjs` |
| Task contracts and named queues | [Guide](tasks-and-queues.md) | `state.mjs, queue.mjs` | `task_dependency_contract_test.mjs` |
| Bounded execution and supervisor | [Guide](overnight-runs.md) | `launch.mjs, supervisor-runner.mjs` | `overnight_issue_e2e_test.mjs` |
| Recovery and interruptions | [Guide](queue-recovery.md) | `queue-recovery.mjs, worker.mjs` | `worker_windows_timeout_test.mjs` |
| Contextual discussion and fixes | [Guide](ask-atl.md) | `control-assistant.mjs` | `control_assistant_test.mjs` |
| Captured changes and relationships | [Guide](task-change-review.md) | `task-changes.mjs, change-review-store.mjs` | `task_changes_ui_test.mjs` |
| Providers and access | [Guide](providers.md) | `userProviders.mjs, execution-access.mjs, browser-access.mjs` | `execution_access_test.mjs, browser_access_test.mjs` |
| Model capability and budgets | [Guide](resource-policy.md) | `resource-policy.mjs, jev.mjs` | `resource_policy_test.mjs` |
| Quota fallback | [Guide](providers.md) | `provider-quota.mjs` | `provider_quota_failover_test.mjs` |
| Usage and calibration | [Guide](execution-reports.md) | `execution-report.mjs` | `execution_report_test.mjs` |
| Knowledge and memory | [Guide](brain.md) | `brain.mjs, memory.mjs` | `brain_test.mjs` |
| Research and navigation | [Guide](research-and-navigation.md) | `research.mjs, navigation.mjs` | `brain_test.mjs, navigation_test.mjs` |
| Projects and concurrency | [Guide](projects-and-backups.md) | `supervisor.mjs` | `supervisor_test.mjs` |
| Approvals and grants | [Guide](projects-and-backups.md) | `approvals.mjs` | `approval_test.mjs` |
| Backups and routines | [Guide](projects-and-backups.md) | `backup.mjs, routines.mjs` | `backup_test.mjs, routine_test.mjs` |
| History transport | [Guide](codex-history-bridge.md) | `codex-bridge.mjs` | `codex_bridge_test.mjs` |
| Engineering skill workflows | [Guide](skills.md) | `skill-router.mjs, skills/*/SKILL.md` | `scripts/validate_model_routing.py` |

## Choose a workflow

For unclear intent, frame and plan. For an approved executable packet, inspect readiness and run a bounded queue. For an existing result, inspect changes, evidence, and independent review. For failures, preserve output and follow recovery.

Locate exact files and additional tests in the [file catalog](repository-map.md). A listed verifier is an entry point, not a claim it passed in this refresh. See the [verification record](docs-refresh-verification.md).
