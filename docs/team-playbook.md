# Team playbook

ATL supports a team of agents when the work has real seams. Start with a team brief, assign one owner per write set, and integrate through contracts rather than shared context.

Use [`model-routing.json`](../config/model-routing.json) to separate implementation, judgment, analysis, content-quality, and ideation roles. The policy is deliberately vendor-neutral: configure exact accessible models and retain a reviewer that differs from the worker when possible.

The minimum handoff for every worker is:

```text
Changed files:
Verifier and observed result:
Contract effects:
Open questions:
Rollback / containment:
```

For SEO and site-copy work, add the fact ledger, target audience, search or business goal,
baseline, review window, and any unavailable browser/Search Console evidence. Pip owns the input
contract, Rowan owns the approved content surface, Sage independently reviews claims and intent,
and Beacon rechecks the rendered result and agreed measurements.

Install `.githooks/pre-commit` once per checkout:

```text
git config core.hooksPath .githooks
```

It invokes `scripts/check_staged_token_budget.py` as a pre-commit guard for agent-authored files. It checks staged content only, estimates tokens as bytes/4, and ignores lockfiles, generated output, vendored code, and build products.

```text
python scripts/check_staged_token_budget.py
```

The guard is a maintainability boundary, not a correctness proof. Oversized files should be split by responsibility into cohesive, independently testable modules.
