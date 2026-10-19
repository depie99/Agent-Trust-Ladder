# Spec core — full practice for Critical-dose work

The spec is a maintained contract, not a prose archive. Standard dose uses the spec-lite template in `modes/specify.md`; use the artifacts below when the work is Critical: cross-service, auth/payments/privacy, migrations, production, or anything irreversible.

Use only the artifacts that reduce risk. An artifact that clarifies no decision is ceremony.

| Artifact | Purpose | Stable ID |
|---|---|---|
| Vision/outcome | Why this work exists and its boundaries | V-### |
| Requirement catalog | Functional, quality, constraint statements | FR-### / NFR-### / C-### |
| Domain model | Shared terms, states, relationships, invariants | DM-### |
| Decision record | Material trade-off and rationale | ADR-### |
| System use case | Observable behavior for one meaningful goal | UC-### |
| Interface contract | API/event/schema compatibility and failure behavior | IC-### |
| Task contract | Bounded implementation slice and acceptance plan | TC-### |
| Evidence packet | Proof for a specific change | EV-### |

## Requirements

Atomic, testable, sourceable, owned. Never reuse an ID for a different meaning; do not state a quality target without a measurement condition.

| ID | Type | Statement | Rationale | Priority | Source / owner | Status |
|---|---|---|---|---|---|---|
| FR-042 | Functional | A signed-in member can export their own invoices as CSV. | Self-service reporting | Must | Billing owner | Approved |
| NFR-009 | Quality | A 10,000-row export completes within 30s at the agreed load profile. | Usability | Should | Platform owner | Approved |
| C-007 | Constraint | Export data remains in the approved region. | Data residency | Must | Security owner | Approved |

## Domain model

Maintain a lightweight shared vocabulary before behavior. Each important concept: meaning, owner, lifecycle/state, identity, key invariants, neighboring contexts.

~~~markdown
## Invoice
An immutable record of a finalized charge owed by an Account.

Invariants:
- An Invoice belongs to exactly one Account.
- A finalized Invoice cannot change; corrections create a credit or replacement record.
- Only permitted roles may view invoices for an Account.
~~~

## Executable use case

A use case is executable when two competent readers derive the same acceptance tests from it.

~~~markdown
# UC-042 — Export invoices

Status: approved
Actors: Member
Links: FR-042, NFR-009, C-007, IC-014
Entities: Invoice, Account, ExportJob
Owner: Billing
Risk: medium

## Goal
The member obtains a CSV containing invoices they are authorized to view.

## Preconditions
- The member is authenticated.
- The account is active.

## Trigger
The member requests an invoice export for an allowed date range.

## Main success scenario
1. Member submits a valid date range.
2. System authorizes the member for the selected account.
3. System selects only invoices in the range belonging to that account.
4. System creates a CSV using the documented schema and region-safe storage.
5. System makes the completed export available to the requesting member.

## Alternatives and failures
- 1a. Invalid range: system identifies the invalid field; no export is created.
- 2a. Access denied: standard authorization response; no invoice metadata revealed.
- 4a. Exceeds synchronous threshold: system creates an export job and notifies the member.
- 4b. Generation fails: operation-safe failure recorded; no partial downloadable file.

## Postconditions
- A successful export contains only authorized invoices and conforms to IC-014.
- Audit data records the request without storing export contents.

## Business rules
- BR-042-01: Values use the account's approved currency formatting rules.
- BR-042-02: Exports expire after the retention period in C-007.

## Acceptance examples
| Given | When | Then |
|---|---|---|
| a member with two authorized invoices | they export the month | the CSV contains exactly those invoices in the declared order |
| a member without access | they request export | no file or invoice identity is disclosed |
~~~

## Writing rules

- State who acts and what the system observably does; one normative rule per statement.
- Define recent, large, fast, secure, valid with a threshold, boundary, or source.
- Include empty states, authorization, idempotency/retry, concurrency, migration, rollback when relevant.
- Separate facts, decisions, open questions, and implementation options.
- Capture material technical trade-offs in ADRs/interface contracts, not in business use cases.
- A well-formatted spec is not approved until the required human owner reviews intent.

## Legacy code

Existing code is evidence of behavior, not automatic truth. Triangulate with users, logs, tests, policy, interfaces, and data. Mark inferred rules provisional until a domain owner confirms them; do not fossilize accidental defects as requirements.
