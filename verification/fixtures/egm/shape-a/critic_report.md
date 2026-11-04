# Stage 7: Critic Review

## Blockers

### C1 — No alternatives analysis

**Reviewers:** egm-design, egm-structural  
**Affected scope:** Lines 3–5  
The specification proposes only a stored-request delivery approach and does not compare alternatives. This violates the feature-spec standard's mandatory alternatives rule. Compare at least synchronous forwarding, a database-backed outbox, and a managed queue, then explain rejections using reliability, cost, complexity, performance, and scale trade-offs.

### C2 — Reliability contract is undefined

**Reviewer:** egm-design  
**Affected scope:** Line 5  
“Delivery should be reliable” is not implementable. The document does not define at-most-once versus at-least-once behavior, acknowledgement and timeout semantics, durable state transitions, crash recovery, ordering, or duplicates after an ambiguous caller timeout. Define the state machine, transaction boundaries, idempotency-key contract, retry ownership, and observable accepted, delivered, failed, and safe-to-retry conditions.

## Major findings

### C3 — Required specification structure and measurable goals are absent

**Reviewers:** egm-design, egm-structural, egm-style  
**Affected scope:** Lines 3–6  
The generic “Feature design” section provides no dedicated problem statement, goals and non-goals, architecture, alternatives, or risks and mitigations. “Reliable” and “visible” are subjective and cannot be verified. Add a bounded problem statement, explicit exclusions, and measurable targets such as accepted-request durability, delivery latency, success rate, retention, retry limits, failure states, and operator detection time.

### C4 — Endpoint and security boundaries are unspecified

**Reviewer:** egm-design  
**Affected scope:** Line 5  
The flow does not define endpoint registration or validation, request and response formats, authentication, authorization, secret handling, tenant isolation, payload limits, timeouts, or protection against server-side request forgery and private-network delivery. Define component boundaries, the end-to-end data flow, and ingestion and dispatch controls.

### C5 — Failure and capacity limits are missing

**Reviewer:** egm-design  
**Affected scope:** Line 5  
Unbounded retries, slow destinations, or an outage could cause queue growth, database load, worker starvation, and retry storms. State expected and peak rates, payload size and retention assumptions, concurrency controls, bounded backoff with jitter, per-destination limits, terminal failure handling, backpressure, and capacity monitoring.

### C6 — Operator visibility is not actionable

**Reviewers:** egm-design, egm-style  
**Affected scope:** Line 5  
The document does not say what evidence is recorded or how operators act. Specify attempt records, correlation identifiers, metrics, alerts, retention and redaction, and recovery or replay procedures.

### C7 — Caller retry language is ambiguous

**Reviewer:** egm-style  
**Affected scope:** Line 5  
“A caller can retry a timed-out request” does not identify the actor, the timeout condition, whether the original request identifier is reused, or the externally visible result. State those semantics directly.

## Nits

### C8 — Proposed behavior is written as present fact

**Reviewer:** egm-style  
**Affected scope:** Line 5  
Use normative wording such as “must” or “will,” and replace “remote endpoint” with the endpoint's defined role or interface.

### C9 — Markdown hierarchy is valid

**Reviewer:** egm-structural  
**Affected scope:** Lines 1–6  
The H1-to-H2 hierarchy is valid, with no malformed lists, tables, links, or code blocks in scope. No action is required for basic Markdown structure.
