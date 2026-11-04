# Consolidated EGM Review Report

## Verdict

The design is not ready for implementation. Its central reliability contract is undefined, the current system and reusable infrastructure are unknown, and the implementation plan leaves core security and correctness choices to the implementer. `design.md` was not edited during this uninterrupted review.

## Action items by priority

### 🔴 Blockers

#### A1 — Define the delivery contract and lifecycle

State when `POST /deliveries` is accepted, the durable states and transitions, what remote result counts as success, whether delivery is at-most-once or at-least-once, how ambiguous caller timeouts behave, who owns retries, when retries stop, and what callers and operators observe. Define request identity and idempotency so caller and worker retries cannot silently duplicate delivery.

#### A2 — Establish the existing-system baseline and select an architecture

Identify the real repository's HTTP, database, background-job, outbox or queue, authentication, and observability facilities. Compare synchronous forwarding, reuse of existing infrastructure, a database-backed outbox, and a managed queue. Choose the least complex option that meets stated requirements and record why the others were rejected.

#### A3 — Define authorization and destination security

State who may submit and retry deliveries, how ownership is checked, and how operator access differs. Define whether destinations are fixed, configured, or caller supplied; validate or allowlist them; specify credentials and secret handling; and prevent delivery to unauthorized or private-network targets.

#### A4 — Define duplicate prevention and worker ownership

Specify the idempotency-key scope and duplicate response. Define the atomic claim or lease mechanism, expiry and recovery, simultaneous-worker behavior, and crash-safe state updates.

### 🟡 Major

#### A5 — Make goals and operational outcomes measurable

Add a bounded problem statement, goals, non-goals, and only the measurable constraints needed to choose and verify the design: durability, latency or timeliness where relevant, terminal failure, retention, expected load, and operator detection and action.

#### A6 — Specify bounded retry and failure behavior

Classify retryable and terminal outcomes, define attempt counting, backoff and jitter, maximum attempts or elapsed time, remote timeouts, terminal state, and replay policy. Add capacity and per-destination controls only when traffic assumptions justify them.

#### A7 — Produce an exact, phased implementation plan

List every file as Create, Modify, or Delete. Specify handler contracts, schema and migration, worker algorithm, configuration, structured signals, rollback, and ordered checkpoints. Include exact verification commands after each stable phase.

#### A8 — Define actionable operator visibility

Use durable delivery status plus existing structured logs, metrics, and alerts where available. Define identifiers, attempt data, severity, redaction, retention, terminal-failure signals, and the operator action or recovery path.

#### A9 — Expand acceptance coverage around failure modes

Specify tests for durable acceptance, successful delivery, validation, authorization, ambiguous caller timeout, duplicate submission, retry exhaustion, non-retryable response, crash recovery, terminal visibility, and simultaneous workers. Name paths, fixtures, actions, and observable assertions.

### 🟢 Nits

#### A10 — Tighten document structure and wording

Use identifiable sections for problem, goals and non-goals, architecture, alternatives, risks, and implementation phases. Replace vague terms such as “reliable,” “visible,” “failed requests,” and “successful request” with observable behavior. Split the handler, worker, table, and tests into separate responsibilities.

## Traceability matrix

| Action | Raw findings |
|---|---|
| A1 | Zoom Out 1–3; Comprehension 2–4; Critic C2, C3, C7; Intermediate 1, 3, 6; Readiness I1, I2 |
| A2 | Zoom Out 7–8; Comprehension 1, 6; Critic C1, C3; Intermediate 2, 4; Readiness I1, I5 |
| A3 | Zoom Out 5; Comprehension 2; Critic C4; Intermediate 5; Readiness I4, I6 |
| A4 | Zoom Out 1, 4; Comprehension 3–4; Critic C2; Intermediate 1, 7; Readiness I3 |
| A5 | Zoom Out 2, 6; Comprehension 5; Critic C3, C5–C6; Intermediate 3, 8–9; Readiness I9 |
| A6 | Zoom Out 3; Comprehension 3; Critic C5; Intermediate 6; Readiness I2, I8 |
| A7 | Zoom Out 8; Comprehension 6; Intermediate 2; Readiness I1, I5–I8, I10 |
| A8 | Zoom Out 6; Comprehension 5; Critic C6; Intermediate 8; Readiness I9 |
| A9 | Zoom Out 9; Comprehension 6; Intermediate 10; Readiness I11 |
| A10 | Zoom Out 10; Critic C3, C7–C9; Intermediate 11; Readiness I12 |

## Stage reports

- `zoom_out_report.md`
- `comprehension_report.md`
- `critic_report.md`
- `intermediate_zoom_out_report.md`
- `implementation_readiness_report.md`
