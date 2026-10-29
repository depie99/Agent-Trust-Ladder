# Documentation styles

The current website has one stylesheet source: `styles.scss`, compiled to `docs/site.css`. It contains semantic light/dark tokens, the responsive documentation shell, article content, search dialog, and print rules.

## Build and verify

```sh
npm run docs:css
npm run docs:css:check
```

`npm run docs:build` also compiles the stylesheet. Edit SCSS, not generated CSS. Browser behavior is in `docs/site.js`; theme choice uses the `data-theme` attribute and persists locally.

The two files under `themes/` preserve the earlier SVG illustration palette referenced by `scripts/make-diagram-light-variants.mjs`. They are historical diagram design references rather than a second website theme system. Check those assets with `npm run docs:diagrams:check`.
