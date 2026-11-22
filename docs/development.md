# Development and verification

Make a bounded change, run a verifier that observes its behavior, and record results and limits. Preserve unrelated modifications and use synthetic projects for remote or destructive workflows.

## Set up

Use Node.js 22+, Git, and Python for policy/formal checks.

```sh
npm ci
node --check runtime/atl-manager.mjs
python scripts/validate_model_routing.py
npm run docs:check
```

Browser tests need the project’s Playwright browser: `npx playwright install chromium` downloads it into the development environment.

## Choose meaningful checks

Use the [feature map](guides.md) to find the implementing source and verifier. Most feature checks are standalone Node programs under `verification/`. Read their setup before invoking them; a test name alone does not establish isolation.

```sh
node verification/plan_contract_test.mjs
node verification/resource_policy_test.mjs
node verification/issue_source_journey_test.mjs
```

State-owner behavior has its own verifiers: `node verification/daemon_test.mjs`, `node verification/state_concurrency_test.mjs`, `node verification/session_auth_test.mjs`, and `node verification/lease_test.mjs`.

For the wider offline exercise, run `node verification/run_mock_regression.mjs`. See [verification README](../verification/README.md) for formal checks and the [recorded mock run](mock-system-e2e-2026-10-29.md) for evidence and limits.

## Record evidence

Record command, revision/dirty overlay, exit code, output, fixture scope, failures, remedies, and final result. Fixture worker success demonstrates orchestration; real provider behavior needs separate evidence. Never record credentials — runtime records are redacted before reaching disk (secrets masked, home and project paths mapped to `~` and `<project>`), but that is a safety net, not permission to paste secrets.

## Validate documentation and package

```sh
npm run docs:build
npm run docs:check
npm run docs:css:check
npm run docs:diagrams:check
npm run docs:test
npm pack --dry-run --json
```

Inspect runtime, skills, docs, license, and accidental private state in the package listing. Local checks do not publish a package or deploy Pages. Their configured GitHub workflows perform those actions after authorized triggers: **Deploy ATL docs** on pushes to `main`, and **Publish ATL package** on `v*` tags. Every push and pull request also passes the **Guard private and runtime data** workflow (tracked-path policy plus gitleaks), and the local pre-commit hook runs the same checks on staged files.

## Release

```sh
npm run plugins:build -- --out dist/plugins-<version>
npm run release:verify
npm run release:ship -- --dist dist/plugins-<version>
```

`release:verify` runs the release parity gate. `release:ship` checks the dist version against `.codex-plugin/plugin.json`, mirrors the bundle into the local marketplace cache, relinks harness profiles, reinstalls the bundled `atl` CLI, and re-runs the parity gate. Publishing remotely happens only through the tagged **Publish ATL package** workflow.

## Contribute

Follow source contracts and migrations, add meaningful behavior checks, and update the corresponding guide. Pull requests target `main` (`develop` is stale); every merge passes the runtime, documentation, data-guard, and skills workflows on the PR. Explain resulting behavior, validation, and remaining risks in review. Use [documentation workflow](documentation.md) for docs changes.

## Validate documentation and package

```sh
npm run docs:build
npm run docs:check
npm run docs:test
npm pack --dry-run --json
```

Inspect runtime, skills, docs, license, and accidental private state in the package listing. Local checks do not publish a package or deploy Pages. Their configured GitHub workflows perform those actions after authorized triggers.

## Contribute

Follow source contracts and migrations, add meaningful behavior checks, and update the corresponding guide. Explain resulting behavior, validation, and remaining risks in review. Use [documentation workflow](documentation.md) for docs changes.
