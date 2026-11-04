# Consolidated EGM Review Report

## Verdict

not ready for implementation — all five stage reviews independently returned blocked against an unchanged draft, so no finding is mitigated and the verdict is blocked. The highest-risk omissions are: (1) the root subject mismatch — the Objective commits to a durable delivery queue (persist incoming delivery requests, deliver to a configured remote endpoint with retries, log failures for operators) while the sole requirement [r1], the sole task [p1], and the sole acceptance example all target plan-draft approval durability, so the plan risks building and attesting the wrong feature end to end; (2) no task produces the objective's deliverable — the only proposal is a verification stub whose fixture (`verification/fixture.mjs`) is also the sole verifier command, so the plan's only output authors and attests its own evidence; (3) the invalid skill assignment `atl-verify` on [p1], which is not in this environment's skill registry and leaves the only task non-executable; and (4) unsettled core delivery contracts (message identity, delivery semantics, retry policy) hidden behind "Open questions: none recorded" and an empty Constraints section — a false completeness claim that forecloses the review channel for exactly the decisions the objective depends on.

## Action items by priority

### 🔴 Blockers

#### A1 — Resolve the root subject mismatch between the Objective and the requirement/task/acceptance

The Objective describes a delivery queue; [r1] ("Approval survives process boundaries", sourced from the original request), [p1] ("verify process-level restart and cross-process approval serialization for plan drafts"), and the acceptance example (killed runtime → draft reloaded → no passing review attached) describe plan-draft approval durability. The draft never states the relationship — whether the queue is the mechanism that makes approvals durable or the two subjects are unrelated — so no reader can tell which subject is the deliverable, and the entire task graph serves a requirement foreign to the stated objective. Resolve with one explicit statement of which of the two is the deliverable (either resolution is acceptable; do not prescribe which wins), then re-derive [r1], [p1], and the acceptance example from that statement and align all four sections to it.

#### A2 — Add a task that produces the objective's deliverable; end the self-attesting verification

The plan contains exactly one proposal ([p1], `depends on: none`), and it only verifies. No task creates the persistence layer, the endpoint sender, retry behavior, endpoint configuration, or operator failure logging, and no implementation files are listed. The single artifact [p1] names, `verification/fixture.mjs`, is also the sole Verifier command, so the plan's only output would author and attest its own evidence with no named subject under test. Under the zero-decision rule an implementer would have to invent the storage schema, config format, retry policy, and logging behavior — or deliver nothing. Minimum coherent fix per the narrowing review: one bounded implementation proposal covering the objective's persist/deliver/retry/log behavior (not a larger task inventory beyond the stated intent), with [p1] re-scoped to a named subject under test that is not the fixture itself and depends on it. If approval durability is the actual subject (per A1), state that in the Objective instead and give [p1] a named subject.

#### A3 — Fix the invalid skill assignment on [p1]

[p1] assigns `skills: atl-verify`, but no skill named atl-verify exists in this environment; the atl-* skills are atl-beacon, atl-mira, atl-pip, atl-rowan, and atl-sage, and the verifier role maps to atl-beacon. Multiple stage reviews confirmed this against the registry independently. The assignment cannot be resolved, so [p1] is not executable as written and an implementer would fail skill resolution or have to guess the intended procedure. Minimal fix: remove the `skills` field; assigning atl-beacon is acceptable only if the verifier role is actually intended. Confirm the final name (or its absence) against the skill registry before re-proposal.

#### A4 — Settle or record the core delivery contracts; withdraw the false completeness claim

The draft fixes none of the contracts its objective depends on: no message identity or idempotency key (behavior on redelivery after a crash mid-send is undefined), no delivery semantics (at-least-once vs at-most-once, which governs the retry design), no retry policy (attempt count, backoff, retryable classification), no delivery state set (pending / in-flight / delivered / failed), no persistence location or format, and no logging destination or failure-record shape. Even the words carrying the objective — "durable", "retries", "configured remote endpoint", "logging failures" — are undefined. Simultaneously it records "Open questions: none recorded" and leaves Constraints and assumptions empty, asserting a completeness the content contradicts and foreclosing the review channel for these decisions. Gating minimum at plan stage (per the narrowing review): record as one-line decisions or open questions (a) message identity, (b) delivery semantics, (c) retry policy; persistence location and log destination may ride as open questions; anything beyond that list defers to the implementation tasks. Do not ship "none recorded" while any of the gating three remain undecided.

### 🟡 Major

#### A5 — Make [p1] executable: fixture provenance, operative terms, and pass criteria

"Verify process-level restart and cross-process approval serialization for plan drafts" leaves every operative term undefined: what counts as a process boundary (restart vs concurrent processes vs separate hosts), what "approval serialization" means (durable write format vs mutual exclusion vs ordering), and which draft/approval modules are exercised. The files list names `verification/fixture.mjs` without saying whether it already exists or must be authored (no task currently creates it), and the verify command has no stated success criteria, so an exit code alone cannot say what was demonstrated and two implementers could produce unrelated fixtures a reviewer could not distinguish. State the fixture's provenance; enumerate the concrete scenario steps (e.g., record approval in process A, read it from process B, kill between write and read, reload the draft and assert the expected state); name the modules under test; and define the exact assertion that constitutes pass. Note: one stage review rated the fixture-never-authored variant of this finding a blocker; it stays blocker-level through A2 until a task authors the fixture.

#### A6 — Add acceptance examples that prove [r1] positively and, once A1/A4 are resolved, the objective

The single example ("Given a killed runtime; when the draft is reloaded; then no passing review is attached") asserts only an absence, which cannot establish that anything survives; the positive half of [r1] — an approval recorded before the kill is still present and honored after reload — is untested. "Attached" does not say attached to what (draft, task, or review record), and the terms draft and review are undefined in the objective's domain. No example touches persistence, delivery, retry, or operator logging. Add the positive survival case for [r1] and specify the attach target; once A1 and A4 are resolved, add examples drawn from the winning subject (e.g., given a request persisted before a crash, when the process restarts, then delivery resumes per the retry policy and any failure is logged).

#### A7 — Ground original intent and conformance: quote the request, map objective clauses to requirement ids, reference the contract

[r1] cites "original request" as its source, but that request is never quoted or referenced by a stable id, so no reviewer can confirm [r1] faithfully states the intent; conversely the objective's four clauses (persist, deliver, retry, log) trace to no requirement id at all. The header asserts "Plan contract version: 2" but no contract text is provided or referenced, so structural conformance cannot be assessed either. The document also names no codebase, module, storage layer, or existing approval machinery, so a review against original intent cannot be grounded on it. Quote the original request (or a stable excerpt/id), map each objective clause to a requirement id, and include or reference the contract-v2 text the draft claims to follow.

#### A8 — Define the terminal-failure path and crash-mid-send behavior

The objective's retry loop has no terminal path: a permanently failing request (malformed payload, endpoint 4xx) would retry indefinitely or block the queue — no attempt cap, terminal failed state, dead-letter, or skip-and-log behavior is defined. A crash between send and state update can double-deliver, and the draft has no dedup story; partial or corrupted persistence writes have no recovery behavior. Narrowed remedy at plan stage: record one line on terminal failure (an attempt cap plus a failed state that is logged), let crash-mid-send duplication be settled by the delivery-semantics choice in A4, and list partial-write recovery as an open question — no dead-letter or recovery design forced into the draft.

#### A9 — State the credential source and a failure-log exposure rule

Sending to a configured remote endpoint implies authentication credentials, but the draft says nothing about where they come from or how they are injected at verification time; "logging failures for operators" is precisely the path where payloads, headers, and credentials leak into operator-visible logs. There is also no statement on validating payloads before persisting untrusted input, nor transport-security expectations for the endpoint. Narrowed remedy at plan stage: a single constraint stating where endpoint credentials come from and whether failure logs may contain payloads or secrets; the remaining items (validation at the persistence boundary, TLS expectations) may be recorded as constraints or open questions.

#### A10 — Record the concurrency and scaling expectations

The draft fixes no concurrency or scaling model: whether producers and consumers are single- or multi-process, whether per-key ordering is required, or how queue growth is bounded if the endpoint is down for an extended period (unbounded disk growth; no retention, backpressure, or max-depth policy). These decisions change the persistence format and retry design, so they belong on record before implementation proposals are approved. Narrowed remedy at plan stage: record the expected producer/consumer topology (or list it as an open question) — no policy design in the draft.

#### A11 — Record whether an existing durable-state/queue facility is reused

The draft commits implicitly to a bespoke build (custom persistence + custom sender + custom retry) without weighing alternatives anywhere: reuse of an existing queue/library or the hosting runtime's durable-state facilities, delivery semantics, or push vs poll delivery. No prior stage challenged the build-bespoke assumption. Narrowed remedy: one sentence on whether an existing durable-state or queue facility is reused instead of a bespoke build, bounded to the stated objective. The at-least-once vs at-most-once delivery-semantics choice is already gated in A4 — record it there, since it governs the retry and crash-mid-send decisions in A8.

### 🟢 Nits

#### A12 — Populate or remove the empty "Constraints and assumptions" section

The header is present with no content. Even a verification-only draft silently relies on assumptions worth recording: endpoint reachability during verification, whether the fixture avoids real network calls, and Node runtime availability for a `.mjs` fixture. Populate the section with those verification-environment assumptions plus the constraints surfaced by A4 and A8–A10, or remove the header until content exists.

#### A13 — Give the Verifier commands section a stated role, and split the acceptance example clauses

The section restates [p1]'s verify command verbatim and adds nothing; its role (draft-level verifiers vs per-task verification) is unstated, and since the fixture's existence is unestablished (A5), the command cannot be confirmed runnable from the document alone. Separately, the Given/When/Then clauses are run together on one line with semicolons, making the trigger and assertion harder to parse. State the section's purpose or merge it into the task definition; ensure any listed command is runnable only after its fixture-producing task completes; split the acceptance example into three distinct clauses.

## Traceability matrix

| Action | Raw findings |
|---|---|
| A1 | zoom_out F1, F2; comprehension f1; critic D1; intermediate_zoom_out Z1; implementation_readiness F2 |
| A2 | zoom_out F1; comprehension f2; critic D2; intermediate_zoom_out Z2; implementation_readiness F1, F4 |
| A3 | zoom_out F3; comprehension f3; critic D3; intermediate_zoom_out Z3; implementation_readiness F3 |
| A4 | zoom_out F4; comprehension f6; critic D4; intermediate_zoom_out Z4; implementation_readiness F5 |
| A5 | zoom_out F5; comprehension f4; critic D6; intermediate_zoom_out Z6; implementation_readiness F4 |
| A6 | zoom_out F6; comprehension f5; critic D7; intermediate_zoom_out Z6 |
| A7 | comprehension f7; critic D5; intermediate_zoom_out Z5 |
| A8 | critic D8; intermediate_zoom_out Z6 |
| A9 | critic D9; comprehension f6; intermediate_zoom_out Z6 |
| A10 | critic D10; comprehension f6; intermediate_zoom_out Z6 |
| A11 | critic D11; intermediate_zoom_out Z6 |
| A12 | zoom_out F7; critic D12; intermediate_zoom_out Z6 |
| A13 | comprehension f8; critic D13; zoom_out F5 |

intermediate_zoom_out Z5 is an inventory finding recording that every finding above stood unmitigated against the unchanged draft at its review, so it spans all rows; intermediate_zoom_out Z6 supplies the narrowed remedies embedded in A5–A12 (and confirms that the remedies for the [p1] scenarios and pass condition, the positive survival example, and populate-or-remove Constraints should stand unchanged, as reflected in A5, A6, and A12). All 43 raw findings across the five stage reports (zoom_out F1–F7, comprehension f1–f8, critic D1–D13, intermediate_zoom_out Z1–Z6, implementation_readiness F1–F5) are accounted for in the matrix; none was dropped by merging.
