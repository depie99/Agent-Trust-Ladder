# Local recovery drill

Run this drill before enabling unattended routines or after changing the runtime:

1. Stop dispatch and record the current supervisor status.
2. Create a backup with `node runtime\\atl-manager.mjs backup create --label recovery-drill`.
3. Confirm the backup manifest contains SHA-256 hashes and use the Control Plane restore preview.
4. Start a deterministic fake-provider run, terminate the supervisor, and restart it. Confirm the task is marked interrupted or resumable and no duplicate side effect is replayed.
5. Confirm expired leases are reconciled and late worker generations are rejected.
6. Restore the backup only while no queue lock or active lease exists.
7. Run the relevant verification suites and record the backup id, runtime version, and results in the audit log.

The restore operation verifies every recorded hash before replacing project-local files. An unresolved journal remains a blocking condition for new supervisor work.
