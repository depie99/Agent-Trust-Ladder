# T-022 blocker ledger and Ask ATL recovery

Observed October 28, 2026. This record covers the working-tree implementation,
not a released version or a completed overnight queue.

| Recorded blocker | Correction and prevention |
| --- | --- |
| Worker exited 0 after recording failed evidence, without advancing | Diagnose the new evidence/checkpoint as verification-required; do not call ready inputs a successful repair. |
| Older PASS hid a newer failure | Use the latest valid current-packet evidence for CLI presentation and lifecycle gates. |
| Isolated preview returned HTTP 500 for missing manager state | Add a read-only loopback preview using disposable fixture state and actual task assets. |
| Missing or invalid UTF-8 Persian rendered evidence | Inspect the real Activity & Logs surface in Chrome; save screenshot, DOM and revision-bound observations. |
| Broad composed diff was treated as unrelated scope | Compare files with verified predecessor outputs; retain exact client/style patches for independent hunk review. |
| Claimed T-022/T-024 ownership conflict | Preserve both contracts. Task-local rendering can precede downstream integrated review. A reported conflict is not permission to remove checks. |
| Rowan received Pip-only repair instructions; invalid check_ownership patch | Restrict repair instructions to Pip and document the accepted metadata schema. Actor isolation remains enforced. |
| Repeated preparation exhausted recovery attempts | Preserve stable blocker identity, repair history and session limits. Ask ATL receives the actual diagnosis and recent logs. |

## Live task result

At content revision
`5df0f72d8952941ce2e8fe99e41cc7af85d6138a7e0ff46f3d3d1326bdb87f36`,
`npm run ui:css:check` exited 0. Chrome observed the actual task asset's
Activity & Logs surface with synthetic UTF-8 data: document `lang=fa`,
`dir=rtl`, Persian sentence direction RTL, and nested Latin path direction
LTR with `unicode-bidi: isolate`. Both completion-check observations were
recorded. Acceptance is 2/4; independent Sage review and final completion
remain pending. Status stays blocked, usage stays 12/23, and automatic repair
history remains exhausted.

Evidence is in the T-022 workspace under `.atl-evidence`:
`t022-recovery-receipt.json` (diagnosis and artifact hashes),
`t022-fa-log-observed.{json,png}`, `t022-scope-attribution.json`, and
`t022-{client,style}-vs-t021.patch`. The source revision was not changed.
Files named by review that match verified predecessors are attributed in the
receipt; the remaining composed hunks still require independent review.

The current project's Ask ATL panel was inspected in Chrome. It displays the
recovery plan, owners and repair prompt. No paid assistant run was submitted
as part of this verification. Historical chat responses remain historical;
they are not fresh review approval.

Two later Ask ATL fix sessions consumed two task sessions (usage now 14/23).
The first used Codex CLI model gpt-6.1-sol, which the signed-in ChatGPT
account rejected as model_not_found. A later gpt-6-luna run exited with
code 0 but reported that workspace reads were denied, no files changed, and no
checks ran. ATL had incorrectly labeled that no-op awaiting-review. The
current recovery handler now exposes both model incompatibility and explicit
workspace access denial, and marks the latter as failed with a next action.
The account/model choice and provider workspace access must be corrected
before retrying; these consumed sessions were not restored.

## Verification

Passing local checks: `task_diagnostics_test.mjs`, `ui_review_preview_test.mjs`,
`control_assistant_test.mjs`, `worker_test.mjs`,
`task_dependency_contract_test.mjs`, `control_plane_server_test.mjs`,
`worker_channel_launch_test.mjs`, and `queue_recovery_delivery_test.mjs`
under `verification/`. The lifecycle model and mutation check also passed.
Diagnostics include an actual spawned worker recording failure without
advancing. Preview tests assert UTF-8 state, task-asset parity and rejected
mutations. Assistant tests assert budget exhaustion and review boundaries.

The new diagnostics and preview tests are listed in the runtime CI matrix;
remote CI and live-provider overnight completion were not observed. Routine
dispatch integration, idle-supervisor continuity and sustained host trials
remain open as recorded in `overnight-reliability-evidence.md`.

## Documentation evidence

October 28 follow-up: the failed assistant session used GapCode, not a missing
provider installation. Ask ATL's Windows launch path used the legacy sandbox
flag while queue workers used a named workspace profile. Both paths now share
the profile adapter. A local sandbox read/write/readback/cleanup check passed
inside T-022, without another task session. This establishes filesystem access;
the reported nested MCP approval restriction remains a separate tool policy.
Task and project access controls plus a no-model check are documented in
`docs/ask-atl.md`. No new model-driven repair or independent review was claimed.

Decision: update existing runbooks and create this incident record. Mode:
sync. Audience: ATL maintainers investigating blocked work. Sources:
`runtime/lib/{task-diagnostics,launch,control-assistant,ui-review-preview,state,worker}.mjs`
and `runtime/control-plane-client.js`. Sync anchor: October 28 working-tree
source hashes in `t022-ask-atl-source-hashes.json`, not a release commit.
Commands and UI instructions were exercised locally; links and sections were
reviewed for independent readability. No dedicated prose linter was run.
Documentation is current for these local paths; unattended queue completion
and independent T-022 approval remain unverified.
