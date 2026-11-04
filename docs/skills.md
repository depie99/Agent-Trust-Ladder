# Skill catalog

Skills are engineering instruction contracts. Installing them does not start the stateful runtime or grant remote execution authority.

## How to use a skill

Install as described in [getting started](getting-started.md), restart the agent, and invoke `$atl` with the problem. Use a specialist explicitly when its job is clear. Read its contract for prerequisites, gates, and required evidence.

## Available contracts

| Skill | Purpose | Source |
|---|---|---|
| `$agent-trust-ladder` | Evidence-gated engineering router for AI agents. Accept a raw issue or prompt, choose the smallest trustworthy stage—bootstrap, frame, specify, plan, implement, verify, audit, or trust—and run it with dose control and explicit evidence. Use as the default front door for non-trivial engineering work; skip only for trivial isolated edits that are trivially reversible. | [SKILL.md](../skills/agent-trust-ladder/SKILL.md) |
| `$atl` | Autonomous engineering workflow router. Turn a raw issue or prompt into the smallest trustworthy route—framing, specification, planning, implementation, verification, review, audit, or delivery—without requiring the user to choose a skill. Use as the default front door for non-trivial engineering work. | [SKILL.md](../skills/atl/SKILL.md) |
| `$atl-adr` | Create, review, or supersede an Architecture Decision Record when an engineering choice has durable architectural impact, meaningful trade-offs, or an expensive-to-reverse consequence. Skip ADRs for tiny isolated edits, policy-covered choices, temporary experiments, or routine implementation details. | [SKILL.md](../skills/atl-adr/SKILL.md) |
| `$atl-audit` | Audit an existing diff, pull request, or agent session and report whether it is trustworthy, conditionally trustworthy, or not trustworthy. Read-only unless fixes are requested. | [SKILL.md](../skills/atl-audit/SKILL.md) |
| `$atl-bootstrap` | Inspect an existing project and create an honest project brief and conservative starting trust policy. Use for first contact, stale project context, or major architecture change. | [SKILL.md](../skills/atl-bootstrap/SKILL.md) |
| `$atl-content-quality` | Audit and improve website content, SEO, metadata, and conversion copy with evidence-based findings. Use for SEO audits, ranking drops, title/meta reviews, local or international search issues, content refreshes, and factual site copy. Do not use for structured-data implementation or technical documentation lifecycle work. | [SKILL.md](../skills/atl-content-quality/SKILL.md) |
| `$atl-diagrams` | Create, update, review, and synchronize clean technical diagrams for architecture, flows, lifecycles, dependencies, ownership, and change impact. Use when a visual artifact materially improves comprehension or must stay aligned with engineering evidence. | [SKILL.md](../skills/atl-diagrams/SKILL.md) |
| `$atl-formal-verification` | Create and maintain a project-local formal verification skill and executable suite for one high-value invariant, state machine, concurrency property, or bounded code property. | [SKILL.md](../skills/atl-formal-verification/SKILL.md) |
| `$atl-frame` | Turn a vague engineering request into a bounded brief with explicit unknowns, constraints, acceptance examples, rollback, and an appropriate process dose. | [SKILL.md](../skills/atl-frame/SKILL.md) |
| `$atl-implement` | Execute an approved engineering plan with bounded diagnose-repair-reverify loops. Use when tasks and verifier commands are already defined. | [SKILL.md](../skills/atl-implement/SKILL.md) |
| `$atl-maintain-verification` | Maintain ATL's project-local verification skill, contract mapping, baseline checks, and mutation checks after verification-related changes. | [SKILL.md](../skills/atl-maintain-verification/SKILL.md) |
| `$atl-plan` | Map an approved software specification onto the real codebase as an impact-aware, independently verifiable implementation plan. | [SKILL.md](../skills/atl-plan/SKILL.md) |
| `$atl-specify` | Define observable software behavior and acceptance examples before implementation. Use when intent is bounded but behavior still needs an explicit human approval gate. | [SKILL.md](../skills/atl-specify/SKILL.md) |
| `$atl-team` | Coordinate multiple bounded engineering agents with explicit ownership, contracts, integration gates, evidence, and stop conditions. | [SKILL.md](../skills/atl-team/SKILL.md) |
| `$atl-tech-docs` | Create, update, review, and keep technical documentation synchronized with engineering changes. Use for new docs, stale docs, API/configuration changes, release notes, runbooks, developer guides, documentation impact during implementation, and syncing docs after a batch of code changes. | [SKILL.md](../skills/atl-tech-docs/SKILL.md) |
| `$atl-trust` | Assess or change how much autonomy an engineering agent has earned for a specific task class using recorded project evidence. | [SKILL.md](../skills/atl-trust/SKILL.md) |
| `$atl-ui-review` | Inspect and improve an implemented page or UI against its product intent, design system, interaction, responsive, accessibility, and runtime quality requirements. Use when the user asks to evaluate, critique, test, polish, or fix an existing interface and wants evidence from the real rendered artifact rather than a generic design opinion. Skip for purely greenfield visual ideation with no implemented surface, backend-only work, or formal accessibility certification. | [SKILL.md](../skills/atl-ui-review/SKILL.md) |
| `$atl-verify` | Verify implemented software with checks that actually run and produce a six-question evidence-backed trust verdict. | [SKILL.md](../skills/atl-verify/SKILL.md) |
| `$verify-atl-manager-lifecycle` | Verify ATL manager state transitions and evidence gates when runtime/lib/state.mjs or manager lifecycle behavior changes. | [SKILL.md](../skills/verify-atl-manager-lifecycle/SKILL.md) |

## Find related resources

Each skill may have references, templates, helpers, or assets. Their ownership is listed in the [file catalog](repository-map.md). See [trust vocabulary](reference.md) and [Jev routing](jev.md) for process selection.
