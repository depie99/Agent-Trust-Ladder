# Design system — ATL Perfect TUI target

This is the target design system for the 017 control plane. It preserves ATL's
quiet terminal character—dark canvas, semantic status colors, evidence-first
text, and compact density—while giving the product a stable shell that can grow
from one queue to a full five-role team.

## Design principles

1. **Frame-stable:** no critical text escapes the owned viewport; long evidence
   becomes a scrollable object, never an accidental terminal line.
2. **Decision-first:** the current question, authoritative state, next action,
   and consequence appear before history and decoration.
3. **One object, one inspector:** every task, queue, role, run, log, and
   notification has a selected object and a predictable detail route.
4. **Keyboard-native, mouse-friendly:** every action has a keyboard path; mouse
   click/wheel accelerates navigation but never becomes the only route.
5. **Truth has a visual vocabulary:** observed, estimated, stale, blocked,
   pending, and unknown are distinct states, not color variants of one label.
6. **Reversible by default:** archive, pause, undo, back, and restore are easier
   to understand than destructive operations.
7. **Quiet live updates:** refreshes preserve selection, scroll, input, and page;
   a change is announced near the object that changed.

## Semantic tokens

The renderer should define tokens once and consume them by meaning rather than
raw color names. Plain mode uses the same labels and symbols without ANSI.

| Token | Meaning | Current/target treatment |
|---|---|---|
| `canvas` | terminal background | deep blue-green/black; no gradient |
| `surface` | panel background | one step lighter than canvas |
| `surfaceRaised` | focused card/drawer | stronger border, not a heavy shadow |
| `textPrimary` | task titles, commands, evidence | high contrast |
| `textMuted` | metadata, timestamps, hints | lower contrast but readable |
| `accent` | current route/focus | violet/coral pairing with non-color marker |
| `info` | neutral explanation | blue/cyan plus `i`/`·` marker |
| `success` | observed pass/completion | mint/green plus `✓`/`◆` |
| `warning` | forecast, stale, retryable blocker | amber plus `!`/`↻` |
| `danger` | failure, human gate, destructive action | coral/red plus `×`/`!` |
| `unknown` | unavailable telemetry | gray plus `?` and explanatory text |
| `focus` | keyboard/mouse selection | `▸` marker + border/inverse treatment |

Rules:

- Never encode a status by color alone.
- A provider quota of `unknown` is not `0%`; display `unknown` and its source.
- A task being blocked is not the same as a run failing; use separate labels and
  symbols.
- Destructive actions use a confirmation surface with the object id, impact,
  and recovery path.

## Shell geometry

### Wide terminal: 120+ columns

```text
┌ project / active queue / provider / sync / usage warning ───────────────┐
│ sidebar  │ main page: list + detail/workspace       │ inspector / alerts │
│          │                                           │                    │
├──────────┴───────────────────────────────────────────┴────────────────────┤
│ command palette / contextual actions · status · shortcuts                 │
└───────────────────────────────────────────────────────────────────────────┘
```

- Sidebar: 22–26 columns, persistent route and unread badges.
- Main: flexible, minimum 44 columns for a useful task detail.
- Inspector: 28–38 columns, collapsible when the current object has no detail.
- Bottom bar: one line; opens a command palette/editor when activated.

### Medium terminal: 80–119 columns

- Sidebar collapses to a numbered/icon rail with a visible current route label.
- Inspector becomes a drawer opened by `Tab`/`Enter` or a dedicated detail key.
- Main keeps the selected object, evidence, and next action visible.

### Narrow terminal: 60–79 columns

- Single-page focus mode; one primary panel at a time.
- Sidebar and inspector are pages, not squeezed columns.
- Long text wraps; feed/logs move behind their own page.
- The bottom bar shows only the top three actions plus `:` command access.

### Below 60 columns

Default behavior is a clear resize/compact-mode notice rather than silently
losing critical content. If a compact mode is later approved, it must preserve
the selected object, status, next action, and command input.

## Navigation model

Sidebar routes and their primary question:

| Route | Question answered | Primary object |
|---|---|---|
| Overview | What needs my attention? | alerts, blocked work, active runs |
| Work | What are the tasks and their contracts? | task |
| Queues | What will run and under which policy? | named queue |
| Team | What is each role doing? | role/session |
| Runs | What is executing or finished? | run |
| Logs | What exactly happened? | event/session log |
| Notifications | What changed or needs a decision? | notification |
| Plan Studio | How does intent become an SDD/TDD plan? | plan draft |
| Usage | How much capacity remains? | provider/budget window |
| Providers | Which provider/model/auth is active? | provider profile |
| Help | How do I operate this surface? | command/action |

Every page has a title, one-sentence purpose, selected object, status, and
contextual action row. Route changes do not destroy unfinished editor input.

## Core components

- **Status bar:** project, route, active queue/run, provider/model, sync age,
  local budget, remote usage state, and unread notification count.
- **Sidebar item:** icon/number, label, unread count, active marker, disabled
  reason when a route is unavailable.
- **Object list:** stable id, title, status marker, priority, queue badge, and
  last-change age; selection never mutates state.
- **Inspector:** objective, checks, evidence, ownership, resources, queue/run
  links, blocker reason, next safe action, and history shortcut.
- **Evidence viewport:** wrapped text, line count, scroll position, source,
  follow/latest toggle, copy mode, and explicit stale/truncated state.
- **Command palette:** prompt, completion menu, command synopsis, history,
  confirmation mode, and structured result page.
- **Plan card:** stage, provider/model, input artifact, output artifact, skill
  route, usage estimate/source, approval state, and verifier.
- **Role card:** role mission, current phase, task, queue, provider/model,
  session timer, latest brief, feedback badge, and log link.
- **Queue card:** queue name, policy, selected count, ready/blocked counts,
  budget, provider, run state, and last run.
- **Notification row:** severity marker, timestamp, source object, one-line
  message, recommended action, unread/ack/snooze state.
- **Usage meter:** used/remaining/unknown, window/reset, source, freshness,
  confidence, and forecast label. It never presents an estimate as fact.

## Interaction contract

Global keys:

| Key | Action |
|---|---|
| `:` / `Ctrl+K` | open command palette |
| `Tab` / `Shift+Tab` | move focus between shell regions |
| `Enter` | open/activate selected object |
| `Esc` | close drawer/editor or go back one route |
| `↑↓` / `j k` | move list or scroll focused viewport |
| `PgUp/PgDn`, `Home/End` | page or jump in the focused viewport |
| `r` | refresh authoritative snapshot without losing context |
| `?` | contextual help for the current route |
| `q` | quit; active run requires explicit second confirmation |
| `w` | selected task `why` shortcut in Work/Overview |

Command palette rules:

- Completion shows commands valid in the current context and marks mutations.
- A command result opens a bounded output page or a named destination; it does
  not dump arbitrary stdout into the terminal.
- Mutations show actor, affected object, reversible/irreversible status, and
  the next state before commit where practical.
- Provider calls and run starts show provider/model, local budget, usage source,
  and confirmation requirement before work begins.

## Page behavior

### Overview

Attention stack first: human gates, failing/blocked tasks, active runs, usage
warnings, then recent feed. The first selected item always has a next action.

### Work

List/detail split at wide widths; list-only plus inspector page at narrow widths.
The task composer can switch between plain intent and structured packet fields.
Archive is the default delete action; restore is always discoverable for archived
tasks.

### Plan Studio

A horizontal stage rail is replaced by a vertical breadcrumb at narrow widths.
Each generated artifact is readable before approval. The user can edit the
artifact, rerun one stage, reject it, or return to intent without losing the
raw input.

### Team and Runs

Team answers “who is doing what”; Runs answers “what process is executing.” A
role card opens the run/session/task chain. Live updates preserve selected role,
scroll, and open feedback editor.

### Logs and Notifications

Both have follow/latest and history modes, filters, and stable ids. A selected
notification explains why it exists and links to the source object. A log row
can be copied without enabling global mouse capture.

### Usage

Separate local budget, observed usage, remote quota, and forecast sections. A
stale or unknown value is visually prominent but not alarmist. Thresholds are
configurable and every warning includes its source and reset/refresh time.

## State design

The UI consumes a normalized control-plane snapshot assembled from authoritative
state, named queues, run registry, feed/logs, notifications, provider profiles,
and usage snapshots. The snapshot is read-only; actions call domain modules and
then refresh it. No page owns a second task truth.

Required state labels:

- lifecycle: `new`, `triaged`, `assigned`, `in_progress`, `in_review`,
  `verifying`, `done`, `blocked`, `rejected`, `escalated`;
- run: `planned`, `waiting_confirmation`, `running`, `paused`, `stopping`,
  `completed`, `failed`, `aborted`, `blocked`;
- telemetry: `observed`, `estimated`, `stale`, `unknown`, `unavailable`;
- notification: `unread`, `acknowledged`, `snoozed`, `resolved`.

## Accessibility and terminal ergonomics

- Every action has a keyboard route and a textual label.
- Focus is always visible with marker and border/inverse treatment.
- Status uses icon + word, not color only.
- Dynamic updates announce in the status/notification region and do not steal
  focus from editors or scroll viewports.
- Editors support cancellation, clear validation, and preservation of input on
  refresh/error.
- Narrow terminals use reflow and paging rather than hidden horizontal content.
- Mouse capture is optional; native terminal selection remains available.
- Reduced-motion equivalent: live redraws are stable and nonessential animation
  can be disabled without hiding state.

## Review gates for the implemented design

The UI review must re-run the same states at 60/80/120 columns, verify keyboard
paths and resize behavior, inspect empty/loading/error/blocked/running/success
states, and record unobserved screen-reader/contrast/provider telemetry limits.
No “perfect” verdict is allowed without matching runtime evidence.
