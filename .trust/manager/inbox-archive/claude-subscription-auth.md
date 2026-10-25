## Make ATL Claude execution subscription-safe
@priority: high
@risk: normal
@labels: auth,billing,claude,atl

Ensure ATL's Claude worker uses the user's Claude subscription rather than
accidentally forwarding Anthropic API credentials that cause pay-as-you-go
charges. Keep API mode available only when explicitly selected, and document
the login/status check required before running.

Checks:
  - subscription mode removes known Anthropic API/provider override variables from the child environment
  - explicit API mode preserves API credentials and is not silently selected
  - invalid auth is rejected before spawning a worker
  - documentation explains claude.ai login, /status, claude -p, and the billing boundary
