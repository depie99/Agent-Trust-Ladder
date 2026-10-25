# UI review — current ATL control room

Review scope: existing terminal TUI and the attached queue-run frame, reviewed
against the 017 product brief. This is an evidence-backed review, not a claim
that an interactive TTY session, screen reader, remote quota endpoint, or
performance profile was exercised.

## Coverage record

- **Build/environment:** Windows PowerShell, Node runtime, local checkout at
  `D:\Projects\Agentic\Agent-Trust-Ladder`.
- **Routes/surfaces:** `node runtime/atl-manager.mjs ui --once --plain`;
  exported dashboard renderer at widths 60, 80, and 120; attached run screen
  image `codex-clipboard-20c17b5a-f4ac-4323-817f-755503935b01.png`.
- **Fixture/state:** current project state with 5 tasks, 3 blocked, 3 queued,
  two completed tasks, and a long EPERM/Git-worktree blocker.
- **Viewport evidence:** plain terminal frames at 60×24, 80×24, and 120×34;
  attached run frame approximately 912×496 pixels.
- **Input method:** rendered keyboard guidance was inspected; a live keyboard
  and mouse interaction session was **NOT OBSERVED** in this tool pass.
- **Theme/locale:** plain terminal output, default locale; alternate themes
  and locale are **NOT OBSERVED**.
- **Evidence captured:** actual rendered output, source-level route/key mapping,
  existing dashboard/control-room tests, and the attached screenshot.
- **Limitations:** no screen-reader tree exists for this terminal surface;
  contrast was not instrument-measured; provider remote quota was not
  available; no performance benchmark was run.

## Verdict

**NOT TRUSTWORTHY for the requested 017 control-plane scope.** The current
dashboard is conditionally useful for a narrow read/queue/run workflow, but it
does not yet support the requested in-TUI command/plan/team/usage product and
loses critical blocker evidence at the exact moment a manager needs it.

## Findings

### F-017-01 — Critical evidence is clipped in the run surface

- **Severity:** Blocker
- **Axis:** Responsive behavior / intent and comprehension
- **Where/state:** Attached queue-run frame; blocked T-001/T-003 with long
  session-log evidence.
- **Observed:** The lines describing `.git/worktrees/...`, denied writes, and
  the next safe action terminate at the right edge. There is no visible wrap,
  horizontal-scroll affordance, or bounded detail view for the missing text.
- **Expected:** Critical evidence and the next action remain readable in a
  width-bounded region with explicit scrolling and truncation that never hides
  the continuation.
- **User impact:** The manager cannot determine whether the team should retry,
  change workspace ownership, or resolve permissions without leaving the TUI.
- **Fix direction:** Create a shared `EvidenceText`/log viewport primitive with
  wrapping, line continuation, copy mode, horizontal-safe clipping, and a
  detail route from every blocked row.
- **Recheck:** Render the same long blocker at 60, 80, and 120 columns and
  inspect the run view with keyboard paging; assert every critical line is
  reachable and no visible row exceeds its panel width.
- **Confidence:** High

### F-017-02 — The dashboard hides the most important command

- **Severity:** Major
- **Axis:** Interaction and state
- **Where/state:** Dashboard action bar at 60–80 columns; selected blocked task.
- **Observed:** At 60 columns the action bar ends in `u fix…`; `why` is not a
  direct action. The selected-task panel reports `DETAIL 1-3 / 47` or similar,
  but only exposes a generic scroll hint.
- **Expected:** A blocked task should expose diagnosis, ownership, safe recovery,
  and manager action as first-class actions without requiring command-line
  escape.
- **User impact:** The user must come to the CLI/TUI boundary to answer the
  first question—“why is this blocked?”—which defeats the manager surface.
- **Fix direction:** Add a command console and a `w why` quick action; show the
  command/output context in a dedicated page with history and scrolling.
- **Recheck:** From a blocked task, press `w`, inspect full output, then return
  without losing selection, scroll position, or state freshness.
- **Confidence:** High

### F-017-03 — Three-column composition is too dense for decision work

- **Severity:** Major
- **Axis:** Visual system / responsive behavior
- **Where/state:** Dashboard at 60, 80, and 120 columns.
- **Observed:** The 120-column view places portfolio, selected task, and feed in
  narrow panels; at 60/80 the layout collapses to stacked panels but removes the
  feed and compresses the task detail to a few lines. Action labels are shortened
  inconsistently as width decreases.
- **Expected:** Content priority should reflow deliberately: current decision,
  evidence, and next action first; activity and secondary metadata should move
  to pages/drawers rather than disappear.
- **User impact:** Developers cannot build a stable mental model of where to
  find tasks, logs, team state, or actions as the terminal changes size.
- **Fix direction:** Introduce a responsive shell with persistent sidebar at
  wide widths, collapsible navigation at medium widths, single-page focus mode
  at narrow widths, and semantic overflow rules.
- **Recheck:** Exercise the same blocked task and active run at 60/80/120 and
  verify the decision path remains identical even though secondary panels move.
- **Confidence:** High

### F-017-04 — The current UI has no durable control-plane information architecture

- **Severity:** Major
- **Axis:** Intent and comprehension
- **Where/state:** Existing dashboard/help/navigation.
- **Observed:** Most capability is encoded as single-letter shortcuts (`c`,
  `e`, `x`, `l`, `u`, `Q`, `L`) and screens are reached through a back stack.
  There is no persistent page/sidebar model for queues, team, notifications,
  Plan Studio, or usage.
- **Expected:** A large system needs visible destinations, selected context,
  breadcrumbs, and a command palette; shortcuts should accelerate known paths,
  not be the only discoverability mechanism.
- **User impact:** The surface cannot scale to multi-queue and five-bot
  operations without shortcut memorization and accidental context loss.
- **Fix direction:** Add explicit navigation regions and a consistent page
  contract while retaining shortcuts as accelerators.
- **Recheck:** Navigate to every 017 page using sidebar and keyboard, then use
  Esc/back and confirm the selected object/context is preserved.
- **Confidence:** High

### F-017-05 — Run/team state is fragmented across screens and files

- **Severity:** Major
- **Axis:** Interaction and state truth
- **Where/state:** Run screen, sessions screen, logs screen, feed, and task detail.
- **Observed:** The run screen has queue progress and a session-log tail, while
  sessions/logs/feed are separate views. There is no team-level card showing the
  five role states, latest brief, feedback delivery, and current queue together.
- **Expected:** A manager should see one authoritative current state with links
  to deeper evidence, not reconstruct it from several panels.
- **User impact:** Feedback, interruption, retry, and ownership decisions become
  slower and more error-prone during overnight work.
- **Fix direction:** Add a normalized control-plane snapshot and Team/Runs pages
  that link role → task → queue → session → brief → evidence.
- **Recheck:** During a synthetic overnight run, select each role and follow its
  task, feedback, transcript, and completion brief without leaving the shell.
- **Confidence:** High

### F-017-06 — Usage visibility is not yet a trustworthy product surface

- **Severity:** Major
- **Axis:** Runtime quality / state truth
- **Where/state:** Current runtime, session logs, and requested Usage panel.
- **Observed:** The runtime has local session/time budgets and some transcript
  usage parsing, but no general provider quota/remaining adapter or realtime
  dashboard. Current documentation says providers keep usage only, and the
  worker path does not persist a normalized usage snapshot.
- **Expected:** The UI must separate authoritative local budget, observed token
  usage, and provider-reported remaining quota; unavailable values must be
  visibly unknown.
- **User impact:** The manager cannot know whether a queue is about to exhaust
  local capacity or a provider account, and a fabricated percentage would create
  unsafe confidence.
- **Fix direction:** Add a provider-neutral usage snapshot contract, optional
  provider adapters, persisted observation timestamps, threshold notifications,
  and explicit unknown/estimate labels.
- **Recheck:** Test known local budget, observed session usage, provider adapter
  success, provider adapter failure, stale data, and unknown quota states.
- **Confidence:** High

### F-017-07 — Destructive task management semantics are undefined

- **Severity:** Major
- **Axis:** Interaction and state
- **Where/state:** Requested task CRUD versus the current lifecycle contract.
- **Observed:** The state contract has `rejected` but no distinct archive/restore
  model. Existing work carries evidence, queue membership, and logs that should
  not be silently deleted.
- **Expected:** Delete should be recoverable by default and must preserve audit
  history; irreversible destruction requires a deliberate, visible gate.
- **User impact:** A naïve delete implementation could destroy evidence or leave
  dangling queue/session references.
- **Fix direction:** Define archive/restore first, migrate queue/run references,
  and defer hard delete until a separate approved contract change.
- **Recheck:** Archive a task with evidence and queue history, confirm it leaves
  active views, restore it, and validate all historical references.
- **Confidence:** High

## Not observed / not yet judged

- Screen-reader/assistive-terminal semantics: **NOT OBSERVED**.
- Alternate color themes and measured contrast pairs: **NOT OBSERVED**.
- Reduced-motion behavior: **NOT APPLICABLE to the current static plain render;
  live redraw behavior still needs inspection**.
- Provider-specific remote quota correctness: **NOT OBSERVED** until adapters and
  credentials are explicitly scoped.
- Live TTY mouse hit targets and resize events: **NOT OBSERVED** in this pass.

## Review conclusion

The current TUI has a sound foundation—authoritative state, explicit launch
confirmation, queue/run screens, wrapped task detail, and existing keyboard/mouse
support—but its information architecture and evidence viewport are too small for
the product now being requested. The correct next move is a shell and data-model
expansion, not more one-letter shortcuts or cosmetic truncation patches.

## Follow-up live review — 2026-10-22

The installed runtime was refreshed from the workspace and the real interactive
`atl ui` process was exercised at the available 80-column PTY width. The
medium-width path now keeps the control-plane information architecture through
a two-row route switcher with keyboard and mouse hit mapping; it no longer
silently falls back to the legacy three-pane-only presentation. Route focus is
the initial focus, and Enter opens the selected route without falling through to
the selected task's source-file action.

The in-TUI command console now accepts both `why T-001` and `atl why T-001`,
and long command input keeps its insertion end visible. SGR mouse protocol
packets are guarded from being interpreted as Shift+M, preventing clicks from
turning capture off. Portfolio rows are now hard-bounded to one task line plus
one status line, so rendered geometry and mouse hit-testing cannot drift when a
status label is long. Rendering measured approximately 0.14 ms per 80×24 frame
for 1,000 pure renders; 100 snapshot refreshes averaged approximately 10.45 ms
each. The full JavaScript/Python verification sweep and `git diff --check`
passed after these repairs.

Remaining limitation: assistive-terminal semantics, alternate themes, and
provider-specific remote quota correctness were not observed in this pass.
