# Plan — 009 installable ATL package

Spec: approved 2026-10-21 · Dose: Standard

Tasks:

- [ ] T1 Verify package metadata and file inclusion — files: `package.json`, `scripts/install.mjs` — verify: `npm pack --dry-run` — done when expected package contents are observed.
- [ ] T2 Verify project adapter separation — files: `runtime/atl-manager.mjs`, `scripts/install.mjs`, `.gitignore` — verify: `node runtime/atl-manager.mjs init` in a disposable directory — done when only project state is scaffolded.
- [ ] T3 Verify publish contract without publishing — files: `.github/workflows/publish-package.yml`, `README.md`, `USAGE.md` — verify: `git diff --check`; workflow inspection — done when no local command publishes.
