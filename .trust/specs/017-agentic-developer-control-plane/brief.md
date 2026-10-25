# Brief — 017 agentic developer control plane

Status: approved 2026-10-22 by the user's request · Dose: Critical

## Product intent

ATL should feel like one coherent developer workspace rather than a dashboard
that happens to start five bots. The TUI is the manager's control plane and the
developer's command surface at the same time:

- write, refine, edit, archive, restore, queue, run, and inspect work without
  leaving the TUI;
- use ATL's SDD/TDD skills to turn plain-language intent into an evidence-shaped
  brief, specification, implementation plan, and verification plan;
- select and use the configured provider/model with a visible approval and cost
  boundary;
- manage Mira, Pip, Rowan, Sage, and Beacon as a team with live status, briefs,
  feedback, transcripts, run controls, and recoverable blockers;
- see every important state change, queue, run, notification, and usage signal
  in a stable UI that never loses critical text to terminal overflow.

The target is not decorative perfection. It is a trustworthy, calm, keyboard-
first control room that remains useful when work is blocked, logs are long,
providers are slow, queues multiply, or the terminal is narrow.

## Primary users and jobs

| User | Job to be done | Required outcome |
|---|---|---|
| Human manager/developer | Turn an idea into bounded work | A task packet with objective, checks, risk, route, selected skills, and an explicit next action |
| Human manager/developer | Direct the team | Named queues, assignments, run policy, provider/model, pause/stop, feedback, and approvals are visible and controllable |
| Human manager/developer | Understand a blockage | Full evidence, owner, safe automatic recovery status, manager action, and exact next command are readable in the same screen |
| Human manager/developer | Trust a completed run | Per-bot brief, evidence, transcript, exit, gate transition, and verification result are linked and inspectable |

## Product contract

### 1. One TUI shell

The TUI has a persistent shell with:

- left navigation/sidebar for Overview, Work, Queues, Team, Runs, Logs,
  Notifications, Plan Studio, Usage, Providers, and Help;
- a central page that owns the current task;
- a context inspector or drawer for selected task, queue, team member, run, or
  notification;
- a top status bar for project, active queue/run, provider, sync age, and
  warnings;
- a bottom command/status bar showing the next useful actions and whether the
  current action is read-only, reversible, or requires confirmation.

The layout adapts by terminal width instead of shrinking all panels equally.

### 2. Task workspace and command surface

The manager can create a task directly in the TUI from free text, then edit its
title, objective, checks, resources, priority, risk, labels, route, assigned
worker, and queue membership. “Delete” means archive by default so the audit
history and evidence remain recoverable. Hard deletion, if ever added, requires
typing the task id and is out of the first implementation slice.

The command console is opened with `:` (and the selected task has a `w` quick
action for `why`). It supports an allowlisted ATL command grammar, command
history, completion/help, wrapped output, and scrollable results. It never
executes arbitrary shell text or starts a provider by parsing a free-form
command.

Initial command families:

- read: `why`, `show`, `brief`, `wake`, `feed`, `history`, `queue list`,
  `providers`, `usage`, `team`;
- task/control: `task create`, `task edit`, `task archive`, `unblock`,
  `approve`, `feedback add`, `queue add|remove|clear`;
- planning: `plan draft`, `plan review`, `plan approve`;
- execution: `launch --dry-run`, `launch --confirm` (opens the existing launch
  gate; it does not bypass confirmation).

### 3. Plan Studio: SDD/TDD by construction

Plan Studio is a staged flow:

1. **Intent:** the user writes natural language plus optional constraints,
   examples, files, and desired outcome.
2. **Frame:** ATL extracts scope, unknowns, risks, constraints, rollback, and
   acceptance examples.
3. **Specify:** ATL produces observable behavior and test-first acceptance
   examples.
4. **Route:** ATL selects relevant installed skills and the appropriate team
   role, showing why each skill was selected.
5. **Plan:** the configured provider produces a structured implementation plan
   with files, prerequisites, exact verifiers, and stop conditions.
6. **Review/approve:** the human sees the provider/model, prompt boundary,
   usage estimate or unknown status, generated artifacts, and diffs before the
   task packet or queue changes.

The first implementation uses the existing ATL skill contracts (`atl-frame`,
`atl-specify`, `atl-plan`, `atl-ui-review`, `atl-implement`, `atl-verify`, and
related skills) as routed stages. A provider response is advisory until it
passes the structured schema and the human approves the resulting artifact.

### 4. Multi-queue management

ATL supports multiple named queues. Each queue has persistent membership,
priority/order, policy, provider/model profile, time/session budgets, pause
state, and run history. The default safe policy is one active provider session
at a time across the project; parallel queues are an explicit later policy and
must show their combined budget and provider risk before approval.

Queue operations are visible and reversible: create, rename, duplicate, add,
remove, reorder, pause, resume, archive, dry-run, launch, and inspect. A task's
keyboard selection is never confused with queue membership.

### 5. Team and overnight control

The Team page shows Mira, Pip, Rowan, Sage, and Beacon as real role cards:

- current state, task, queue, provider/model, session id, elapsed time, and
  last event;
- current mission and allowed actions from the role contract;
- latest handoff/checkpoint/verification brief;
- pending feedback and interruption state;
- a link to the relevant session log and task evidence.

The Runs page manages one-shot and overnight work: preview, confirm, pause,
resume, stop, retry a bounded transient failure, inspect per-session progress,
and open the morning brief. A provider process is only started by the existing
launch engine after the explicit confirmation boundary. Stopping a run is
visible, audited, and does not falsely mark untouched work as failed.

### 6. Feedback, logs, and notifications

- **Feedback panel:** compose feedback targeted to task, role, queue, or active
  session; choose checkpoint or interrupt; see pending/applied/failed state and
  the exact session that consumed it.
- **Logs panel:** merged state decisions, feed narration, provider session
  output, and structured completion briefs with filters for queue/task/role/run
  and follow/history modes.
- **Notification panel:** deduplicated blocker, provider, usage, run, and
  approval notifications with severity, timestamp, source, recommended action,
  acknowledge/snooze state, and a link to the authoritative object.

### 7. Usage and remaining capacity

The Usage page and persistent top status indicator show three separate layers:

1. **ATL local budget:** authoritative sessions/minutes remaining for each run
   and queue, plus aggregate active-run demand.
2. **Observed provider usage:** token counts or usage metadata emitted by local
   provider/session logs, labeled by provider, model, task, role, and time
   window.
3. **Remote provider quota:** an authoritative remaining/reset value only when
   the provider adapter can obtain it. If the provider or authentication path
   does not expose quota, the UI must say `unknown` and show why; it must never
   turn an estimate into a fact.

The panel may show a clearly labeled forecast from recent observed usage, with
confidence and timestamp. Thresholds create notifications before a queue is
likely to exhaust its local budget or when remote telemetry reports a warning.

### 8. Blocker ownership and self-healing

Mira may automatically recover only bounded, reversible, non-human blockers.
The system should explain, retry once within configured limits, and continue
the queue where safe. EPERM/ACL, missing credentials, unavailable providers,
active-checkout conflicts, owner approval, spending, deployment, and external
communication remain explicit manager gates. The TUI must surface these with a
one-click safe next action and the complete evidence, so the user is not forced
to leave the control room just to learn what is blocked.

## Acceptance examples

### A. Create and plan from the TUI

Given the user opens Plan Studio and types “make the TUI a multi-queue agentic
control plane with live logs,” when they request a plan, then ATL creates an
immutable raw intent, shows the selected provider/model and skills, produces a
structured brief/spec/plan draft, and waits for approval before changing the
canonical task or queue.

### B. Work from the command surface

Given T-001 is blocked, when the user presses `w` or enters `why T-001`, then
the complete blocker, evidence, ownership classification, and fix route appear
inside a bounded scrollable page. Entering an unknown command shows an inline
error and does not mutate state or invoke a shell.

### C. Manage multiple queues

Given `default` and `release` queues exist, when the user opens Queues, then
both memberships, policies, budgets, provider mappings, blocked items, and run
states are visible; launching `release` previews only its tasks and preserves
`default` unchanged.

### D. Observe the five-bot team

Given an overnight run is active, when the user opens Team, then each role card
shows its current task/session/phase/provider, latest brief, pending feedback,
and log link; the view updates without losing selection or scroll position.

### E. Feedback and interruption

Given Rowan is running T-003, when the user submits checkpoint feedback, then
the feedback is durable and visibly pending; after the next applicable session
starts it becomes applied with a timestamp and session reference. Interrupt
requires explicit confirmation and preserves truthful run/task state.

### F. Usage risk

Given a queue has consumed 80% of its local session budget, when the threshold
is crossed, then the top bar and Notifications show the warning, the Usage page
shows the exact budget math, and the queue preview shows what remains. If remote
provider quota is unavailable, the UI says unknown rather than displaying a
fabricated remaining number.

### G. CRUD safety

Given a task has evidence or queue history, when the user chooses delete, then
ATL offers archive as the default, removes it from active views, preserves its
history, and provides restore. No evidence or audit record is silently erased.

## Non-goals for this slice

- arbitrary shell access from the TUI command line;
- silent provider execution, unattended spend, deployment, merge, push, or
  external messaging;
- claiming server-side provider quota when an adapter cannot verify it;
- unconstrained parallel queues;
- hard deletion of evidence-bearing tasks;
- replacing the existing state contract with a UI-specific source of truth.

## Open decisions requiring explicit approval before implementation

- **OPEN-017-01 — provider quota:** which providers and account APIs are in
  scope for authoritative remote usage, and which should initially display
  `unknown`?
- **OPEN-017-02 — concurrency:** keep global concurrency at one for the first
  release, or approve a bounded per-queue parallel mode with aggregate limits?
- **OPEN-017-03 — plan generation spend:** should Plan Studio require a second
  confirmation immediately before every provider call, or may a user-approved
  workflow run its bounded planning stages automatically?
- **OPEN-017-04 — archive naming:** use `rejected` as the existing lifecycle
  terminal state for archived tasks, or add a distinct `archived` state and
  update the formal contract/model?
- **OPEN-017-05 — target terminal widths:** the safe minimum is 60 columns;
  confirm whether below 60 should be supported or show a clear resize gate.
