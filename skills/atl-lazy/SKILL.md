---
name: atl-lazy
description: Create or compress ATL implementation plans into concise developer checklists with one line per task, preserving scope, acceptance coverage, dependencies, impact, verification, risk, rollback, and approval gates. Use when a compact or low-token engineering plan is requested.
---

# ATL Lazy

Produce a plan that an agent can execute unambiguously and a developer can scan comfortably. Optimize for both audiences: plain task sentences first, exact execution details in a compact reference in the same document. Brevity means removing repetition, not removing meaning. Match the user's language; keep paths, commands, and contract identifiers exact. This is a planning workflow; return the plan without starting implementation.

## Preserve the contract

- Inspect repository instructions, protected work, relevant code/callers, spec, and actual verifier configuration. Read only decision-changing sources; never invent files, commands, approval, or evidence.
- For a new implementation plan, require approved behavior; if missing, mark the plan DRAFT and identify the unresolved intent. Critical work cannot pass this gate without approval. When compressing an existing plan, preserve its status and all unresolved items.
- Preserve scope, acceptance examples, interfaces, data/migrations, dependencies, rollout, rollback, standing rules, exceptions, and required gates. Mark unknowns `OPEN`; mark unverified claims `ASSUMPTION (source)`.
- Critical plans require explicit human approval before implementation, test-first behavior tasks, and an ADR for constitution exceptions. Compression never grants authority or waives checks.
- A command in a plan is proposed verification, not evidence it ran. Keep failures and unverified claims visible. End at a real missing decision or authority boundary; do not invent approval requests.

## Compress once

1. Reuse existing IDs and source links. For a new plan, assign stable acceptance IDs (A1...), task IDs (T1...), and verifier IDs (V1...). Preserve original acceptance meaning, including edge/error cases; do not replace it with vague summaries.
2. Record the approach and only consequential decisions: `choice; why; alternative`. Name changed files and unchanged callers/contracts at risk. Record constitution compliance or exact exceptions.
3. Keep the three most likely failure modes, each one line: `failure -> detection -> rollback`. Do not manufacture risks to fill a quota; explain when fewer apply.
4. Order tasks for early feedback: foundation, acceptance behaviors, polish. Each task has one plain-language outcome sentence. Its matching execution-reference row supplies prerequisites, exact target paths, acceptance coverage, verifier, and an observable done condition. Together they form the complete task contract. Put a failing behavior check first where feasible; mandatory for Critical work.
5. Give shared commands once in a verifier legend, with working directory and expected result. Each execution-reference row references its verifier ID; include the task-specific test target when a shared suite alone would be ambiguous. Use exact commands found in the project. If unavailable, mark `OPEN` and the needed discovery; never claim the task is execution-ready.
6. Write one canonical compact plan at the project's established location (otherwise `plan.md`). For an existing plan, preserve unique constraints and evidence links; respect machine-readable schemas and external consumers rather than breaking them for brevity. Keep the task checklist and execution reference visibly in the same plan. Store each fact once and connect them by task ID; do not generate two competing plans or hide essential details behind collapsed sections or additional files.

## Output shape

Use flat sections. Each checklist task is one short, natural sentence stating the change and observable behavior; a developer should understand it without decoding IDs or opening the execution reference. Keep file lists, dependency labels, and command IDs out of checklist sentences unless essential to understanding the change. Use a compact execution-reference table keyed by task ID for agent precision. Avoid nested bullets, jargon, cryptic abbreviations, repeated prose, and implementation pseudocode. These are a format guide, not literal placeholder content:

```markdown
# Plan: <goal>
Status: <DRAFT/approved + source/date> | Dose: <level> | Spec: <path> | Scope: <in; out>
Acceptance: A1 <observable behavior>; A2 <observable behavior>
Approach: <brief approach>. Decisions: <choice; reason; alternative>.
Impact: change <paths>; at risk <callers/contracts>; data <migration/none>; rollout <method>; rollback <action>.
Rules: <compliance or exception link>. OPEN/ASSUMPTION: <items or none>.

## Risks
- <failure> -> <detection/V-ID> -> <rollback>

## Tasks
- [ ] T1 <plain sentence: what changes and what the user/developer will observe>.
- [ ] T2 <plain sentence: next independently verifiable outcome>.

## Execution reference
| Task | After | Files | Acceptance | Check | Done when |
| --- | --- | --- | --- | --- | --- |
| T1 | none | <exact paths> | A1 | V1 | <observable result> |
| T2 | T1 | <exact paths> | A2 | V2 | <observable result> |

## Checks and gates
V1: `<exact command>` | cwd: <path> | expect: <result>
V2: `<exact command>` | cwd: <path> | expect: <result>
Gate: <required approval/evidence>. Stop: <actual blocker or boundary>. Next: <safe action>.
```

Aim for roughly 250-500 words for an ordinary plan; scale with real scope. Never omit a necessary constraint to meet a word or line target. If a task sentence becomes dense, move execution metadata to its reference row or split independently verifiable outcomes. Retain behavior, boundary cases, and contract semantics; never replace them with vague verbs such as handle, improve, or fix. Add a short explicit constraint when essential; clarity takes priority over a one-line target.

Before returning, check that every acceptance example has task coverage, dependencies resolve without cycles, each task and its reference row jointly have all required fields, each checklist sentence is understandable on its own, verifiers are grounded, and approval/risk/rollback information survived compression. Report only plan path, task count, unresolved blockers, and next safe action; do not repeat the plan in chat.
