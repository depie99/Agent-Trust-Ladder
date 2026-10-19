---
name: atl-tech-docs
description: Create, update, review, and keep technical documentation synchronized with engineering changes. Use for new docs, stale docs, API/configuration changes, release notes, runbooks, developer guides, and documentation impact during implementation.
---

# ATL technical documentation

Treat documentation as part of the product and the change surface, not as cleanup after code ships. This skill owns documentation discovery, content design, source alignment, authoring, and doc-specific verification; ATL still owns dose, authority, lifecycle, and the final trust verdict.

Read only the references needed for the request:

- [content-model.md](references/content-model.md) when choosing a document type or information architecture;
- [writing-guide.md](references/writing-guide.md) when drafting or editing prose;
- [maintenance-workflow.md](references/maintenance-workflow.md) when docs must track a code/config/API/operational change;
- [verification.md](references/verification.md) when validating examples, links, generated output, or freshness;
- [research-basis.md](references/research-basis.md) when explaining why these conventions were selected.

## Route

1. **Define the doc contract.** Identify the audience, user goal, prerequisite knowledge, scope, non-scope, expected outcome, language/localization needs, and the source of truth.
2. **Discover before drafting.** Inspect repository instructions, docs conventions, navigation, generated-doc boundaries, existing terminology, the relevant diff/issue, and the commands the project actually provides. Never invent a docs command.
3. **Decide the change.** Return one of: `no doc change`, `update existing`, `create new`, `deprecate/redirect`, or `needs-owner-decision`. Prefer updating the canonical page over creating a duplicate.
4. **Choose the content shape.** Classify the page as tutorial, how-to, reference, explanation, quickstart, troubleshooting, release note, or a project-specific equivalent. Do not mix user goals casually; split pages when one page serves conflicting needs.
5. **Trace technical truth.** Compare claims, commands, configuration, API shapes, examples, screenshots, links, and version/status statements against the current implementation and deployment contract. Mark anything not directly observed as `OPEN` or `ASSUMPTION (source)`.
6. **Write for use.** Lead with the reader's goal and result, use scannable headings and ordered steps, keep one idea per paragraph, define unfamiliar terms, use consistent terminology, and show a working example before optional detail.
7. **Verify the artifact.** Run the repository's available docs/build/lint/link/example checks. Where available, use Markdown linting for structure, Vale or an equivalent for prose style, a link checker for URLs, and executable checks for code examples. If a check is unavailable, report it rather than replacing it with a claim.
8. **Review the diff.** Check scope, navigation, links, accessibility text, localization impact, generated-file ownership, terminology drift, stale claims, and whether the docs change belongs in the same implementation/release change.
9. **Return an evidence packet.** Include the doc contract, files changed, source-of-truth observations, checks run, skipped checks, unresolved freshness/ownership gaps, and the next safe action.

## Change-lifecycle rule

When a code, API, schema, configuration, deployment, security, or operational change affects what a user or engineer must know, perform a documentation-impact check in the same workflow. Documentation may be updated before, during, or immediately after implementation, but it must not be silently deferred when the change is shipped.

For generated documentation, edit the generator/source and regenerate; do not hand-edit generated output unless the repository explicitly owns it that way. For versioned or public interfaces, verify the version, compatibility, migration, deprecation, and release-note story.

## Stop conditions

Stop and report `needs-owner-decision` when audience, supported behavior, source of truth, public compatibility, localization authority, or publication ownership is materially unclear. Do not make documentation look certain when the implementation or runtime contract is unknown.

For a tiny isolated copy/comment change with no user-facing contract or documentation surface, return `no doc change` and let the parent ATL route remain Direct.

## Output

End with: `doc decision`, `audience/goal`, `content type`, `files changed`, `technical claims verified`, `checks run`, `checks unavailable`, `freshness/ownership gaps`, and whether the documentation is `current`, `conditionally current`, or `not verified`.
