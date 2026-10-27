# Spec — 006 Claude subscription-only worker auth

From: brief.md · Status: approved by explicit implementation request · 2026-10-21

## Behavior

1. When the user runs `atl run` or `atl overnight` with `--worker claude
   --auth subscription`, ATL validates the auth mode and launches the local
   Claude Code print-mode command.
2. Before the child starts, ATL removes known Anthropic API/provider override
   variables from that child environment, including `ANTHROPIC_API_KEY` and
   `ANTHROPIC_AUTH_TOKEN`.
3. The parent shell and the user's stored credentials are not changed.
4. If Claude Code is not already authenticated with the user's claude.ai
   subscription, the child exits with an error and ATL records a failed worker
   session; ATL never retries that failure as API mode.
5. When the user explicitly selects `--auth api`, ATL preserves the API
   environment and documents that the run is pay-as-you-go/API-billed.
6. Documentation tells the user to authenticate with the Claude account and
   verify `/status` before running ATL. It distinguishes subscription usage
   from API usage and does not claim ATL can prove the remote billing account.

## Rules

- Subscription mode is the default for the Claude worker.
- API mode must be explicit; no automatic fallback is allowed.
- ATL must never log credential values.
- The change is limited to the Claude child-process auth boundary and its
  documentation/tests.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| Claude subscription auth is selected and the shell contains `ANTHROPIC_API_KEY` | Start a Claude worker | The child receives no known API credential; the parent environment is unchanged |
| Claude subscription auth is selected and both API variables are absent | Start a Claude worker | ATL invokes local `claude -p` with the subscription-safe environment |
| API auth is explicitly selected | Start a Claude worker | API variables are preserved and the run is clearly classified as API mode |
| Subscription auth is selected but the Claude account is not logged in | Start a worker | The process fails; ATL does not retry with API credentials |
| Any auth mode is invalid | Parse the command | ATL rejects it before spawning Claude |

## Out of scope

- Implementing `claude --cloud` dispatch or synchronizing cloud branches/PRs
  into ATL state.
- Controlling Anthropic's server-side billing or subscription quota.
- Automatically logging a user into Claude or collecting credentials.
- Removing API support entirely.

## OPEN / ASSUMPTION

- OPEN: Claude Code does not expose a documented non-billing preflight API that
  lets ATL independently prove the selected account. The user-facing `/status`
  check remains required evidence.
- ASSUMPTION (official Anthropic help): removing API credential environment
  variables prevents the known environment-variable override; Claude Code's
  stored login still determines whether subscription auth is available.
