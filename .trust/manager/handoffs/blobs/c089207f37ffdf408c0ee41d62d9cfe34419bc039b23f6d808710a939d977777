# Brief — 018 unified provider routing

Dose: Standard — cross-surface provider behavior changes planning, task execution, credentials, and usage evidence.

## Outcome & success signal

Expose one honest provider catalog across Plan Studio, task/queue execution, provider management, and Usage & Limits. Every active provider that is ready for a given operation can be selected explicitly, including built-in subscription workers such as Codex and Claude and machine-stored API providers such as GLM and Gemini endpoints.

Success means the same provider identity, model, auth path, readiness state, and usage provenance are visible and consistent across all surfaces. A user can choose a ready subscription or API provider for planning and task work without the UI implying that an API-backed Codex worker is the same thing as the ChatGPT Codex subscription.

## Non-goals

- No automatic load balancing or silent provider failover in the first version.
- No provider credential migration, key rotation, or change to external billing.
- No invented quota for providers that do not expose authoritative telemetry.
- No removal of the existing explicit confirmation and local-budget gates.

## Actors & permissions

- Workspace owner selects the project default, role overrides, and feature-level provider choices.
- The browser may display masked readiness and auth metadata but never provider secrets.
- Provider calls remain behind the existing explicit planning or run confirmation gates.

## Scope

### Changes

- Create a unified provider-choice shape combining built-in workers and API registry entries while retaining distinct auth modes.
- Make Plan Studio list all eligible ready choices, including subscription Codex/Claude where the installed CLI and sign-in are ready.
- Keep queue/task routing compatible with the same provider identities and model overrides.
- Make provider management clearly distinguish built-in subscription workers from API endpoints.
- Make Usage & Limits group observations by provider and display the effective/default provider instead of the last asynchronously recorded snapshot.
- Record the selected provider identity, worker, model, and auth mode on planning and execution evidence.

### Must not change

- Existing role routing and explicit per-role overrides must remain compatible.
- Existing API provider registry storage and masked-key boundary remain intact.
- A subscription provider must not receive API-key environment variables; an API provider must not silently use the user's subscription.

## Constraints

- Codex CLI and Claude CLI have different invocation/auth contracts.
- Some provider endpoints are wire-incompatible with a worker and must remain unavailable with an actionable reason.
- Remote quota is optional and provider-specific; local sessions remain separate evidence.
- Existing uncommitted workspace changes are unrelated and must be preserved.

## Decisions · OPEN · ASSUMPTION

- **ASSUMPTION:** “Use all active providers” means make every ready provider explicitly selectable in every operation that supports its auth/worker contract; it does not imply automatic fallback or parallel dispatch.
- **OPEN 018-01:** Should built-in subscription Codex and Claude be eligible for Plan Studio model generation? Recommended: yes, with the same explicit one-session confirmation gate.
- **OPEN 018-02:** Should a project default apply to both Plan Studio and queue/task execution, with per-role and per-feature overrides? Recommended: yes; explicit feature selection wins, then role override, then project default.
- **OPEN 018-03:** Should automatic failover/load-balancing be added? Recommended: no for v1; offer explicit retry/reroute only after an owner decision.
- **OPEN 018-04:** How should subscription usage appear? Recommended: local session observations plus “remote quota unavailable” unless the CLI exposes verified provider facts.

## Acceptance examples (draft)

1. Given Codex is installed and signed in with ChatGPT, when Plan Studio opens in model mode, then Codex appears as “Codex · subscription” with its effective CLI model and can be selected.
2. Given a stored API provider uses the Codex worker, when it appears in Plan Studio, then it is labeled as “<provider> · API · Codex adapter” and is not confused with subscription Codex.
3. Given a provider is ready for queue execution but not planning, when the picker renders, then it is shown with the unsupported operation and actionable reason rather than being silently selectable.
4. Given multiple providers have fresh usage observations, when Usage & Limits renders, then it shows the effective provider and a per-provider evidence view; it never chooses the last asynchronous probe as the active provider.
5. Given a provider call is selected, when the owner has not confirmed it or the local budget is exhausted, then no provider process starts.

## Rollback story

Keep the existing provider registry and routing fields backward-compatible. If unified choices cause regressions, disable built-in providers in Plan Studio behind a feature/config flag and restore the previous API-only planning picker while retaining the evidence and labeling fixes.

## Suggested next mode

specify — resolve the four open behavior decisions and turn the unified catalog into testable contracts before implementation.
