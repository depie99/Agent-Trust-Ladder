# Technical documentation content model

Use the reader's need to choose the page shape. The labels below combine the four Diátaxis needs with content models used by large developer-documentation teams. Follow the repository's existing taxonomy when it differs.

| Type | Reader need | Shape | Do not turn it into |
|---|---|---|---|
| Tutorial | Learn by doing | Guided path with a known starting point and successful result | exhaustive reference |
| How-to | Achieve a specific goal | Focused prerequisites, ordered steps, expected result, troubleshooting | conceptual essay |
| Reference | Look up exact information | Complete, structured, precise facts and parameters | beginner tutorial |
| Explanation / concept | Understand why or how | Context, model, trade-offs, boundaries, relationships | step-by-step procedure |
| Quickstart / get started | Reach first value quickly | Minimal happy path, short setup, clear next step | full onboarding manual |
| Troubleshooting | Recover from a known failure | Symptom, cause candidates, diagnostic checks, fixes, escalation | random FAQ list |
| Release note / migration | Understand change and action required | What changed, who is affected, compatibility, migration, rollout/rollback | marketing announcement |

## Selection rules

- One page should have one primary reader goal. Link to adjacent types instead of duplicating them.
- A complex feature may have a small family: quickstart → how-to → reference → explanation.
- Put the result and prerequisites before long background. Progressive disclosure lets readers stop when their task is complete.
- Use the repository's navigation and naming conventions. Do not create a new docs taxonomy for one page.
- A source code comment, API schema, generated reference, and human guide have different owners; identify which one is canonical.
