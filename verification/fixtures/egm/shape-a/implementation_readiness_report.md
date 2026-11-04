# Stage 9: Implementation Readiness Test

## Blockers

### I1 — The plan is not executable under the zero-decision rule

**Reviewers:** egm-implementation-readiness, egm-codebase-details  
**Affected scope:** Lines 7–9; `src/delivery.js`, unnamed worker, and unnamed database migration  
“Add a handler,” “a background worker,” and “a database table” require the implementer to invent the handler contract, worker architecture, schema, state transitions, remote-call behavior, and failure handling. Specify exact repository-relative files and, for each, the functions or types, request and response contracts, database columns and constraints, queue state machine, transaction boundaries, endpoint interaction, and error behavior.

### I2 — Retry semantics are undecided

**Reviewers:** egm-implementation-readiness, egm-codebase-details, egm-style  
**Affected scope:** Line 9  
Define retryable and non-retryable conditions, timeout classification, attempt counting, schedule and backoff, jitter, limits, terminal failure, caller-triggered retry behavior, and the API result when retry is accepted or rejected. “Failed requests” is too imprecise to implement.

### I3 — Duplicate and concurrent-worker behavior are undecided

**Reviewers:** egm-implementation-readiness, egm-codebase-details  
**Affected scope:** Line 9  
Define the idempotency key and uniqueness scope, duplicate response, record-claiming or locking mechanism, lease expiry, atomic updates, and recovery from worker crashes or simultaneous claims.

### I4 — Authentication and authorization are undecided

**Reviewers:** egm-implementation-readiness, egm-codebase-details  
**Affected scope:** Lines 7–9; `POST /deliveries` and caller retry  
Define who may submit or retry deliveries, the authentication mechanism, permissions, ownership checks, unauthorized responses, and whether operator access uses separate authorization.

## Major findings

### I5 — Exact file scope is missing

**Reviewers:** egm-implementation-readiness, egm-codebase-details  
**Affected scope:** Line 9  
Only `src/delivery.js` is named. List every worker, migration, test, configuration, and logging file as Create, Modify, or Delete. The workspace has no source tree from which conventions can be inferred, so no safe write allowlist can be formed.

### I6 — Handler contract is missing

**Reviewer:** egm-codebase-details  
**Affected scope:** Line 9; `POST /deliveries`  
Specify the request schema, validation, destination representation and allowlisting, persistence order, response schema and status codes, timeout semantics, failure responses, and router/database integration points.

### I7 — Database schema and migration are missing

**Reviewers:** egm-implementation-readiness, egm-codebase-details  
**Affected scope:** Line 9  
Specify the table name, columns and types, nullability, defaults, keys, constraints, indexes, delivery states, payload representation, attempt and error metadata, timestamps, transaction boundaries, and forward and rollback migrations.

### I8 — Worker algorithm is missing

**Reviewer:** egm-codebase-details  
**Affected scope:** Line 9  
Specify scheduling, wake-up behavior, claiming, ordering, batch size, HTTP timeout and result classification, state transitions, crash recovery, shutdown, and retry-exhaustion behavior.

### I9 — Operator signals are not actionable

**Reviewers:** egm-implementation-readiness, egm-codebase-details, egm-style  
**Affected scope:** Line 9  
Define structured events and fields, severity, delivery and correlation identifiers, attempt count, redaction, terminal-failure visibility, metrics or alerts if required, and when each signal is emitted.

### I10 — Phases and verification checkpoints are missing

**Reviewers:** egm-implementation-readiness, egm-codebase-details  
**Affected scope:** Lines 7–9  
Split the work into ordered, stable phases such as schema, ingestion, delivery worker, retry and concurrency controls, and observability and tests. Give explicit build and test commands and rollback points for each phase.

### I11 — The test plan does not cover the feature

**Reviewers:** egm-implementation-readiness, egm-codebase-details, egm-style  
**Affected scope:** Line 9  
“A successful request” is not a reproducible test. Provide exact test paths, fixtures, actions, and assertions for persistence and delivery, validation, authorization, remote timeout, bounded retry, terminal failure, manual retry, duplicates, simultaneous workers, crash recovery, and non-retryable responses.

## Nits

### I12 — Separate the implementation tasks

**Reviewer:** egm-style  
**Affected scope:** Line 9  
Split the handler, worker, and table into separate tasks and state each responsibility. Convert the sentence listing omissions into required decisions with explicit outcomes.
