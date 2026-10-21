# Brief — 014 interactive task control room

Dose: Standard → Critical boundary — task creation is local and reversible, but agent dispatch crosses provider, authentication, workspace, and model-spend boundaries.

## Outcome & success signal

Give the human manager one terminal control room where they can:

1. write a task in natural language;
2. import read-only candidates from GitHub Issues or Azure Boards;
3. have ATL/Pip normalize each candidate into the canonical ATL task model;
4. inspect and edit the generated objective, completion checks, priority, risk, route, and source;
5. explicitly select which bounded tasks may enter execution;
6. preview the provider, role, workspace, budget, and auth mode before launch;
7. watch each agent session, handoff, review, verification, blocker, and evidence in the same UI.

Success means a human can create one task, see the exact canonical task packet before execution, select it, approve a dry-run preview, and observe the chosen local provider execute only inside the task workspace while ATL state remains authoritative.

## Non-goals

- No silent autonomous launch from task creation or import.
- No direct write-back to GitHub or Azure in the first slice; intake remains read-only.
- No connection to a Codex Desktop conversation or hidden background agent session unless an explicit adapter is designed and verified.
- No merge, push, deploy, external message, or spend authorization through the UI.
- No replacement of `state.json`, the existing lifecycle gates, or the role contracts.

## Actors & permissions

- Human manager: creates/imports drafts, edits the proposed ATL packet, selects execution candidates, approves a launch preview, blocks/escalates, and can override through existing manager commands.
- Pip: turns a draft/candidate into one bounded objective plus observable completion checks; owns `new -> triaged`.
- Mira: assigns the ATL role worker; owns `triaged -> assigned` and the manager brief.
- Rowan: implements only in the isolated workspace and records evidence; owns the build handoff.
- Sage: independently reviews the diff and evidence.
- Beacon: verifies every completion check and preserves the outcome.
- Provider adapter: launches a local Codex CLI or Claude Code process; it is not an ATL role and does not receive state authority.

## Scope (what changes / what must not change)

### In scope

- A dashboard task composer for free-form input and source selection.
- A normalized candidate/draft path that reuses the existing intake model and `createTask` fields.
- A review screen showing the canonical ATL packet before `triaged` or execution.
- A persistent, human-controlled execution queue separate from visual focus selection.
- Provider discovery and explicit per-run/provider configuration for `codex` and `claude`.
- A launch preview that shows command, role, workspace, auth mode, budget, and containment rules before confirmation.
- Dashboard views for provider availability, session logs, and blocked launch reasons.

### Must remain unchanged

- `state.json` remains the authoritative lifecycle state.
- Existing gates for objective, completion checks, assigned worker, workspace, evidence, review, and done remain enforced.
- `runtime/lib/worker.mjs` remains provider-neutral and must never infer permission from an LLM response.
- GitHub/Azure credentials stay in the user environment; secrets must not be written into task files, feed entries, or prompts.

## Constraints

- First provider boundary is local CLI execution: `codex exec` and `claude -p`.
- Provider executable must be discovered and validated before the launch preview; a missing provider blocks the run with an actionable message.
- Task creation and import are idempotent by source key where a source key exists.
- Execution selection is not the same as keyboard focus; queue membership must be visible and auditable.
- Real execution requires explicit confirmation and bounded time/session budgets.
- The first implementation should run tasks sequentially unless a later approved design proves disjoint write sets and safe concurrency.
- Review independence must be preserved by a different model, provider, or context according to the existing routing contract.

## Decisions (from user) · OPEN · ASSUMPTION

- **Decision:** The user wants natural-language task entry and source import inside the terminal control room. *(user request)*
- **Decision:** Imported work must be transformed into the existing canonical ATL task model before execution. *(user request + current state model)*
- **ASSUMPTION (recommended):** Use deterministic local capture first, then a bounded Pip provider session for semantic normalization; do not call an LLM directly from the TUI renderer.
- **ASSUMPTION (recommended):** Keep the first execution mode sequential, with a preview and explicit confirmation for every batch.
- **OPEN-001:** Should the human choose one provider for the whole run, or configure a provider per ATL role? Recommended default: provider profile per role, with Codex CLI as the initial default and an explicit override for Sage/Beacon.
- **OPEN-002:** Does “همان کدکس” mean Codex CLI installed on the machine, or a Codex Desktop conversation/session? Recommended default: Codex CLI for the first adapter; Desktop requires a separate, explicit app adapter and is not currently connected to this runtime.
- **OPEN-003:** Should the composer save a draft immediately or only after the user reviews the normalized packet? Recommended default: save an immutable raw draft immediately, then create the canonical task after review so no user text is lost.
- **OPEN-004:** Should source imports be read-only in the first release? Recommended default: yes; no status/comment/write-back to GitHub or Azure.

## Acceptance examples (draft)

### A. Natural-language task

Given the dashboard is open, when the user types a plain-language task and submits it, then ATL saves the raw text, creates a `new` candidate, shows Pip's proposed objective/checks/priority/risk/route, and does not launch an agent.

### B. Imported work

Given GitHub or Azure credentials are valid, when the user opens a source picker and selects an item, then ATL imports the source as a deduplicated `new` candidate with source provenance and never writes back to the external system.

### C. Human selection and preview

Given multiple normalized tasks exist, when the user marks two tasks for execution, then the dashboard distinguishes focus from queue membership and the launch preview lists exactly those two tasks, their role/provider mapping, workspaces, auth mode, and budgets.

### D. Provider failure containment

Given the selected provider executable is missing or unauthenticated, when the user confirms a run, then ATL starts no agent, records an actionable blocker/feed event, and leaves the task outside `in_progress`.

### E. Successful bounded dispatch

Given a task is triaged, assigned, has an isolated workspace, and the provider is available, when the user confirms the run, then ATL launches the provider with the role prompt and workspace arguments, records the session/log path, and advances state only from observed ATL commands/evidence.

## Rollback story

The first slice can be disabled by hiding the composer/queue actions and continuing to use the existing `atl intake`, `atl run`, and `atl overnight` commands. Raw drafts and queue metadata are local and can be removed without changing existing task state; provider adapters remain behind an explicit launch boundary.
