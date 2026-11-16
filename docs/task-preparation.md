# Task preparation: from assigned work to a plannable brief

Every assigned Azure task in My Tasks carries a **preparation state** next to the existing review and approval gates: **Needs investigation**, **Needs your answer**, **Ready to plan**, **Not prepared**, or **Historical**. The state is derived from a persistent, per-task preparation record — never from a provider call — so the preview renders from saved content and survives refresh, restart, and provider failure.

Open a task and use the **Preparation** tab to work on it. The brief captures the understood outcome, existing behavior, requested behavior, scope, and acceptance examples, with an explicit **Save brief**. A short AI review is reused as intake context when one exists; a review that ran without code evidence is kept as an explicit limitation instead of passing for code knowledge.

## Questions stay separated

Questions are recorded with a kind:

- **Owner decision** — a product choice only the requester can make. One open owner decision puts the task in *Needs your answer*.
- **Investigation** — answerable by reading code or asking the team. Open investigation questions keep the task in *Needs investigation*.

Answer a question with a suggested option button or free text. Answers are saved to the record and are never guessed. "Follow existing code" triggers investigation; it never establishes a missing behavior contract.

## Bounded discovery

**Run bounded discovery** sends exactly one bounded provider request — the brief plus the linked repositories — and stores the returned code locations, findings, and any raised questions on the record. The provider is checked for readiness before any spend; a refusal names the problem and no request is sent. A failed or timed-out run is recorded with its error; the brief is never blanked. Runs carry the brief revision they observed, so a later brief edit marks older runs as *ran against an earlier brief* while keeping their content readable.

## Handoff into Plan Studio

**Hand off to Plan Studio** creates (or reuses — repeated handoffs never duplicate) the imported request for the task, with the brief as the objective, acceptance examples as completion checks, and the task's repositories linked. Model planning from that request unlocks only when the preparation is *ready* — every consequential question answered — and the Azure task has not changed since preparation (otherwise the lock names both revisions and the recovery step). Preparation states never replace the plan review and approval gates; approval still requires a passed, current plan review.

Historical (Done) work is inventoried with a Historical chip and no record is opened for it. Active tasks are seeded automatically from their saved source content, so even a title-only task shows an honest, empty brief with a next action instead of a blank panel.

## HTTP interface

All mutations use the existing Control Plane owner/CSRF boundary.

| Method and path | Behavior |
| --- | --- |
| `GET /api/my-tasks/preparations` | Inventory: per-task state, next action, repositories, request/plan linkage, counts. Seeds active tasks. |
| `GET /api/my-tasks/preparation?key=…` | Record, derived status, freshness, run currency, linked request. |
| `POST /api/my-tasks/preparation/save` | Saves brief fields and next action; revision-guarded (409 on conflict). |
| `POST /api/my-tasks/preparation/question` | Adds an owner-decision or investigation question. |
| `POST /api/my-tasks/preparation/answer` | Answers a question; empty answers are refused. |
| `POST /api/my-tasks/preparation/investigate` | `mode:"manual"` stores notes; `mode:"discovery"` runs the bounded provider request. |
| `POST /api/my-tasks/preparation/handoff` | Idempotent handoff into Plan Studio; returns the request id. |

Records live under `.trust/manager/my-tasks/preparations/` in the project-local store. Azure stays read-only throughout.

Verification: `verification/task_preparation_store_test.mjs`, `verification/task_preparation_api_test.mjs`, `verification/task_preparation_ui_journey_test.mjs`, plus the fetch regression in `verification/my_tasks_fetch_test.mjs`.
