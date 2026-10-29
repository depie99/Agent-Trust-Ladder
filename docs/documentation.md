# Documentation workflow

Markdown is the editable source for public guides. A generator produces the GitHub Pages HTML and section search index. The package also includes the guides for local reading.

## Find the source

| Resource | Edit or inspect |
|---|---|
| Guide text | `.md` source in `docs/site.json` |
| Navigation and titles | `docs/site.json` |
| HTML rendering | `scripts/build-docs.mjs` |
| Style and interaction | `docs/scss/styles.scss`, `docs/site.js` |
| Mermaid | Fenced blocks in each guide |
| Current screenshots | `docs/assets/screenshots/` |
| Verification boundary | `docs/sync.yml`, [refresh record](docs-refresh-verification.md) |
| Historical evidence | Existing dated reports/planning records |

Do not hand-edit generated top-level HTML, `search-index.json`, or `vendor/mermaid.min.js`. Existing public routes remain stable. Historical reports preserve their actual dates, failures, and limits.

## Add or change a guide

1. Identify one reader goal and implementing source.
2. Add prerequisites, steps, expected results, and recovery.
3. Use relative Markdown links inside the repository.
4. Add public pages to `docs/site.json`.
5. Build, check, and inspect desktop/mobile rendering and search.
6. Advance the sync anchor only for checks that ran.

```sh
npm run docs:build
npm run docs:check
npm run docs:serve
```

Open the printed localhost URL. Search needs HTTP; `file:` browsing can prevent loading its index. Stop preview with Ctrl+C.

## Maintain diagrams and captures

Keep a diagram focused on one question and explain its relationships in prose. Mermaid uses a local pinned bundle with strict settings. Label conceptual models separately from literal fields. See [diagram library](diagrams.md).

Run `node scripts/docs-preview.mjs` for an isolated, read-only synthetic Control Plane. Navigate and capture actual rendered screens. Record date, fixture, viewport, and limitations. Keep production task data and provider secrets out of captures.

## Verify and publish

`npm run docs:check` checks generated freshness, source links, HTML links/anchors, search coverage, assets, and catalog consistency. Browser review separately checks rendered diagrams, search, theme, and responsive navigation.

Run `npm run docs:test` for the offline browser regression. It checks every public page and exercises search, empty results, keyboard focus, code copying, persistent theme, mobile navigation, and ER diagrams. External network requests are blocked. Its evidence is written to `.atl-evidence/docs-refresh/` and retained by the documentation CI workflow.

Pages builds and checks before uploading `docs/`. Package publication checks docs first. Local build/check commands do not publish remotely. Confirm GitHub workflow results after an authorized push or release.
