# Documentation verification record

This record covers the October 29, 2026 documentation refresh. It is separate from the earlier mock runtime E2E report. The documentation is locally verified against the inspected working tree; remote publication remains unobserved.

## Contract and source boundary

Mode: **Sync** under the project's `atl-tech-docs` contract, with `atl-diagrams` for visual models. Audience: developers adopting, operating, and contributing to ATL. Document types: tutorials, how-to guides, explanations, references, maintenance instructions, and evidence records.

Base Git revision: `44defc49a924222aaf9a823509ab70772d75e691`. Extensive runtime/verification changes existed before this refresh. The docs describe that working-tree overlay, not a clean release. Key implementation fingerprints are recorded in `.atl-evidence/docs-refresh/source-fingerprints.json`; the maintenance anchor is `docs/sync.yml`.

## Coverage and organization

The site has **37 public pages**, with Markdown sources registered in `docs/site.json`. Every public guide is searchable. The resource model includes core work and trust/learning ER diagrams, task and queue fields, persistent file ownership, and a task-tracing procedure. The generated file catalog inventories maintained source families and explains their purposes.

Coverage includes installation, Control Plane menus, Jira/GitHub/Azure intake, description-to-plan review, task contracts, queues, overnight execution, recovery, Ask ATL, change review, model routing, budgets, access, quota fallback, execution reports, learning, research, source maps, projects, approvals, backups, routines, and history transport. CLI, console, lifecycle, skill, and API route references are generated from their source contracts.

Seven current Control Plane screenshots show Overview, Tasks, Issue sources, Plan Studio, Queues, Agent Team, and Ask ATL. They use an isolated read-only synthetic project. [Screenshot provenance](assets/screenshots/README.md) and `assets/screenshots/captures.json` record their source, dimensions, and hashes. No production issue was fetched and no provider session was launched for captures.

Executable skills, command contracts, research decisions, and dated evidence are cataloged rather than rewritten into simplified instructions that could change their meaning. Existing public HTML routes remain stable. Historical reports retain their actual failures and dates.

## Checks that ran

| Check | Observed result |
|---|---|
| `npm ci --ignore-scripts --registry=https://registry.npmjs.org` | Clean installation from the updated lockfile passed |
| `npm run docs:build` | Generated source references, HTML, search, stylesheet, sitemap, and local Mermaid assets |
| `npm run docs:check` | Passed generated freshness, all maintained Markdown local links, public HTML links/anchors, navigation, search coverage, and required screenshots |
| `npm run docs:test` | Passed all 37 pages and 7 rendered diagrams with external requests blocked; images, search, empty results, Escape, focus restoration, Ctrl+K, copying, persistent theme, mobile navigation, and mobile ER rendering passed |
| Chrome review | Inspected page navigation, current Control Plane captures, resource diagrams, search, copy, theme, and narrow layout |
| `npm run docs:css:check` | Passed compiled stylesheet freshness |
| `npm run docs:diagrams:check` | Passed 17 retained SVG light variants |
| `node verification/package_smoke_test.mjs` | Packed distribution included required documentation/assets, excluded private state, initialized a fresh project, and served its Control Plane and assistant API |
| `npm pack --dry-run --json` | Inspected package contents, including guides, local renderer, and seven Control Plane captures; no `.trust/` or `.atl-evidence/` files |
| JavaScript syntax checks | Passed documentation generator, references, checker, preview/server, and browser modules |
| `python scripts/validate_model_routing.py` | Passed configured roster, independent-review policy, and orchestration bounds |
| `git diff --check` | Passed with the repository's normal Windows line-ending configuration |

The committed browser regression is `verification/docs_site_test.mjs`. Local evidence includes `.atl-evidence/docs-refresh/site-test.json`, `site-pages.json`, `site-failure.json`, `retrieval.json`, and desktop/mobile screenshots. Package inspection is `.atl-evidence/docs-package.json`. These local evidence paths are intentionally excluded from distribution.

## Failures and corrections

| Finding or failed attempt | Correction and lesson |
|---|---|
| Old checks covered only 11 HTML pages and omitted newer Markdown features | Scan the maintained Markdown corpus and derive public navigation/search from one manifest |
| Stale Node 18 instructions and browser/TUI confusion | Align Node requirements with package engines and give each interface an explicit guide |
| First screenshot fixture passed the wrong queue-create argument shape | Use the actual queue API signature and inspect the resulting queue before capture |
| Browser captures contained JPEG data under PNG names | Use correct extensions, validate headers, and record hashes/dimensions |
| Some navigation capture attempts did not reach the requested screen | Discard mismatched images and verify the actual heading before naming a capture |
| First build after adding a page/metadata made the catalog stale | Include manifest-declared outputs before they exist; build then check now passes deterministically |
| Draft feature map named nonexistent verifiers | Trace references to actual source/test files before treating the map as current |
| Named-queue syntax was incorrectly described as a top-level CLI capability | Separate top-level CLI help from browser/terminal console commands and generate both references |
| Draft ER cardinality implied every task had a plan and every plan had an imported issue | Make those references optional and distinguish task sessions from shared planning calls |
| Headless Escape test failed, then still timed out after waiting for closure | Fix explicit Escape handling while the search input has focus; verify close and focus restoration in Chrome and the regression |

The failed browser attempt remains recorded even though the final run passed. The useful lesson is to verify the full reader interaction, not only the page's ability to render.

## Retrievability and editorial review

Chrome search found the intended guide for **Jira**, **Azure**, **queue**, **Ask ATL**, **model**, **resource policy**, and **lifecycle**. Empty search results show a recovery message. Shared navigation and page outlines provide alternative entry points.

New workflow guides were reviewed for audience, purpose, correctness, prerequisites, procedure, expected outcome, recovery, traceability, discoverability, and maintenance ownership. Editorial score: **19/20**, with traceability **1/2** because the source boundary includes an uncommitted overlay; the other dimensions scored **2/2**. This is an editorial assessment, not a correctness proof.

## Remaining limits and maintenance

### Version 0.1.3 publication preflight

The release candidate combines these guides with the runtime and synthetic verifiers they describe. Local manager state, credentials, private run artifacts, and machine-specific `config/manager.json` changes are excluded from the commit. The repository's committed configuration is used for the release checks.

The October 29 publication regression first passed 90 of 92 checks. The source-intake browser test exposed a late settings response replacing an editable form; loading now completes before showing the form, and background snapshot/stream updates preserve unsaved source inputs. A regression explicitly checks preservation after focus leaves the field. The documentation clipboard assertion also ran before its asynchronous operation completed; it now waits for the observed copied state. Both original failures remain recorded under `.atl-evidence/mock-regression/` locally. Publication status must be checked in GitHub Actions and the package registry; this local record does not predict a remote result.

A fresh detached checkout with the committed configuration then passed **92/92 mock regressions**, the full-operation fixture, the lifecycle model and mutation test, and model-routing validation. Static documentation validation passed against **158 committed Markdown files**, **37 public pages**, and **3,182 local links**. The earlier count of 161 included three local Markdown artifacts outside the release. Fresh-checkout testing also caught line-ending drift and links to private local evidence; checkout rules now keep generated text reproducible, and local artifact paths are explicitly labeled rather than published as broken links. The CSS checks pass for both the site and Control Plane. Private evidence and local settings remain outside the release.

- Pages and package workflows were updated locally; no push, release, remote CI run, package publication, or Pages deployment was performed.
- External links were not checked live. Installed provider protocol compatibility, real model quality, production connector access, and production delivery were not tested by this documentation refresh.
- The browser checks cover documentation behavior; they do not replace the runtime's feature verifiers or the earlier recorded mock E2E exercise.
- The full site is English. The Persian entry guide is refreshed and links to canonical English procedures.

Edit Markdown and the page manifest, regenerate, run static and browser checks, then advance `docs/sync.yml`. Follow [documentation workflow](documentation.md) and [development](development.md). A future source change must invalidate or update the affected claims before this record is reused as current evidence.
