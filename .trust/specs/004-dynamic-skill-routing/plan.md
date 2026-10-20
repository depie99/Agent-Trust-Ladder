# Plan — 004 dynamic skill routing
Spec: approved 2026-10-20 · Dose: Standard

## Approach and key decisions

Add a repository-local skill registry consumed by the ATL manager. Pip will score the incoming task against declared intent keywords and labels, persist the selected local skills and proposed worker, and expose the route during triage. Mira remains the authority for worker assignment; the router only recommends and records evidence-backed intent matches.

Decision: keep routing configuration separate from `config/manager.json` so skill ownership can evolve without changing task budgets or intake adapters.

Decision: verify skill availability from the repository before selecting it; unavailable entries are reported as skipped rather than silently routed.

Decision: add a root npm manifest for reproducible installation of the ATL CLI and its skill/runtime bundle. Do not duplicate runtime files into a second package tree.

## Impact

Expected changes:

- `config/skill-routing.json` — declarative intent-to-skill registry.
- `runtime/lib/skill-router.mjs` — matching, availability checks, and route explanation.
- `runtime/lib/state.mjs` — persisted route fields on tasks.
- `runtime/lib/render.mjs` — show selected skills and proposed worker in task/brief views.
- `runtime/atl-manager.mjs` — route at intake, print route during triage, and expose `route` command.
- `runtime/lib/roles.mjs` — specialist ownership metadata for routed skills.
- `package.json` — installable CLI/package metadata and exported team capability.
- `README.md` and `runtime/README.md` — usage and routing contract.

Breakage risk: false-positive routing could select an inappropriate specialist. Containment is advisory routing only: it never bypasses Pip's objective/check gate, Mira's assignment authority, Sage review, or Beacon verification. Existing tasks without route fields remain valid.

## Pre-mortem

- False positive keyword match → detected by the route explanation and triage review → clear or override the selected route before assignment.
- Skill directory missing or renamed → detected by availability checks and explicit skipped entries → fall back to the native ATL route and report the missing skill.
- Route state becomes stale after triage edits → detected by recomputing the route from the task packet at `triage` → persist the refreshed route before the next gate.

## Constitution compliance

Complies with ATL ownership and evidence rules: routing is advisory, no worker gains merge/deploy authority, and every route is persisted in the manager decision trail. No external skill is installed or fetched.

## Tasks

- [x] T1 Add the skill registry and router — files: `config/skill-routing.json`, `runtime/lib/skill-router.mjs`, `runtime/lib/state.mjs` — verify: `node --check runtime/lib/skill-router.mjs` and direct route probes — done: content, diagram, implementation, and fallback inputs returned expected routes.
- [x] T2 Integrate routing into intake, triage, rendering, and role metadata — files: `runtime/atl-manager.mjs`, `runtime/lib/render.mjs`, `runtime/lib/roles.mjs` — verify: `node runtime\\atl-manager.mjs validate` — done: state/config validation passed and route fields are persisted without automatic worker assignment.
- [x] T3 Add package/install metadata and documentation — files: `package.json`, `README.md`, `runtime/README.md` — verify: `python scripts\\validate_model_routing.py`, `node --check runtime/atl-manager.mjs`, `npm pack --dry-run` — done: CLI, team export, router, config, and skills are included in the package preview.
- [x] T4 Run integrated checks and inspect the diff — files: all changed files — verify: `git diff --check`, syntax checks, and model-routing validation — done: all checks passed and no manager state files were modified.

## Verification plan

Use a temporary isolated ATL project/state for route behavior where possible. Verify content, docs, diagram, UI, implementation, and unknown inputs; assert selected skills, proposed worker, unavailable-skill reporting, and no automatic assignment. Run static checks and model-routing validation on the repository.
