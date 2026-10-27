# Spec — 019 Evidence-Linked Second Brain and Reviewed Automation

From: ATL research supplied by the user; `research/` findings; current ATL runtime
Status: approved 2026-10-25 by owner ("apply"); defaults for Slices B–D approved 2026-10-26. Control Plane is the primary operator interface.

## Intent

Extend ATL from evidence-aware task execution to a persistent, source-linked knowledge workflow without weakening human approval, task evidence, or runtime containment gates.

## Current baseline

Already implemented (capability verified by the passing brain regression test; the `.trust/manager/brain/` store exists in code but holds no records in this repo yet):

- Persistent task/run state, queue ownership, bounded retries, and run leases.
- Research records with deduplication and human promotion into tasks.
- Evidence-linked claims under `.trust/manager/brain/` with source revisions.
- Duplicate claim detection, conflict marking, bounded context packs, and worker-prompt inclusion.
- CLI commands: `atl brain claim`, `atl brain list`, and `atl brain context`.

These capabilities are advisory context. They do not constitute completion evidence, approval, authorization, or source freshness proof.

## Behavior

1. A source is ingested with a stable identifier, source URI or local reference, content/revision hash, observed time, and intake result.
   - 1a. Replaying the same source revision produces no duplicate source, claim, task, or external side effect.
   - 1b. A failed or unavailable source records an explicit failure and is never represented as “no change.”
2. A consequential claim references its source identifier and revision, observed time, checked time when verified, owner, project, and status.
   - 2a. Claims with incompatible text for the same subject remain stored and are marked `CONFLICTED`.
   - 2b. A claim marked `UNKNOWN`, `PARTIAL`, or `CONFLICTED` is presented to workers as advisory and cannot satisfy a task completion check.
3. A context pack is generated from a bounded query/scope and contains claim IDs, statuses, source IDs, source revisions, and checked times.
   - 3a. Context packs are rebuildable artifacts and do not become an independent source of truth.
   - 3b. A worker receives only the task-scoped pack; unrelated project knowledge is excluded.
4. Research records automatically create or update linked claims, preserving the research record as the human-readable source and the brain record as machine-readable provenance.
5. Human review is required before a claim becomes an approved operating rule, skill, routine, external message, or consequential mutation.
6. A reviewed workflow may be promoted to a versioned skill only when its input contract, validation checks, approval boundary, rollback/containment behavior, and regression fixtures are recorded.
7. A routine may schedule only an approved skill and must have a durable run record, idempotency key, retry limit, stop/kill mechanism, owner, and failure notification path.
8. The TUI/control plane exposes source status, claim status, conflicts, context-pack links, approvals, outputs, and audit history without exposing credentials or treating shared browser state as an isolation boundary.

## Rules (normative)

- Task evidence and human approvals remain authoritative over brain claims.
- Source failure, stale data, and contradiction are visible states, not empty results.
- Raw source material and prior interpretations are retained; updates supersede rather than erase history.
- All persistent writes use atomic replacement or an equivalent transactional boundary.
- Five concurrent workers may read one immutable context snapshot but may not overwrite another worker’s owned state without an explicit conflict.
- External messages, deployments, spending, policy changes, and credential-bearing actions remain outside autonomous routine scope unless separately approved by the existing ATL gates.
- Provider token or cost limits are reported only when directly exposed by provider telemetry; local session counts must not be presented as provider quota.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| Five source records are available | Ingest is run twice | The second run creates no duplicate source, claim, task, or side effect |
| Intake is interrupted after raw save but before claim commit | Intake resumes | The source is retained and exactly one claim is committed |
| Two sources disagree about one subject | Both are ingested | Both remain available and the subject is visibly `CONFLICTED` |
| A source endpoint is unavailable | A scheduled check runs | The run records source failure and does not report “unchanged” |
| A task has relevant verified and conflicted claims | A worker launches | Its prompt contains a bounded pack with source IDs/revisions and labels conflicted claims advisory |
| A claim is unknown or conflicted | A worker reports it as a completion check | ATL rejects it unless an independent task evidence observation exists |
| A draft external message is generated | No human approval exists | The draft is stored, but sending is unavailable |
| Five workers read the same context snapshot | One worker updates its owned task | Other workers’ task state remains unchanged and the update is auditable |
| A reviewed skill is scheduled | The scheduler restarts mid-run | The durable run resumes or reports containment according to its idempotency key and retry limit |
| A provider does not expose quota telemetry | A run completes | ATL reports local sessions and marks provider quota as unknown |

## Delivery slices

### Slice A — P0 source and state integrity

- Immutable/raw source archive or references.
- Transactional intake checkpoints and crash-recovery tests.
- Append-only brain audit events and source failure records.
- Five-fixture fidelity, replay, crash, contradiction, and freshness suite.

### Slice B — P1 reviewed knowledge operations

- Claim freshness/staleness evaluation.
- Explicit approval state for rules and decisions.
- Context-pack citations and task/run links in the control plane.
- Independent review of context relevance and conflict handling.

### Slice C — P1 skill and routine promotion

- Versioned skill registry with Bronze/Silver/Gold validation.
- Promotion gate from reviewed workflow to skill.
- Routine registry with durable runs, idempotency, bounded retries, stop control, and failure notification.

### Slice D — P1/P2 interface and hygiene

- TUI/control-plane source, claims, conflicts, approvals, outputs, and audit views.
- Usage/budget records per run where telemetry exists.
- Weekly stale-claim, conflict, and outdated-skill suggestions.

## Out of scope

- Treating contextual memory as authoritative for changing facts.
- Autonomous external communication, deployment, spending, policy changes, or credential sharing.
- Claiming production reliability from the supplied article or vendor documentation.
- Replacing the existing task state machine, approval gate, or independent verification role.
- Building a general-purpose vector database before the deterministic provenance and recovery tests pass.

## OPEN / ASSUMPTION

- OPEN (Slice A blocker): exact source archive format and retention policy. Approved by owner 2026-10-25: content-addressed raw files under `.trust/manager/brain/raw/<content-hash>/` plus the reference record, retained until a human prunes.
- OPEN (Slice A blocker): whether the project should retain raw bytes locally, immutable references, or both. Approved by owner 2026-10-25: both — bytes make crash/replay/audit examples provable offline; the reference remains the stable identity.
- OPEN: freshness thresholds by claim type. (Slice B decision; not needed for Slice A planning.)
- OPEN: human owner and approval UI for rules, skills, and routines. (Slice B/C decision.)
- OPEN (affects Slice A): concurrency mechanism required beyond the current atomic file replacement. Approved by owner 2026-10-25: snapshot isolation on the existing tmp+rename write with a revision check — a stale writer receives an explicit conflict instead of overwriting; no new locking primitives.
- ASSUMPTION (current runtime): `.trust/manager/brain/` remains the project-local store; the research article’s `.atl/brain/` layout is treated as conceptual, not a repository mandate.
- ASSUMPTION (supplied research): the article is a proposed walkthrough, not independently verified reliability evidence.

## References

### Local project references

- [ATL user guide — governance and control plane](../../GUIDE.md) (formerly referenced as `AGENT_TRUST_LADDER.md`, which no longer exists at repo root)
- [ATL research index](../../research/index.json) and [research README](../../research/README.md)
- [Evidence brain implementation](../../runtime/lib/brain.mjs)
- [Research ingestion](../../runtime/lib/research.mjs)
- [Launch and worker integration](../../runtime/lib/launch.mjs), [worker prompt construction](../../runtime/lib/worker.mjs)
- [Brain regression test](../../verification/brain_test.mjs)

### Supplied research and external references

- [ATL Second Brain Engineering research file](file:///C:/Users/Sanaz/Downloads/ATL_Second_Brain_Engineering_tsukiema_2026-10-25.md)
- [Second Brain Engineering source post](https://x.com/tsukiema_/status/2112947495059743047?s=20)
- [Grok Bot overview](https://docs.x.ai/grok-bot/overview)
- [Skills, routines, and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)
- [Grok Bot FAQ](https://docs.x.ai/grok-bot/faq)

The supplied article and research synthesis are treated as design input. Vendor documentation supports capability and risk statements, not ATL reliability claims.

## Intent gate

Approved by the human owner on 2026-10-25 (reply: "apply"; also recorded in Status by the parallel session), accepting the recorded recommendations for the Slice A open items. `atl-plan` is authorized for Slice A only; Slices B–D return to this gate before planning.

Suggested next mode: `plan` (Slice A).
