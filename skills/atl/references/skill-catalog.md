# Skill capability catalog

This catalog describes optional routing. Availability must be confirmed from current skill metadata before use.

## Intent and context

| Need | Preferred specialist | Native fallback |
|---|---|---|
| Project truth and safe starting posture | `atl-bootstrap` | inspect and write only the required project context |
| Bounded request | `atl-frame` | concise outcome/non-goals/constraints/acceptance brief |
| Deep interactive clarification | `grill-with-docs` or `grilling` | ATL frontier questions with recommended defaults |
| Shared domain language | `domain-modeling` | glossary plus invariants in the ATL spec |
| Huge ambiguous destination | `wayfinder` | bounded decision map; no premature implementation |

## Design and planning

| Need | Preferred specialist | Native fallback |
|---|---|---|
| Observable behavior | `atl-specify` or `to-spec` | ATL spec-lite with explicit intent gate |
| Repository impact plan | `atl-plan` | callers/contracts/data/rollback plus verifier per task |
| Architecture boundary or interface | `architect`, `codebase-design`, or `how` | compare alternatives against constitution and failure modes |
| Contested design | `arena` or `interrogate` | explicit alternatives and falsifying evidence |
| Executable task graph | `to-tickets` | ordered ATL tasks with prerequisites and exact verifiers |
| Durable architecture decision | `atl-adr` | decide whether an ADR is warranted; record alternatives, consequences, lifecycle, and fitness evidence |
| Technical documentation lifecycle | `atl-tech-docs` | create/update docs from audience and source-of-truth contracts; verify examples, links, style, and freshness |
| Architecture, flow, lifecycle, ownership, or impact visual | `atl-diagrams` | model relationships, create an accessible SVG/HTML/Excalidraw artifact, and separate visual communication from behavioral proof |
| Implemented UI quality and repair | `atl-ui-review` | inspect the real rendered surface; separate visual, interaction, responsive, accessibility, and runtime evidence |

## Implementation and diagnosis

| Need | Preferred specialist | Native fallback |
|---|---|---|
| One approved slice | `atl-implement`, `implement`, or `tdd` | bounded diagnose-repair-reverify loop |
| Whole approved task graph | `implement-spec` | sequential ATL implementation unless safe isolation is proven |
| Hard bug | `diagnosing-bugs` or PStack bug-fix playbook | reproduce → minimize → hypothesis → instrument → repair → regression check |
| Measured performance issue | PStack perf/hillclimb playbook plus `benchmark-checklist` | baseline, hypothesis, controlled measurement, accepted/rejected result log |
| Large coordinated program | PStack `orchestrate`/`swarm` only when available and authorized | split into independent bounded tasks; no pretend parallelism |
| Formal invariant, state-machine, concurrency, or bounded code property | `atl-formal-verification` | write a bounded executable model, mutation check, and explicit scope ledger |
| Multi-agent team or long-running coordinated work | `atl-team` | explicit ownership map, non-overlapping write sets, integration gate, and bounded retries |

## Verification and delivery

| Need | Preferred specialist | Native fallback |
|---|---|---|
| Evidence packet and objective verdict | `atl-verify` | run smallest credible checks and report gaps separately |
| Existing diff/PR audit | `atl-audit` | five-question read-only verdict |
| Spec and standards separation | `code-review` | two separate review passes; aggregate without masking either axis |
| Runtime proof | `principle-prove-it-works` or project verification skill | observe the real artifact, not a proxy |
| Blast radius | `blast-radius` | callers, contracts, data, security, operations, rollback |
| PR communication | `pr` | concise summary, evidence, and merge-danger statement |
| Earned autonomy | `atl-trust` | no advancement; report evidence needed next |
| Page/UI acceptance | `atl-ui-review` | state-and-viewport coverage with evidence-backed repair loops |

## Selection rules

1. Prefer a repository-local specialist already configured for the project.
2. Prefer a narrower skill over a general mode when one technique is sufficient.
3. Do not invoke two skills that own the same concern unless they are deliberately independent review axes.
4. Do not install, update, or fetch a third-party skill merely because it appears here. Installation requires the user's request or approval through the normal installer workflow.
5. External skills never replace ATL authority, evidence, or autonomy gates.
