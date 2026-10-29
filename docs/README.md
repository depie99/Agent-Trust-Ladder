# Documentation

Start with [overview](overview.md), [getting started](getting-started.md), or the [feature map](guides.md). The [resource model](resource-model.md) explains records and relationships; the [file catalog](repository-map.md) explains source ownership.

## Maintain the docs

Edit Markdown, register public pages in `site.json`, and run:

```sh
npm run docs:build
npm run docs:check
npm run docs:serve
```

Read [documentation workflow](documentation.md) for diagrams, screenshots, search, package inclusion, and Pages. HTML and `search-index.json` are generated.

## Evidence and historical records

[Documentation refresh](docs-refresh-verification.md) records current checks. [Mock system E2E](mock-system-e2e-2026-10-29.md) records synthetic execution and its limits. Earlier intake reports, recovery drills, issue logs, launch copy, and the Control Plane brief are historical evidence/design records, not current operator procedures. Preserve dates and failures.

Skill contracts and research decisions remain in their owning directories. Use the file catalog rather than duplicating their instructions here.
