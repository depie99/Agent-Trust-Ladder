# Plan — 006 Claude subscription-only worker auth

Spec: approved 2026-10-21 · Dose: Standard

## Approach and key decisions

- Decision: keep `claude -p` and sanitize only the spawned child environment in
  subscription mode. Rationale: `-p` is the supported non-interactive Claude
  Code entry point; the billing failure is credential precedence.
- Decision: preserve API mode behind `--auth api`. Rationale: provider-neutral
  ATL should not remove an explicitly requested integration.
- Decision: fail closed on missing/incorrect subscription login and document
  `/status`. Rationale: ATL cannot verify Anthropic's server-side account
  without making a model request.

## Impact

Change `runtime/lib/worker.mjs`, `runtime/atl-manager.mjs` only as needed for
the auth boundary, add focused worker tests, and update the runtime/team usage
docs. No state schema or cloud adapter changes.

## Pre-mortem

- API key still reaches child → test the exact spawned environment with a fake
  process → rollback only the env-sanitization helper if unrelated providers
  are affected.
- User thinks a subscription login is guaranteed → docs and final verdict mark
  `/status` as required external evidence → stop at conditional validity.
- API mode is accidentally sanitized → test explicit API mode preserves the
  variables → rollback the mode branch, not subscription protection.

## Tasks

- [ ] T1 Add a child-environment policy for Claude subscription/API modes — files: `runtime/lib/worker.mjs`, `runtime/atl-manager.mjs` — verify: `node verification/worker_test.mjs` — done when the subscription child environment removes known API/provider variables and API mode preserves them.
- [ ] T2 Add regression coverage for the billing boundary — files: `verification/worker_test.mjs` — verify: `node verification/worker_test.mjs` — done when both modes and invalid auth are observed.
- [ ] T3 Update setup/runtime guidance — files: `runtime/README.md`, `USAGE.md`, `docs/team-playbook.md`, `docs/team.html` — verify: `rg -n "subscription|ANTHROPIC_API_KEY|/status|claude -p" ...` — done when users have exact safe commands and the unknown account-auth boundary is explicit.
- [ ] T4 Run the focused and repository verification suite — files: no new source scope — verify: `node verification/worker_test.mjs`; `python scripts/maintain_verification_skill.py`; `node runtime/atl-manager.mjs validate`; `git diff --check` — done when all run here and results are recorded.

## Verification plan

Static syntax, focused auth-policy tests, dry-run command shape, existing ATL
manager lifecycle/formal/learning checks, state/config validation, and diff
whitespace integrity. Live Claude subscription billing remains unavailable in
this environment and is reported separately.
