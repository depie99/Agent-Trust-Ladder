# ATL automatic routing

This reference defines how ATL chooses a route when the user provides only a raw issue, prompt, or goal. The user should not need to name a skill.

## Decision procedure

1. Extract the requested outcome, current state, affected surface, authority implied by the request, and evidence already supplied.
2. Inspect the project enough to distinguish facts from assumptions: instructions, git state, manifests, commands, CI, trust artifacts, and the relevant diff or runtime surface.
3. Classify prompt readiness and risk. Do not let a confident sentence substitute for acceptance behavior, rollback, or runtime evidence.
4. Select exactly one primary playbook. Add specialist skills only for a named gap that the playbook does not cover.
5. Run only as far as the next gate permits. Carry the returned artifact forward; never infer completion from a tool or specialist's completion claim.
6. Set a context budget before loading detail: `minimal` for Direct, `focused` for Standard, and `expanded` only for Critical or unresolved boundary risk.

## Context loading policy

| Budget | Load | Do not load by default |
|---|---|---|
| `minimal` | local instructions, target files, selected verifier, one relevant route row | full skill catalog, unrelated references, broad repository scans |
| `focused` | minimal set plus primary playbook, selected specialist, callers/contracts/tests named by the impact | every mode, every project document, unrelated test suites |
| `expanded` | focused set plus rollback, external boundary, runtime, CI, and independent review evidence required by risk | still exclude unrelated domains and duplicate copies |

If the route changes, replace the stale detail rather than accumulating every candidate route. If a skipped source could materially change the verdict, record it as `OPEN`; otherwise do not load it merely for completeness.

## Route by strongest signal

| User input or project signal | Primary route | Add or hand off to | Entry artifact / stop condition |
|---|---|---|---|
| Vague goal, symptom, or underspecified issue | Investigation or Bug fix | `atl-frame` | bounded brief with unknowns, acceptance, rollback, and dose |
| Intent is bounded but observable behavior is missing | Feature, Bug fix, or Investigation | `atl-specify` | approved observable spec and acceptance examples |
| Behavior is approved but callers, files, boundaries, or verifiers are unmapped | matching playbook | `atl-plan` | impact-aware plan with independent verifiers |
| Approved plan and authorized change | matching playbook | `atl-implement` | bounded diff plus repair/reverify record |
| Code or artifact exists and the question is “does it work?” | Verify or Delivery | `atl-verify` | checks that actually ran and evidence-backed verdict |
| Existing diff, PR, merged change, or agent session needs trust assessment | Review or Investigation | `atl-audit` when available; otherwise native review | read-only findings, risk, evidence gaps, and verdict |
| User asks for code quality/spec fidelity on a known diff | Review | available code-review specialist | separate spec, standards, and runtime findings |
| Implemented UI needs critique or repair on the real surface | UI review and repair | `atl-ui-review` | observed surface findings and re-observed repairs |
| First contact, stale project context, or major architecture change | Bootstrap | `atl-bootstrap` | honest project brief and conservative trust policy |
| User asks what autonomy is earned or whether the agent may do more | Trust | `atl-trust` | task-class evidence and policy decision |
| A durable architecture or system-design choice needs its “why” recorded | Architecture decision | `atl-adr` | ADR or explicit no-ADR rationale, with owner, status, consequences, and verifier |
| Configuration/build/package/deployment/external service boundary | relevant route | contract-to-runtime evidence gate | contract ledger and level-specific evidence |

When multiple rows match, use this precedence: safety/authority gate → existing-work audit/review → missing intent/specification → missing repository plan → implementation → verification/delivery. A boundary gate is additive and never replaces the primary playbook.

## Direct versus staged handling

Use `Direct` only when the request is specific, isolated, reversible, low-risk, and has an obvious verifier. Use `Standard` when one or more of framing, specification, planning, implementation, or verification is needed. Use `Critical` for production, auth, privacy, payments, migrations, destructive operations, external services, or unclear rollback.

Token budget follows dose: Direct uses minimal context, Standard focused context, and Critical expanded context only around the actual risk boundary. A large prompt or large repository does not by itself justify loading everything.

For a simple local-only UI copy or style edit with a named file, clear desired text/style, no contract boundary, and an available check, do not impose the deployment gate or a full architecture workflow. Still inspect local instructions, make the smallest change, and run the proportionate check.

For a production build/auth/package issue, route through the relevant investigation or delivery playbook, create the contract ledger, inspect the artifact consumer, and require runtime evidence or report the result as conditional.

For a cross-layer persistence bug, route through bug-fix tracing even if the initial symptom sounds like a UI issue. Require producer payload → transport/schema → route adapter → domain workflow → persisted state → user-visible result, compatibility cases, and re-observation of the original failure.

## Forward-test examples

- “The login callback works locally but production redirects incorrectly after the build pipeline changed.” → delivery/investigation plus contract ledger, artifact-consumer inspection, and deployed callback observation.
- “The selected store jumps back after clicking a new seller.” → bug fix plus cross-layer trace, legacy/new identifier matrix, missing-reference case, and user-visible re-observation.
- “Change this button label from Save to Apply in the isolated settings component.” → direct local edit and proportionate check; no deployment gate.
- “The PR is merged and typecheck is green; is it safe?” → audit/verify, with merged status treated as context rather than behavioral proof.
