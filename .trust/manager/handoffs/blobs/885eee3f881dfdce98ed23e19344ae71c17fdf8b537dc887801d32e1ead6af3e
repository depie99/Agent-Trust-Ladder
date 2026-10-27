# Brief — 001 coherent constraint system

Dose: Standard — this changes how every mode composes policy, intent, risk, verification, and autonomy, but it does not itself authorize production or irreversible actions.

## Outcome & success signal

Turn Agent Trust Ladder from a collection of good instructions into one coherent control system.

Success means a fresh agent can take any task and deterministically answer:

1. Which constraints apply to this task?
2. Where did each constraint come from, and who may change it?
3. What happens when two constraints conflict?
4. Which gate is currently blocking progress?
5. What observable evidence satisfies that gate?
6. What decision and evidence must be carried into the next mode?
7. What autonomy is allowed now, and what event revokes it?

The design should embody the useful lessons from Spotify's agent platform: consistent golden paths, discoverable ownership and context, executable guardrails with immediate feedback, orchestration separated from code modification, and human judgment concentrated at consequential decisions.

## Non-goals

- Build a workflow engine, hosted service, dashboard, or CI product.
- Claim that documentation alone proves a project or agent is trustworthy.
- Make all repositories use the same technologies or verification commands.
- Remove human approval from intent, policy, security, production, or irreversible decisions.
- Require every task to traverse every mode or create every artifact.
- Raise any task class's autonomy as part of this change.

## Actors & permissions

- **Human owner**: owns product intent, risk appetite, exceptions, and irreversible decisions.
- **Repository owner**: owns standing project constraints, architecture boundaries, and required checks.
- **Agent**: discovers applicable constraints, proposes decisions, performs authorized work, collects evidence, and stops at unsatisfied gates.
- **Verifier**: produces observations; it does not grant authority and may itself be untrusted or incomplete.
- **Reviewer**: independently evaluates evidence when the task policy requires separation of duties.

Only an authorized owner may weaken or waive a constraint. The agent may select stricter behavior without additional authority when doing so remains inside the requested scope.

## Scope

### What changes

- Add one canonical constraint-composition model used by every mode.
- Expose each mode as its own discoverable skill (`atl-bootstrap`, `atl-frame`, `atl-specify`, `atl-plan`, `atl-implement`, `atl-verify`, `atl-audit`, `atl-trust`) while retaining `agent-trust-ladder` as the optional router for users who want automatic mode selection.
- Define constraint sources, applicability, precedence, conflict handling, waiver rules, evidence requirements, and lifecycle.
- Define a compact task state passed between modes so decisions do not become silent assumptions.
- Make every mode declare its input gate, output contract, stop conditions, and evidence contribution.
- Align dose, risk, autonomy, approval, verification, and retry rules so they cannot independently authorize work.
- Add checks/examples that demonstrate positive, negative, conflict, stale-evidence, and downgrade paths.
- Update user-facing documentation so the system model is understandable without reading every mode.

### What must not change

- One invocation still runs one mode.
- Direct work remains lightweight.
- Existing `.trust/` artifacts remain understandable or receive an explicit migration story.
- A higher autonomy level never overrides task risk, required approval, scope, or a failed gate.
- Passing checks never substitutes for approved intent.

## Constraints

### Proposed composition rules

1. **All authority is conjunctive.** Work may proceed only when scope authorization, applicable policy, current task state, and required evidence all allow it. No single green signal is sufficient.
2. **Safety takes the stricter result.** When applicable constraints disagree about risk, approval, verification, retry, or autonomy, the more restrictive result governs until an authorized owner resolves the conflict.
3. **Specificity cannot defeat authority.** A task-specific instruction may refine a standing rule but may not weaken a higher-authority rule without an explicit, owned waiver.
4. **Evidence cannot grant permission.** Tests can satisfy a verification obligation; they cannot approve intent, expand scope, or authorize deployment.
5. **Autonomy is a ceiling, not a command.** Effective autonomy is the minimum allowed by task-class policy, task risk, environment, available verification, and current evidence freshness.
6. **Unknowns fail closed only where consequential.** An unknown blocks the affected action when it can change behavior, exposure, irreversibility, or the acceptance test; otherwise it is recorded and work may continue.
7. **Every exception is typed and expires.** A waiver records the exact constraint, owner, rationale, scope, compensating control, and expiry/revalidation trigger.
8. **Every transition preserves provenance.** Facts, decisions, assumptions, open items, approvals, evidence, and waivers retain their source and status across modes.

### Proposed source precedence

Apply only sources relevant to the task, then resolve conflicts in this order:

1. Platform and safety limits
2. Explicit human authorization and prohibitions
3. Repository/project constitution and ownership rules
4. Approved task specification and recorded decisions
5. Approved technical plan and task contract
6. Mode procedure and skill defaults
7. Agent inference

Within the same authority level, use the stricter applicable constraint and escalate unresolved semantic conflicts. Later does not automatically mean higher authority.

### Quality constraints

- The core model must fit in one reference file and be usable without loading the full skill.
- Each normative term has one definition; modes link to it rather than restating divergent versions.
- Examples must include at least: a normal Standard task, a Critical task, a policy/spec conflict, unavailable verification, expired evidence, and a regression-triggered downgrade.
- The system must distinguish `PASS`, `BLOCK`, `ESCALATE`, and `NOT_APPLICABLE`; absence of a failure is not a pass.
- Rules intended as guardrails should name an observable check or explicitly state that enforcement is human review only.

## Decisions

- D-001: Treat trust as a property of the whole decision-and-evidence chain, not of the model or generated code.
- D-002: Use constraint composition and typed gates as the system spine; keep the five-question Trust Verdict as the human-facing result.
- D-003: Concentrate human review on intent, exceptions, residual risk, and irreversible actions; automate repeatable checks where they are credible.
- D-004: Prefer repository-specific golden paths and executable feedback over generic advice.
- D-005: Internal mode files are implementation detail, not a user-facing invocation surface. Each meaningful mode needs independent skill metadata so a user can explicitly select only that workflow in Codex; slash-command files remain optional adapters for runtimes that actually support custom commands.

## OPEN

- OPEN-001 (human owner): Is the primary deliverable an improved installable Markdown skill, or should it also include a machine-readable policy/schema and validator? Recommended default: Markdown skill plus a small machine-readable schema/validator contract, because prose-only constraints cannot prove they compose.
- OPEN-002 (human owner): Should the router and eight independently invocable mode skills ship in one plugin/package? Recommended default: yes, with one shared canonical reference tree so wrappers do not duplicate policy.
- OPEN-003 (human owner): Is backward compatibility with existing `.trust/` artifacts mandatory? Recommended default: yes; additive fields first, with explicit migration only where ambiguity cannot be avoided.
- OPEN-004 (human owner): What is the first target runtime: Codex skills only, or agent-neutral behavior across Codex, Claude Code, and other skill-compatible agents? Recommended default: agent-neutral semantics with thin runtime-specific commands.
- OPEN-005 (human owner): Should enforcement stop at self-checks, or must CI be able to reject invalid task state? Recommended default: define CI-checkable contracts now, implement repository-local validation as a later bounded slice.

## ASSUMPTION

- ASSUMPTION-001 (repository contents): `skills/agent-trust-ladder/` is the source of truth; top-level guides and command wrappers are derived documentation/entry points.
- ASSUMPTION-002 (user wording): “all constraints work together” means deterministic composition, traceability, and conflict handling—not simply adding more rules.
- ASSUMPTION-003 (Spotify article): the relevant transferable ideas are standardization, discoverable context/ownership, active guardrails, orchestration, and risk-focused human review; copying Spotify's internal tooling is out of scope.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| a feature task has an approved spec and passing tests but lacks a required privacy review | the agent evaluates the delivery gate | the result is `BLOCK`, and passing tests do not authorize delivery |
| task policy allows L4 but the relevant verifier is unavailable | the agent computes effective autonomy | autonomy is reduced to the highest level supported by current evidence, with the missing verifier named |
| a task-specific plan conflicts with the repository constitution | the plan mode evaluates constraints | it chooses a compliant approach or returns `ESCALATE`; it does not silently prefer the newer plan |
| two same-authority constraints disagree | the agent resolves the gate | the stricter applicable rule governs temporarily and the semantic conflict is surfaced to its owner |
| a low-risk documentation edit satisfies Direct-dose conditions | the agent evaluates required artifacts | it proceeds without manufacturing a brief/spec/plan, while preserving repository and user constraints |
| a prior successful task class later regresses | trust is reassessed | the affected autonomy is paused or downgraded, the ledger records why, and unrelated task classes are unchanged |
| evidence has passed its declared revalidation trigger | the agent evaluates a new task | stale evidence cannot satisfy the gate until revalidated |
| a Codex user wants only specification work | they explicitly invoke `atl-specify` | only the specify workflow and its required shared references load; no slash command or prior router invocation is required |

## Rollback story

Keep the redesign additive until its examples and consistency checks pass. New composition rules should live in one reference file and be linked from modes; reverting that file plus the small mode-link changes restores current behavior. Do not rewrite existing user artifacts in place. Any later schema migration must retain the original files and provide a reversible conversion.
