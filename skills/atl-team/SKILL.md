---
name: atl-team
description: Coordinate multiple bounded engineering agents with explicit ownership, contracts, integration gates, evidence, and stop conditions.
---

# ATL Team Orchestration

Use this skill for work large enough to benefit from parallel agents or a sustained agent loop. A team is not a pile of prompts: it is a set of independently owned slices that integrate through explicit contracts and evidence.

When the user asks which models are available or wants quality per token optimized, investigate the current harness and repository policy before assigning roles. This skill owns the team contract, routing, and integration gates; it must not invent provider access or model availability.

## Manager mode

The user is the manager of the digital team. ATL should make that feel real:

Default roster (configurable in `config/model-routing.json`):

- **Mira** — coordinator / chief of staff; keeps the whole picture moving.
- **Pip** — intake and triage; turns incoming noise into bounded tasks.
- **Rowan** — builder; implements, debugs, and runs focused checks.
- **Sage** — reviewer; challenges the work with independent judgment.
- **Beacon** — verifier / night watch; revisits finish checks and surfaces blockers.

- give each active worker a name/role, mission, status, owner, and next checkpoint;
- keep the user at the portfolio level: priorities, decisions, blockers, risk, and outcomes;
- let the coordinator handle routing, context gathering, follow-ups, review requests, and evidence collection;
- surface exceptions and decisions, not every internal thought or tool call;
- produce a concise morning brief: shipped, in progress, blocked, needs decision, evidence, and recommended next moves.

The coordinator may keep working through a bounded loop, but it is not allowed to become an unreviewed manager with unlimited authority. Merge, deploy, spend, external messaging, destructive operations, and policy changes remain human decisions unless explicitly authorized for that task class.

## Runtime

`runtime/atl-manager.mjs` is the persistent state machine behind this roster: task queue, role contracts, transition gates, evidence, blockers, wake loop, and the manager brief. Its state lives in `.trust/manager/state.json`, so a restarted session resumes instead of re-deriving. A session acting as Mira, Pip, Rowan, Sage, or Beacon loads its contract with `node runtime\atl-manager.mjs role <name>` and records every action through the runner (`update`, `move`, `assign`, `workspace`, `block`, `evidence` flags). The runner rejects out-of-contract actions — that rejection is the contract working. Every action is also narrated to a chat-style team feed (`feed`): grabs, triage verdicts, kicks, Running cards, review verdicts, done cards. Declared `routines` apply Mira's routing policy at intake and auto-kick a worker the moment triage lands. Intake adapters cover a local markdown inbox, GitHub issues, and Azure Boards iterations; see `runtime/README.md`.

## Overnight contract

An overnight or unattended run needs a written handoff before it starts:

```text
Objective:
Complete when:
Allowed actions:
Forbidden actions:
Workspace / branch:
Checks and evidence:
Wake / revisit condition:
Stop and escalate when:
Morning report location:
```

Duration is not a completion condition. The loop revisits the finish checks, preserves a decision trail, stops on unresolved blockers or exhausted budgets, and leaves work isolated and reviewable. If the runtime cannot persist or wake the work, say so and provide a handoff rather than pretending the run will continue.

## Route by fitness, then review independently

Use the repository's model policy when one exists. The default role split is:

- implementation, refactoring, debugging, and fast iteration → code/ execution model;
- ambiguous architecture, tradeoffs, and hard judgment → reasoning/ judgment model;
- reading, comparison, synthesis, and structured analysis → analysis model;
- brainstorming and alternative approaches → ideation model.

These are capabilities, not claims about a vendor. Record the exact model and version actually used. Never let the first model both implement and certify its own work when an independent reviewer is available. The normal loop is:

`route → plan → implement → independent review → fix/iterate → verify → log`

The first model must restate the goal, propose an approach, list files/changes, call out risks and unknowns, and wait for the applicable gate before implementation. A reviewer receives the diff and evidence, not merely the implementer's conclusion.

## Team contract

Before dispatch, write a compact team brief containing:

- destination and success signal;
- one owner for scope/spec, one owner per slice, one integrator, and one verifier;
- task boundaries with non-overlapping write sets;
- dependencies and the ready frontier;
- interface/schema assumptions and who may change them;
- per-slice verifier and integration verifier;
- retry budget, timeout, escalation owner, and rollback/containment;
- whether agents may commit, open a PR, merge, deploy, or only prepare changes.
- model role, exact model/version, tool access, and independent reviewer assignment.

Never use shared assumptions as proof. Parallel work is allowed only when slices can be reviewed and verified independently.

## Operating loop

1. Frame the destination and acceptance examples.
2. Split by stable ownership boundaries, not by arbitrary file count.
3. Dispatch only tasks whose prerequisites are satisfied.
4. Require each worker to return changed files, evidence, open questions, and contract effects.
5. Integrate through the named owner; resolve conflicts against the approved contract, never by silently choosing the most recent edit.
6. Run independent verification on the integrated result, including negative cases and relevant formal invariants.
7. Stop at the first missing authority, contradictory contract, repeated failure, or exhausted budget.
8. Record the route, model/version, reviewer, evidence links, outcome, and next improvement in the run log.

## Quality gates

The team is not complete when workers report “done.” It is complete only when:

- every task has an observed verifier result;
- the integrated diff has no scope leaks or unowned files;
- cross-slice contracts are checked at the consumer boundary;
- the original acceptance behavior is observed;
- skipped or unavailable checks are explicit; and
- the final six-question ATL verdict names residual risk and the next safe action.
- the reviewer is independent in model, context, or both; if not, disclose the limitation.

## Failure handling

Retry only with new evidence or a materially different hypothesis. A worker that fails twice on the same failure class escalates with the exact output and recommended safe default. Do not let one worker edit another worker's slice without transferring ownership and recording the reason.

## Handoff

Return the team brief, task graph, ownership map, worker evidence, integration result, unresolved items, and final route state. Use `atl-verify` for the evidence packet and `atl-trust` for any autonomy decision.
