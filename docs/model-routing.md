# Model routing and review

ATL treats model choice as an engineering policy, not a prestige ranking. Route by the work:

The default digital team has friendly names as well as explicit responsibilities: **Mira** coordinates, **Pip** triages, **Rowan** builds, **Sage** reviews, and **Beacon** verifies and keeps watch. Names are configurable; the role contract is what matters.

| Work | Preferred role | Required handoff |
| --- | --- | --- |
| implementation, refactor, debugging | `code` | plan, changed files, checks |
| architecture, ambiguity, tradeoffs | `judgment` | decision, alternatives, risks |
| reading, comparison, synthesis | `analysis` | cited findings and open questions |
| SEO, metadata, and factual site copy | `content` | source-backed copy and acceptance evidence |
| exploration and alternatives | `ideas` | candidate approaches and constraints |

The policy lives in [`config/model-routing.json`](../config/model-routing.json). Replace `configure-me` with models the team actually has access to, then run:

```text
python scripts/validate_model_routing.py
```

The default loop is:

```text
route → plan → implement → independent review → fix/iterate → verify → log
```

The reviewer should use a different model or an intentionally independent context. If that is impossible, disclose it in the evidence packet and do not treat the result as an independent review.

The default orchestration is deliberately conservative: one worker, then one independent review. Parallel workers are capped at three and are allowed only when their write sets are disjoint. Repair cycles are capped at two before escalation. These limits live in the `orchestration` section of the policy.

Keep run records in `.trust/agent-runs/` using the template there. Record exact model/version, tools, rationale, evidence links, outcome, and what should change in the playbook next time.

## Apply routing to a task

Inspect provider readiness in Settings, then preview the task's effective model and route. The role policy above is distinct from the adaptive runtime model pool. [Resource policy](resource-policy.md) controls capability tiers, allowances, cost ordering, and eligible fallback; [execution reports](execution-reports.md) explain the observed history used for calibration.

Do not infer real-world model quality from a tier label or fixture result. Record configured selections, observed sessions, current verification, and any missing usage before changing policy.
