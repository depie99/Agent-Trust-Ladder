# Plan — 019 Evidence-Linked Second Brain and Reviewed Automation

Spec: approved 2026-10-25 · Dose: Standard · Scope: Slice A only

## Approach and key decisions

1. Extend the existing `.trust/manager/brain/` store rather than introduce a second persistence system.
2. Store raw bytes at `.trust/manager/brain/raw/<sha256>/content` with a metadata record containing stable source ID, URI/reference, hash, observed time, and intake result.
3. Use atomic temporary-file replacement plus a revision check for snapshot isolation. A stale writer returns an explicit conflict; no new lock primitive is introduced.
4. Keep research Markdown as the human-readable source and link its content-addressed raw snapshot to the generated claim.
5. Make source failure a durable result and keep it distinct from “unchanged”.

Alternatives rejected: Markdown-only raw storage cannot prove byte fidelity or crash recovery; a new database/lock layer is out of scope for Slice A; silently replacing a claim would destroy contradiction history.

## Impact

Expected changes:

- `runtime/lib/brain.mjs` — source archive, metadata, revision checks, audit events, and recovery-safe writes.
- `runtime/lib/research.mjs` — archive research record bytes before claim creation and retain source linkage.
- `runtime/atl-manager.mjs` — expose source intake/status and failure results only if the existing CLI surface can remain bounded.
- `verification/brain_test.mjs` — fidelity, replay, contradiction, and context regression coverage.
- new `verification/brain_recovery_test.mjs` — interrupted-write recovery, stale revision conflict, and source failure tests.
- `docs/README.md` and `research/README.md` — document the actual store and failure semantics.

At-risk callers: research creation, claim ingestion, brain CLI commands, and worker context generation. Existing task/run state and completion evidence must not change. Existing `.trust/manager/brain/claims.json` remains readable; missing source metadata is reported as an incomplete legacy record rather than guessed.

Migration is additive: initialize `raw/`, `sources.json`, and `events.jsonl` lazily. Rollback is code rollback; newly created raw artifacts remain append-only and are safe to retain.

## Pre-mortem

- Raw and claim records diverge → detected by a fidelity/replay verifier comparing source hash and claim metadata → rollback by refusing promotion of incomplete claims and retaining the raw snapshot for repair.
- Two writers overwrite a source index → detected by revision mismatch in the atomic commit test → rollback by returning `conflict` and requiring a fresh snapshot.
- Source failure is mistaken for no change → detected by an explicit failure fixture and CLI status assertion → rollback by preserving the failed intake event and preventing claim updates.

## Constitution compliance

Complies with ATL rules: evidence is separated from interpretation; atomic writes and explicit conflict states are preserved; human approval remains authoritative; no deployment, external mutation, or autonomy-level increase is introduced. No ADR is required because the approved Slice A decisions are local, additive, and reversible.

## Tasks

- [x] T1 Define source/archive schema and atomic helpers — files: `runtime/lib/brain.mjs` — verified: `node --check runtime/lib/brain.mjs`; `brain_recovery_test.mjs` asserted raw bytes, hashes, metadata, and audit events.
- [x] T2 Archive research record bytes before claim creation — files: `runtime/lib/research.mjs` — verified: `node verification/brain_test.mjs`; research creation produced a linked raw snapshot and replay remained deduplicated.
- [x] T3 Add crash/replay/stale-writer/failure tests — files: `verification/brain_recovery_test.mjs`, `verification/brain_test.mjs` — verified: both tests passed; duplicate replay emitted no event, stale revisions returned `SOURCE_REVISION_CONFLICT`, and failed intake remained durable.
- [x] T4 Expose bounded source status — files: `runtime/atl-manager.mjs`, `runtime/lib/brain.mjs` — verified: isolated `ATL_PROJECT` fixture ran `brain source` and `brain status`; status reported revision, result counts, hash, and raw path without credentials.
- [x] T5 Update documentation and run regressions — files: `docs/README.md`, `research/README.md` — verified: documentation now names the raw archive, source metadata, event log, and `brain status`; all Slice A regressions passed.

## Verification plan

Smallest credible set:

1. Source fidelity: five fixtures have preserved bytes, stable IDs, hashes, and linked claims.
2. Replay: the same five source revisions produce no additional records or claims.
3. Crash safety: an injected failure between raw save and claim commit resumes without loss or duplication.
4. Contradiction: incompatible claims remain and both become `CONFLICTED`.
5. Freshness/failure: a failed source is explicitly reported and never rendered as unchanged.
6. Regression: existing brain and run-control tests remain green.

No external service or deployment contract is exercised by Slice A; those boundaries remain unverified and out of scope.

Plan path: `.trust/specs/019-evidence-linked-second-brain/plan.md`
Next mode: `implement` after this plan is accepted.
