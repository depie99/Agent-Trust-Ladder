# Documentation verification

Use the smallest credible set for the changed risk. Discover commands from repository instructions, package manifests, CI, and existing scripts; never invent them.

| Claim or artifact | Evidence to seek |
|---|---|
| Markdown structure | project docs build or Markdown linter |
| Voice, terminology, inclusive language | project style checker, Vale, or focused editorial review |
| Links and redirects | project link checker or lychee-equivalent |
| Code/API examples | execute the example, contract test, typecheck, or generated example check |
| API/reference completeness | schema/spec comparison or generated-doc diff |
| UI instructions/screenshots | real rendered surface at supported states/viewports |
| Operational/runbook steps | safe rehearsal, command dry run, or owner confirmation |
| Version/migration claims | release metadata, changelog, compatibility test, or deployment observation |

## Evidence packet

```markdown
# Documentation evidence — <change>

## Doc decision
no doc change | update existing | create new | deprecate/redirect | needs-owner-decision

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

## Freshness and ownership gaps
- <gap or none>

## Verdict
current | conditionally current | not verified
```

A docs build or prose lint cannot prove technical correctness. A code diff cannot prove that the documentation is discoverable or usable. Report both axes.
