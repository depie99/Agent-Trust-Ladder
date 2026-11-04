# Phase 23 decision record — no extension is selected yet

Date: 2026-11-04
Issue: #23 `[P4] Add durable event and optional harness or routine adapters after measured need`
Depends on: #22

## Decision

No durable event executor, generated routine, harness adapter or knowledge import/projection is selected for implementation in this phase. Each researched candidate is deferred with the reason recorded below, and the issue stays open so a future measured need can select one slice.

This matches the issue's own rule: candidates are selected by a real measured need, baseline and bounded acceptance example, and unused candidates "are explicitly deferred rather than installed for completeness". Completion of this phase can mean shipping the selected needed slice; with no measurement behind a candidate yet, the honest outcome is a recorded deferral rather than speculative code.

## Why nothing is selected today

1. The finite batch path from #19 already runs preselected tasks overnight with a checkpoint, lease and morning summary. No evidence exists that continuous ingestion, rather than a bounded batch, is the current bottleneck.
2. The five candidates all add a durable authority or a second harness boundary: event identity and acknowledgment, routine generation from a repeated trace, a HarnessRouter-style adapter, and imported third-party knowledge projections. Each one needs a real host and source before its contract can be tested, and none has been exercised in this environment.
3. #20's live paired run has not happened, so there is no measured baseline for "continuous ingestion is needed" or "a second harness would improve outcomes". Selecting an adapter now would be a preference, not a measurement.
4. #21 already gives recurring failures a tested preventer and bounded, sourced context. That is the smaller control with a demonstrated before/after case, and it does not need a new execution boundary.

## Candidates and their status

| Candidate | Status | Reconsider when |
| --- | --- | --- |
| Durable event executor with replay/acknowledgment | Deferred | A bounded batch demonstrably misses work because events arrive after the batch is sealed |
| Routine generated from a repeated authorized trace | Deferred | The same authorized trace has been replayed often enough that a parameterised routine with verifier, owner and rollback is cheaper than repeating it |
| HarnessRouter or another harness adapter | Deferred | A concrete second host cannot use the portable contract at all |
| Selective knowledge imports or a Markdown/Obsidian projection | Deferred | A named reader needs it and one authoritative store per environment can be preserved |
| Marketplace-style plugin or event graph | Rejected for this phase | Not proposed by any measurement; conflicts with the bounded scope of #23 |

## Conditions that must hold before any candidate is implemented

- A measured need with a baseline, recorded in the issue, not a preference.
- A bounded acceptance example that fails today.
- Explicit event identity, replay and acknowledgment semantics, including a crash between dispatch and acknowledgment.
- Quota admission, stop conditions and unknown-effect reconciliation carried across the new boundary, reusing #22's ledger rather than inventing another counter.
- The paired UI and skills-only fixtures from #20 pass for the selected slice, with unsupported host capabilities reported as limitations.
- Promotion and side effects still require existing authority: a generated or exported routine cannot execute by existing.

## Rollback

Nothing is installed, so there is nothing to roll back. If a later slice is selected, its own rollback must disable the adapter or consumer without deleting event identity, receipts or unresolved reservations.
