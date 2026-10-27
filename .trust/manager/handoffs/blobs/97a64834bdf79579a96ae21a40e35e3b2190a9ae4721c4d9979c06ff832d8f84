---
name: atl-adr
description: Create, review, or supersede an Architecture Decision Record when an engineering choice has durable architectural impact, meaningful trade-offs, or an expensive-to-reverse consequence. Skip ADRs for tiny isolated edits, policy-covered choices, temporary experiments, or routine implementation details.
---

# ATL architecture decision records

Use this skill when the work contains a decision future developers will need to understand, not merely a task that happens to touch architecture. ATL owns dose, authority, lifecycle, and evidence; this skill owns the decision record.

## Decide whether an ADR is warranted

Recommend an ADR when the decision changes system structure, external interfaces, quality attributes, data ownership, operational posture, or a costly/risky-to-reverse choice; when it contains real alternatives and trade-offs; or when future contributors need the “why.”

Skip it when the choice is tiny, self-contained, already enforced by policy or tooling, a temporary workaround/POC, or fully captured by an existing decision. Do not create an ADR merely to satisfy process.

## Workflow

1. Inspect existing `adr/`, `adrs/`, or `decisions/` directories and follow the repository's numbering, status, linking, and template conventions.
2. Frame one decision. If the request bundles independent decisions, split them into separate records or mark the boundary as `OPEN`.
3. Choose the lightest suitable template from [references/templates.md](references/templates.md). Default to Nygard when uncertain.
4. Write the record using [references/writing-guide.md](references/writing-guide.md): context and forces, options considered, chosen decision, consequences, verification/fitness function, owner, date, and status.
5. Name the file with a lowercase present-tense imperative phrase, optionally prefixed with the repository's zero-padded sequence.
6. Link relevant requirements, code paths, contract ledger rows, tests, and follow-on decisions. Distinguish observed evidence from assumptions.
7. If replacing an accepted decision, create a new record, mark the old one `superseded by`, and link in both directions. Do not silently rewrite history.

## ATL gates

- A proposed ADR is not approval to implement. Human owners still approve intent, risk, and irreversible consequences.
- An ADR is not behavioral proof. Pair it with the relevant plan, implementation, verification, and deployment/runtime evidence.
- A decision that has an objective invariant should name a fitness function or verifier that can fail when the decision drifts.
- Rejected, deprecated, and superseded decisions remain useful evidence; preserve them unless repository policy says otherwise.

## Output

Return the ADR path, decision status, alternatives considered, unresolved questions, linked evidence, fitness function/verifier, and the next ATL stage. If no ADR is warranted, explain why and return control to the matching playbook.
