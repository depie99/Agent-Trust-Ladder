# Technical documentation content model

Use the reader's need to choose the page shape. The labels below combine the four Diátaxis needs with content models used by large developer-documentation teams. Follow the repository's existing taxonomy when it differs.

| Type | Reader need | Shape | Do not turn it into |
|---|---|---|---|
| README / entry point | Decide "is this for me, and how do I start" | One-paragraph definition first, when-to-use and when-not-to-use, shortest working example early, installation/config in tables, links outward, troubleshooting last | marketing landing page |
| Tutorial | Learn by doing | Guided path with a known starting point and successful result | exhaustive reference |
| How-to | Achieve a specific goal | Focused prerequisites, ordered steps, expected result, troubleshooting | conceptual essay |
| Reference | Look up exact information | Minimal prose, stable tables, defaults, validation rules, complete parameters | beginner tutorial |
| Explanation / concept | Understand why or how | Context, model, trade-offs, boundaries, relationships | step-by-step procedure |
| Quickstart / get started | Reach first value quickly | Minimal happy path, short setup, clear next step | full onboarding manual |
| Troubleshooting | Recover from a known failure | Symptom, cause candidates, diagnostic checks, fixes, escalation | random FAQ list |
| Decision record (ADR) | Understand why the system is built this way | Status, context, decision with rejected alternatives, consequences; numbered files plus an index | task list or design dump |
| Release note / migration | Understand change and action required | What changed, who is affected, compatibility, migration, rollout/rollback | marketing announcement |

## Decision records

Write a decision record when a choice is significant, hard to reverse, or sets a precedent for later work — not for every commit. Use the repository's template and numbering when one exists; otherwise record status (proposed / accepted / superseded by N), context (forces and constraints), decision (what was chosen and why, including the main rejected alternative), and consequences (affected behavior, migration cost, follow-ups). One decision per record; keep the index current.

## Selection rules

- One page, one primary reader goal. The primary audience outranks every secondary audience; when their needs conflict, split the page and link instead of duplicating.
- Organize by what readers are trying to do, not by source directory layout — the repository tree is usually the wrong information architecture for docs.
- A complex feature may have a small family: entry point → quickstart → how-to → reference → explanation. Narrative pages build the mental model and link outward; exhaustive detail belongs in reference pages.
- Put the result and prerequisites before long background. Progressive disclosure lets readers stop when their task is complete.
- Use the repository's navigation and naming conventions. Do not create a new docs taxonomy for one page.
- A source code comment, API schema, generated reference, and human guide have different owners; identify which one is canonical.
