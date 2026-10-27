# docs/scss — color-coded design tokens for the ATL docs site

Every color on the site is a token specified in BOTH themes. No component
partial contains a hex literal; they reference `var(--token)` only.

```text
scss/
  styles.scss        entry point — @use order = cascade order, do not reorder
  _tokens.scss       emits theme maps as :root / html.light custom props
  themes/
    _dark.scss       dark theme (default) — exact shipped values
    _light.scss      light theme — light-optimized mirror, same 54 keys
  _base.scss         reset, element defaults, skip link, :root font
  _shell.scss        sidebar, nav, topbar, buttons, theme-toggle glyph
  _home.scss         marketing page sections
  _dialog.scss       search dialog + backdrop
  _responsive-core.scss  home-page breakpoints, reduced motion
  _layout-fix.scss   sidebar grid/flex fix (load-bearing comments inside)
  _docs-content.scss shared docs content components
  _pages.scss        multi-page surfaces, chooser, codex preview, terminals
```

## Build

```powershell
npm install              # once; sass is a devDependency
npm run docs:css         # docs/scss/styles.scss -> docs/styles.css
npm run docs:css:check   # fails if docs/styles.css is stale vs the source
```

`docs/styles.css` is committed because GitHub Pages serves `docs/` as plain
static files. Pages cache-bust with `?v=N` — bump `styles.css?v=` (and
`app.js?v=` when app.js changes) in all nine HTML pages after a rebuild.

## Rules

1. **No hex literals outside `themes/`.** A component needs a new color?
   Add the token to `themes/_dark.scss` AND `themes/_light.scss` (the build
   errors if the maps diverge), then use `var(--token)` in the partial.
2. **Dark values are frozen.** `_dark.scss` holds the exact colors the site
   shipped with; change them only with an explicit visual decision.
3. **Cascade order is load-bearing.** `styles.scss` `@use`s partials in the
   original stylesheet's order; equal-specificity rules resolve by source
   order, so never reorder the imports.
4. **Theme switching is `html.light`.** The per-page `<head>` script applies
   `light` before first paint (stored choice, else `prefers-color-scheme`);
   app.js toggles the class and persists it. The toggle glyph is CSS-only
   (`#theme-toggle::before`) so it is correct even before app.js runs.
