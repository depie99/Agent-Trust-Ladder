# Spec — 018 unified provider routing

From: brief.md · Status: draft

## Behavior

1. The runtime builds one provider-choice catalog from:
   - ready built-in subscription workers discovered on the machine, such as Codex and Claude;
   - configured API providers from the machine registry.
   Each choice has a stable id, display label, worker, model, auth mode, readiness, supported operations, and actionable unavailable reasons.

2. Plan Studio loads the catalog when model mode is opened.
   - 2a. A ready subscription worker is displayed as `<label> · subscription`.
   - 2b. A ready API provider is displayed as `<provider label> · API · <worker adapter>`.
   - 2c. A provider that is not ready or does not support planning is visible but disabled with its reason.
   - 2d. If no provider supports planning, model mode remains disabled and the UI explains how to make one ready; local preview remains available.

3. When the owner selects a provider and model in Plan Studio, the generated planning request records the exact provider choice, worker, model, and auth mode.
   - 3a. Subscription choices invoke their native signed-in CLI path and never receive API-provider credentials.
   - 3b. API choices invoke their configured worker adapter with the stored credential context and never fall back to subscription credentials.
   - 3c. The request remains behind explicit confirmation and the existing one-session/15-minute planning budget.

4. Queue and task execution resolves provider choice in this order:
   feature-specific explicit choice → role override → project default → safe built-in default.
   The resolved choice is shown in preview and persisted in run evidence.

5. Provider management shows built-in subscription workers and API providers in the same surface, but keeps their auth and credential controls distinct.
   - 5a. Built-in workers expose installation/sign-in/recheck state and no API-key fields.
   - 5b. API providers expose masked readiness, endpoint/model controls, and safe key replacement.
   - 5c. Changing a default does not silently change an explicit feature or role override.

6. Usage & Limits displays provider-scoped evidence.
   - 6a. The primary card uses the effective project provider, not the last asynchronously written snapshot.
   - 6b. A provider list or detail view shows the newest snapshot per provider and its source, confidence, age, and quota status.
   - 6c. Subscription providers show local session observations and “remote quota unavailable” unless verified remote telemetry exists.
   - 6d. API providers show verified quota only when a provider-specific adapter returns authoritative data; otherwise the value is Unknown.

7. No automatic failover or load balancing occurs.
   - 7a. A failed provider call reports the selected provider and actionable failure.
   - 7b. Retrying with another provider requires an explicit owner selection or reroute decision.

## Rules (normative)

- Provider identity and auth mode are separate fields; the worker name alone must never identify the billing/auth path.
- Readiness is operation-specific. A provider may be ready for queue execution but unavailable for Plan Studio, or vice versa.
- All provider secrets remain outside the repository and are never returned by browser APIs.
- Explicit confirmation remains mandatory for model planning and provider execution.
- Unknown remote quota must remain Unknown and must not block work by itself.
- Existing provider registry ids, project defaults, and role overrides remain backward-compatible.
- Repeated catalog refreshes and usage refreshes are idempotent with respect to configuration; usage history may append observations but must group them deterministically by provider.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| Codex is installed and signed in with ChatGPT | Plan Studio model mode opens | `Codex · subscription` is selectable with its effective CLI model |
| `solico-glm` is stored as an API provider using the Claude adapter | Plan Studio model mode opens | It appears as `solico-glm · API · Claude adapter`, separate from subscription Codex |
| A Gemini endpoint uses the Codex adapter | The provider picker renders | It is labeled as an API provider and never presented as subscription Codex |
| A selected subscription provider is confirmed for planning | The request starts | The native CLI runs without API-provider environment variables |
| A selected API provider is confirmed for planning | The request starts | The configured adapter runs with that provider’s credential context |
| A provider is not signed in or lacks an API key | The catalog loads | It remains visible but disabled with an actionable reason |
| A role override selects provider B while project default is provider A | A queue preview is opened | The preview shows provider B and the run evidence records provider B |
| Two providers have recent usage snapshots, with provider B written last | Usage & Limits opens | The primary provider follows the effective default, and both providers have separate evidence |
| A provider has no supported quota adapter | Usage refresh completes | Quota is shown as Unknown with provenance, never estimated |
| A provider call fails | The owner retries | No other provider is used unless the owner explicitly selects it |

## Out of scope

- Automatic provider selection based on price, latency, quota, or health.
- Automatic failover, retries across providers, or parallel provider execution.
- Provider-specific remote quota integrations beyond existing supported adapters.
- Changing the external provider registry format or moving secrets into project state.

## OPEN / ASSUMPTION

- **DECIDED:** Built-in subscription Codex and Claude are eligible for Plan Studio when their native CLI is installed and signed in.
- **DECIDED:** Project default applies across surfaces unless a feature-specific or role-specific override exists.
- **DECIDED:** Automatic failover/load-balancing is excluded from v1.
- **DECIDED:** Subscription quota remains unknown unless verified; local observations are shown separately.
- **ASSUMPTION:** A native CLI can perform the bounded Plan Studio request with the same prompt/schema contract used by API-backed planning. This must be proven during planning/implementation and may require an adapter-specific invocation contract.

