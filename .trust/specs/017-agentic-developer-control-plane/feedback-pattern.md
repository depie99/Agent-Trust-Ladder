# 017 Control Plane: UI Failure Pattern and ATL Training Record

Status: active regression record  
Date: 2026-10-23  
Scope: ATL terminal control room, browser control-plane prototype, navigation, task selection, and implementation workflow

## Why this record exists

The control-plane work repeatedly returned to the same user-visible failures:

- the terminal still looked like the old dashboard instead of the supplied control-plane artifact;
- a click on one task selected another task;
- clicking Tasks opened Queues or another route;
- tabs and mouse interactions were not reliable;
- static checks and HTTP checks were reported as if they proved the real interaction experience.

This is a process failure as well as a code failure. The purpose of this record is to make the failure pattern explicit so future ATL runs treat the supplied artifact, rendered surface, and real interaction path as evidence—not as optional polish.

## Root-cause pattern

### 1. Surface substitution

The implementation treated a terminal approximation as an acceptable substitute for the supplied browser control plane. The user asked for the control-plane interface; the work drifted toward preserving the legacy TUI and adding similar labels around it. That made the result structurally plausible but visually and behaviorally different.

**Prevention:** declare the canonical surface before implementation. If the reference is a browser artifact, preserve its page/sidebar/card/header/button model in the browser surface. A terminal renderer is a separate compatibility surface, not a pixel-equivalent replacement.

### 2. Source-of-truth drift

Route labels, task rows, selected-task state, and command state were implemented in several layers. The renderer knew one geometry, mouse handling guessed another geometry, and tests mostly checked exported strings or state transitions. This allowed a visible row and its clickable target to disagree.

**Prevention:** every interactive region must have one route/state model and one geometry/hit-test function shared by rendering, input, and tests. Never infer identity from arbitrary visible text when the renderer can emit a stable item id.

### 3. Evidence substitution

Passing unit tests, a passing HTML endpoint, or a successful install was treated as evidence that a person could click the actual UI. Those checks are useful, but they do not prove browser event routing, terminal mouse delivery, focus behavior, or visual parity.

**Prevention:** report four separate claims: implemented, observed, measured, and not checked. A UI interaction is only observed after replaying the input against the running artifact and checking the resulting visible state.

### 4. Coordinate and protocol fragility

Terminal layout changes with width, height, wrapping, route rows, and sidebars. SGR mouse packets can also arrive through a PTY in a different chunking pattern than expected. A regex over a single data chunk plus duplicated row arithmetic is not a reliable interaction model.

**Prevention:** use a shared layout map for every hitbox; parse complete mouse packets from a buffered stream; keep incomplete packets until the next data event; test compact and wide layouts with the same target id.

### 5. Premature completion

The implementation was declared close to complete while the user was still reporting the same primary interaction defect. This created repeated back-and-forth instead of a closed loop from symptom → reproduction → fix → user-visible verification.

**Prevention:** a primary interaction defect remains open until its exact reproduction is fixed and replayed. Do not use “the code exists” or “the endpoint responds” as a completion gate.

### 6. Partial protocol refactor

When the mouse parser changed from a regex `match` object to normalized `packet` objects, the click path was updated but the wheel path retained `match[...]` references. The first wheel event then crashed the running TUI with `ReferenceError: match is not defined`.

**Prevention:** after changing an input representation, search the whole handler for the old identifier, run syntax/tests, and replay each event family—not only the event that motivated the change. For mouse work, the minimum smoke set is click, release, wheel-up, and wheel-down.

## Concrete rules for future ATL runs

1. Read the supplied reference artifact and classify it as a normative visual/interaction contract or an inspiration reference. For this project, `runtime/control-plane.html` is normative for the browser control plane.
2. Start from a behavior matrix containing route, control, input method, expected state change, and visible evidence.
3. Give every clickable task/queue/route a stable `data-*` identity in browser markup or a shared layout identity in TUI code.
4. Keep renderer, hit-test, and test code on the same geometry function. Do not search rendered strings to recover identity unless the test explicitly covers a legacy fallback.
5. Re-run representative interactions in a running process: route click, task A click, task B click, click in detail pane, command submit, and back navigation.
6. Test at minimum 60, 80, and 120 columns for TUI; test the actual browser viewport used by the user for the browser surface.
7. After source changes, reinstall or restart the executable surface before manual verification. Record the exact path/version that was run.
8. If the browser cannot be automated, mark browser interaction as `NOT OBSERVED`; do not promote endpoint or source inspection to interaction evidence.
9. If two repairs change symptoms without closing the reproduction, stop cosmetic tuning and revisit the surface model, state model, or hit-test architecture.
10. Keep this record linked from the implementation and UI-review skills so the same evidence mistake is harder to repeat.

## Evidence ledger for this incident

| Condition | Evidence | State |
|---|---|---|
| Compact TUI route switcher renders two rows at 80 columns | Live PTY render observed | fixed/observed |
| Keyboard navigation from Overview to Tasks | Live PTY: Down + Enter opened Tasks | fixed/observed |
| Dashboard task click uses panel geometry instead of text matching | `dashboardTaskIndexAtPoint` regression test | implemented/measured |
| Wide dashboard detail pane cannot select portfolio task | geometry regression test | implemented/measured |
| Tasks-page click maps only inside the list column | source fix and unit coverage of shared geometry is required | in progress |
| SGR mouse packets are reliable through every PTY chunking pattern | not yet replayed with split packets | not checked |
| Browser control-plane looks and behaves exactly like the supplied artifact | endpoint/source checks only; no browser replay in this run | not checked |

## Machine-readable ATL training record

```yaml
record: atl-ui-failure-pattern-017
trigger: repeated user report that routes, tabs, and task selection do not match the reference artifact
primary_causes:
  - surface_substitution
  - source_of_truth_drift
  - evidence_substitution
  - duplicated_geometry
  - premature_completion
  - partial_protocol_refactor
required_gates:
  - reference_artifact_contract
  - shared_render_hit_test_geometry
  - running_surface_interaction_replay
  - compact_and_wide_tui_matrix
  - explicit_unobserved_disclosure
completion_rule: do_not_claim_ui_done_until_the_reported_reproduction_is_replayed_as_fixed
```
