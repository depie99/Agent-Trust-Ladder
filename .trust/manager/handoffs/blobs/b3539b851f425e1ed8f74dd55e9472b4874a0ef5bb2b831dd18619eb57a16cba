# Brief — Claude subscription-only execution

## Problem

ATL's Claude worker invokes `claude -p`. Claude Code can use either a
claude.ai subscription or Anthropic API credentials. If
`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` is present, Claude Code prioritizes
those credentials and the run can become pay-as-you-go API usage even when the
user owns a Claude subscription.

## Desired outcome

An ATL user can explicitly run the Claude worker in subscription mode without
ATL forwarding known API credentials into that child process. If the user is
not authenticated with the intended claude.ai subscription, the run must fail
closed rather than silently use API billing.

## Constraints

- Keep the existing provider-neutral `claude -p` adapter.
- Preserve an explicit API mode for users who knowingly choose pay-as-you-go.
- Do not store, print, or mutate API secrets in the repository.
- Do not change the unrelated overnight lifecycle behavior.
