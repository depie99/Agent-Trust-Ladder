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

## Sync anchor

Record the docs sync point so the next update diffs from a real boundary instead of guessing. After checks pass, store — in the repository's preferred format and location, or a minimal file such as `docs/sync.yml` when none exists — the doc set covered, the primary audience, and the revision (commit, tag, or release) the docs were verified against.

On a sync request covering a batch of changes:

1. Diff code, configuration, API, and operational surface from the anchor revision to the requested one.
2. Triage each change: `doc edit`, `no doc impact`, or `OPEN` with a reason. Do not silently drop a change.
3. Update affected doc families in order — entry point, task pages, reference, release notes — one family per proposal when the diff is large, so the owner reviews reviewable chunks.
4. Run the checks, then move the anchor forward to the verified revision.

If no anchor exists, establish one at the revision verified during this change and say so in the evidence packet.

## Generated references

Generate API references from the schema or spec (OpenAPI or equivalent) rather than hand-maintaining them; review the generated diff and hand-write only the surrounding prose. Edit the generator or source and regenerate; never patch generated output by hand unless the repository explicitly owns it that way.

## Freshness signals

Treat a page as suspect when it contains stale version numbers, commands that no longer exist, deprecated names, broken links, screenshots of changed UI, examples using removed fields, or instructions that conflict with current runtime behavior. Do not rewrite broad areas without evidence; make the smallest correction and record remaining drift. Prefer deleting outdated content over caveating it — a hedge that says "this may be stale" is itself stale content.
