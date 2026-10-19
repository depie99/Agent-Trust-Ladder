# Documentation verification

Use the smallest credible set for the changed risk. Discover commands from repository instructions, package manifests, CI, and existing scripts; never invent them.

| Claim or artifact | Evidence to seek |
|---|---|
| Markdown structure | project docs build or Markdown linter |
| Voice, terminology, inclusive language | project style checker, Vale, or focused editorial review |
| Links and redirects | project link checker or lychee-equivalent |
| Code/API examples | execute the example, contract test, typecheck, or generated example check |
| API/reference completeness | schema/spec comparison or generated-doc diff |
| AI retrievability | section self-containment review: sample sections, confirm each answers its heading alone; examples paste and run |
| UI instructions/screenshots | real rendered surface at supported states/viewports |
| Operational/runbook steps | safe rehearsal, command dry run, or owner confirmation |
| Version/migration claims | release metadata, changelog, compatibility test, or deployment observation |

## Authoring rubric

Apply only to new pages and substantial rewrites; routine edits take the normal checks, not the rubric.

Score each dimension 0 (missing), 1 (partial), 2 (met): audience fit, task success, content-type discipline, accuracy against source, structure and scannability, example quality, terminology consistency, AI retrievability, maintenance cost, style fit.

Publishable: no dimension at 0 and total ≥ 16/20. Below that, repair the failing dimensions or return `conditionally current` with the failing dimensions named.

## Evidence packet

```markdown
# Documentation evidence — <change>

## Doc decision
no doc change | update existing | create new | deprecate/redirect | needs-owner-decision

## Mode
author | sync | audit

## Contract
- Audience / goal:
- Content type:
- Scope / non-scope:
- Source of truth:

## Files and claims
- <file>: <claim changed> — <source observation>

## Checks run
- `<command>` — <environment> — <result>

## Skipped or unavailable
- <check> — <reason and consequence>

## Review
- Rubric: <n>/20, new/substantially rewritten pages only — failing dimensions: <none or list>
- Retrievability: <pass/fail and what failed>

## Sync anchor
- <established at / advanced to / not applicable> — <revision>

## Freshness and ownership gaps
- <gap or none>

## Verdict
current | conditionally current | not verified
```

A docs build or prose lint cannot prove technical correctness. A code diff cannot prove that the documentation is discoverable or usable. Report both axes.
