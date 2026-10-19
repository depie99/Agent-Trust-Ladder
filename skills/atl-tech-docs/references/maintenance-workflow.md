# Documentation maintenance workflow

## Before implementation

Use when a change will affect a user journey, public API, configuration, schema, deployment, operations, security, or developer workflow:

1. Identify the canonical docs and their owners.
2. Map changed behavior to affected pages, examples, navigation, generated references, and release/migration notes.
3. Add documentation tasks to the implementation plan with a verifier for each meaningful claim.

## During implementation

- Keep docs changes in the same branch/change set when they describe the same behavior.
- Update examples and error handling as the implementation changes; do not only edit the introduction.
- Keep docs and code contracts separate in review so a passing prose lint does not mask a broken example.
- Record unresolved implementation/documentation disagreement as `OPEN` rather than choosing a plausible explanation.

## Before delivery

- Re-read the changed code/config/API from the docs reader's perspective.
- Run available docs build, Markdown, prose, link, example, screenshot, and API-schema checks.
- Check navigation, redirects, version selectors, localization, generated output, and release notes where relevant.
- Re-observe the documented task or command on the real supported surface when feasible.
- Report the documentation verdict separately from the code verdict.

## Freshness signals

Treat a page as suspect when it contains stale version numbers, commands that no longer exist, deprecated names, broken links, screenshots of changed UI, examples using removed fields, or instructions that conflict with current runtime behavior. Do not rewrite broad areas without evidence; make the smallest correction and record remaining drift.
