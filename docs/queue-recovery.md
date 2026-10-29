# Queue preparation, recovery, and delivery

ATL prepares prerequisite outputs inside each worker's isolated workspace before starting a provider. Mira owns recovery, Pip owns one bounded contract repair, Rowan owns overlapping edits, Sage owns review, and Beacon owns verification. Existing work remains in place.

## Prepare an executable task contract

Plan Studio proposals accept `check_owners` (completion check to proposal ID) and a `dispatch_contract`. Approval rejects prerequisite cycles, unknown prerequisites, and checks owned by downstream stages. The final plan card also verifies the composed output and all predecessor checks; it depends on every preceding card.

```json
{
  "check_owners": { "catalog renders": "catalog" },
  "dispatch_contract": {
    "artifacts": ["catalog.json"],
    "commands": [["node", "scripts/check-verifier-ready.mjs"]]
  }
}
```

Commands are argument arrays executed without a shell. They check readiness before a paid session; acceptance checks still belong to the later review and verification stages. The executable example above is a contract shape: supply your project's actual artifact names and command.

For npm projects, a lockfile is required when dependencies exist. Set `workspaces.provisionLocal` to `true` in `config/manager.json` to permit runtime provisioning with `npm ci --offline --ignore-scripts --no-audit --no-fund`. The cache remains under `.trust/manager/npm-cache`. Missing cached packages are reported as owner capabilities; recovery does not enable a network, run lifecycle scripts, or request credentials. A changed manifest or lockfile invalidates the preparation receipt. Other package managers and submodule handoffs require an explicit supported capability.

## Inspect verified handoffs and waiting work

The task detail's **Review recovery** action inventories the transitive prerequisite chain, recorded checks, evidence counts, available workspaces, and their changed files without altering them. Legacy completed tasks with no baseline are not automatically converted into verified handoffs: their output must be revalidated with trustworthy evidence. Dispatch previews report unverified prerequisite handoffs before a worker starts.

**Ask ATL**, available from task details and the project navigation, starts an approval-gated provider session. Diagnose mode is read-only; task-scoped fix mode permits edits and checks within the existing task workspace and holds the queue run lock until the provider stops. Task sessions include the task brief, recent evidence, recovery status, and prerequisite handoff inventory; project sessions have project context. Messages and output are stored locally and are replayed as context for subsequent messages, rather than as a native persistent provider session. A successful fix session is marked awaiting review, not approved or verified. Review and run any resulting change separately through ATL's normal controls. Do not enter secrets in assistant messages.

Task conversations receive the current packet revision, remaining session allowance, readiness contract, five recent recovery records (including failed preflights), and evidence invalidation markers. Project conversations receive up to 40 active tasks and their waiting reasons. The assistant is instructed to classify the failure, inspect evidence, avoid unchanged retries, and identify the exact owner decision when necessary. This context improves diagnosis; it does not grant authority or prove that a provider chose the correct repair.

Version 1 records live under `.trust/manager/handoffs/`. Each completed task records its baseline, content revision, file modes, changed files, SHA-256 blob hashes, input revisions, packet revision, and current complete check evidence. The state record also stores the manifest hash. Consumers verify the manifests and blobs before applying outputs. Dirty and untracked source can be handed off without committing the worker's checkout.

Preparation journals make replay idempotent after interruption. Ancestor outputs are composed in prerequisite order. A reused workspace receives missing outputs while its existing edits remain intact. Conflicts are staged under its own `.atl-inputs/` directory, including each predecessor's manifest and files. Rowan receives at most two integration sessions within the task's existing session allowance, followed by review and verification.

`queueInspect` and the task detail view expose input revisions, the exact waiting reason, recovery owner, current repair action, and remaining attempts. Task state stores versioned `recovery_records` and its current `recovery` projection. Each record contains cause, evidence, attempted actions, their preflight outcomes, and escalation state.

## Recover within the approved allowance

Each blocker permits at most two distinct remedies. A retry requires a successful preflight after a recorded repair. Repeating a failure after a successful repair escalates it; restarting the process or revising a packet does not restore consumed repair or session allowances. A restart during a local repair observes its postcondition before considering another action.

Mira may request one Pip session for a discovered contract or verifier conflict. Its runtime request and resulting `pip_repair` record identify the approved objective, evidence, and packet revision. Pip writes a JSON packet inside its workspace and uses:

```text
atl contract-repair T-002 .atl-evidence/repair.json --actor pip
```

The packet has `patch` and `evidence` fields. Patches may change prerequisites, readiness metadata, and check ownership. They cannot change the objective or completion checks, remove prerequisite artifacts or all existing readiness commands, create a cycle, or introduce downstream ownership. Evidence affected by the revision is retained and invalidated, including dependent task evidence. Pip does not receive a fresh session allowance.

Waiting tasks are reevaluated after completions and successful repairs. Independent eligible work continues. Pending task IDs and run phases are persisted separately from result history. The supervisor can resume preparation, handoff, and local repair boundaries; an interrupted provider session remains owner-blocked until inspected.

Run outcomes distinguish `completed`, `waiting`, `exhausted`, and `owner-blocked`, alongside operator abort and pause states. A task's `done` flag alone does not deliver its queue. A queue without an integrated delivery stage remains waiting for that stage and browser evidence.

## Supervisor continuation and scheduled records

The supervisor lets the launch engine perform each task's bounded lifecycle and recovery. After a launch returns or throws, it moves to other eligible work instead of launching that same task repeatedly during the supervisor invocation. Subsequent launches receive only the remaining overall time allowance. Backup and scheduler failures are reported through the progress log.

Routine ticks persist newly created runs and scheduler metadata together. Preview records do not consume execution eligibility. Cron occurrences remain distinct when the source fingerprint is unchanged; repeated ticks within the same occurrence deduplicate. Invalid schedules are recorded without preventing valid neighboring routines from being queued. Disabled routines do not retry, and unreadable or corrupt run storage raises an error instead of being replaced with empty state.

These changes do not connect routine records to worker dispatch or keep an idle supervisor alive. Continuous overnight operation still requires that integration, host restart checks, and bounded live-provider trials. A queue settles as completed only with its existing delivery evidence; owner-blocked and exhausted work remains visible.

## Deliver the composed revision

Use `atl revision T-002` to obtain the current content revision. Record observation packets under `.atl-evidence/`, which is excluded from source snapshots, then submit them through `atl observe T-002 .atl-evidence/check.json --actor beacon`. A complete check packet includes:

```json
{
  "kind": "check",
  "check": "catalog renders",
  "result": "pass",
  "coverage": "complete",
  "code_revision": "<revision returned by atl revision>",
  "command": "<actual verification command>",
  "exit_code": 0
}
```

Sage records an approved `review`; Beacon records a complete passing `browser-journey`. All predecessor checks, independent review, and the integrated browser journey must refer to the same composed content revision and current packet revision. Partial observations cannot pass an entire check.

Only then does the runtime create `atl/delivery-<task>-<revision-prefix>` with a separate Git index and record the integrated result in the existing `delivery-packets.json` store. It preserves the active branch and index and does not overwrite an existing delivery branch. No automatic main-branch merge, remote push, PR publication, or deployment follows.

## Verify the recovery contract

A worker's zero exit code does not prove progress. Newly recorded failed
checks or unresolved review findings produce a `verification-required`
blocker instead of another generic input-preparation retry. Its stable
identity preserves repair accounting as diagnostic wording changes.
Ask ATL presents the recorded causes, owners and next actions, and receives
bounded worker-log tails. Approved fixes consume the existing task-session
allowance; they cannot reset repair attempts or grant review approval.
See [task-run reliability](task-run-reliability.md) for the isolated preview
and [T-022's blocker ledger](../problems/enhancements/t022-ask-atl-recovery.md)
for observed failure modes and remaining gates.

```text
node verification/queue_recovery_delivery_test.mjs
```

The deterministic local provider fixture uses real child processes, isolated Git workspaces, offline npm provisioning, a real browser journey, and a local delivery branch. It exercises stale downstream input, a missing catalog, unavailable package network, discovered ownership conflicts, changed verifier assumptions, overlapping client edits, manifest corruption, restart replay, exhausted repair budgets, and owner-only blockers. It does not call a paid provider.

Source of truth: `runtime/lib/handoffs.mjs`, `dispatch-preflight.mjs`, `queue-recovery.mjs`, `launch.mjs`, `supervisor-runner.mjs`, and `delivery.mjs`. Verified against this working-tree implementation by the regression command above; no release or remote revision is asserted.
