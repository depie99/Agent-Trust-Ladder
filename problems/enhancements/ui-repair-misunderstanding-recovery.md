# UI Repair Misunderstanding Recovery Guide

Status: active ATL corrective-action guide  
Applies to: `$atl`, `atl-ui-review`, UI implementation, verification, and delivery  
Origin: repeated misdiagnosis of the Web Control Plane task-row hierarchy

## Purpose

Prevent a UI agent from repeatedly patching visible symptoms while missing the user's actual complaint. This guide turns the task-row incident into a reusable operating rule for future interface work.

The core lesson is simple:

> When a user rejects a UI fix, treat the rejection as evidence that the problem model may be wrong—not merely that the CSS needs another adjustment.

## Incident summary

The user reported that task rows looked confusing. Status badges, assigned team members, and action buttons appeared as unrelated floating controls. Long task titles also clipped at narrow widths.

The repair cycle went wrong in this order:

1. The first screenshot was interpreted mainly as a responsive clipping defect.
2. CSS width and overflow rules were patched without first defining the intended reading order.
3. Passing source-level tests were reported as success even though the rendered result had not been re-observed.
4. The running server was later found to be serving stale client code.
5. Further fixes targeted title clipping and button sizing, but the control hierarchy remained incoherent.
6. Status badges were changed to icons even though iconography was not the user's goal.
7. A layout change was scoped to a mobile breakpoint even though the user was viewing a desktop layout.
8. Only after repeated rejection was the component model corrected: task information on the left, with status, explicit ownership, and actions grouped into one control region.

The user had to repeat the same underlying concern because each attempted fix accepted the previous diagnosis instead of re-testing it.

## What actually failed

### 1. Problem framing failed

The visible symptom was “these things look scattered.” The agent translated it into “the title clips on mobile.” That was narrower than the evidence.

The actual user need was:

- establish a clear reading order;
- distinguish task state from available actions;
- associate the assigned person with the task rather than leaving a floating name;
- preserve that hierarchy at all supported widths.

### 2. Cosmetic edits were used for a structural defect

Spacing, icon, badge, and overflow changes could not repair a component whose semantic regions were wrong. The responsible layer was the task-row markup and layout model.

### 3. The rendered artifact was not the source being reasoned about

The repository contained updated code while the browser served an older installed runtime. Source inspection therefore did not prove what the user saw.

### 4. Verification measured the wrong things

The tests proved syntax, server contracts, and task-run behavior. They did not prove:

- visual grouping;
- reading order;
- breakpoint behavior;
- that the served asset matched the edited source;
- that the original screenshot condition was gone.

Green tests were valid evidence for their contracts, but they were incorrectly presented as evidence for visual success.

### 5. User suggestions were followed literally instead of interpreting intent

“How about changing the badge to icon?” was treated as a design requirement. In context it was exploration prompted by the unresolved hierarchy problem. The correct response was to evaluate whether icons improved comprehension; they did not address the root cause.

### 6. Rejection did not trigger a diagnostic reset

After the first failed fix, the agent should have stopped local tweaks and rebuilt the problem model. Instead, each new screenshot produced another incremental patch.

## Mandatory ATL misunderstanding-recovery gate

Apply this gate when any of the following occurs:

- the user says the same UI issue remains after a fix;
- the user supplies a second screenshot showing substantially the same problem;
- a proposed fix changes styling but the user continues describing hierarchy, clarity, order, or comprehension;
- source/tests disagree with the user's current rendered view;
- the agent cannot name the intended reading order in one sentence.

When triggered, ATL must:

1. **Stop incremental cosmetic edits.** Do not change another margin, icon, color, or breakpoint yet.
2. **Restate the observable problem.** Describe what is visually competing, disconnected, hidden, misleading, or out of order.
3. **State the intended reading order.** Example: `task identity → progress → state and owner → available actions`.
4. **Confirm the actual delivery context.** Record route, viewport dimensions, container dimensions, theme, zoom, and whether browser developer tools alter the content width.
5. **Verify source parity.** Compare the edited file with the asset served by the running application. A stale server or installed copy invalidates UI conclusions.
6. **Classify the responsible layer.** Choose one: content, component markup, layout primitive, token/style, interaction state, data model, build/serve boundary.
7. **Prefer structural repair when two cosmetic attempts fail.** Reconsider markup and component boundaries instead of stacking overrides.
8. **Re-observe the original condition.** Use the same state and viewport that produced the complaint.
9. **Check adjacent widths and states.** At minimum: common desktop, constrained desktop/tablet, narrow/mobile; include long titles, unassigned owner, terminal state, and runnable state.
10. **Report only observed success.** If no rendered recheck occurred, say “implemented, not visually re-observed.”

## UI problem statement template

Before editing, write this compact contract:

```text
Audience: <who uses this surface>
Primary task: <what they are trying to decide or do>
Observed failure: <specific screenshot/runtime evidence>
Intended reading order: <first → second → third → action>
Supported contexts: <desktop/tablet/mobile, theme, zoom, input>
Responsible layer hypothesis: <markup/layout/style/state/build>
Original-condition recheck: <route + state + viewport>
```

If the reading order cannot be stated, the issue is not ready for implementation.

## Structural-versus-cosmetic decision rule

Use a structural fix when one or more are true:

- related information is rendered in separate grid columns without a shared group;
- the same information changes order across breakpoints;
- elements appear to float because their relationship exists only through proximity;
- labels are missing, so the user must infer meaning;
- a child repeatedly needs negative offsets, forced widths, or breakpoint-specific exceptions;
- two styling attempts do not resolve the same complaint.

Use a cosmetic fix only when the semantic grouping and reading order are already correct.

For the task-row incident, the correct component structure was:

```text
Task row
├── Task information
│   ├── selection
│   ├── title
│   ├── identifier / queue / stage
│   └── progress / evidence count
└── Task controls
    ├── state
    ├── ownership
    │   ├── "Assigned to" label
    │   └── worker name
    └── actions
```

This structure remains understandable even when CSS changes.

## Source-parity protocol

For local browser tools with copied or installed runtimes:

1. Identify the process serving the page and its source directory.
2. Fetch the served JavaScript/CSS directly.
3. Search the response for a unique marker from the intended change.
4. If absent, stop visual debugging and refresh/reinstall/restart the serving runtime.
5. Hard-refresh the browser only after server source parity is proven.

Example evidence states:

```text
Repository source: updated
Installed runtime: updated / stale / not checked
Served client asset: updated / stale / not checked
Browser cache: refreshed / not checked
Rendered condition: fixed / still failing / not observed
```

Never collapse these into “the fix is live.”

## Responsive verification matrix

The exact widths may follow project policy, but each UI repair must cover the relationships below.

| Context | Required observation |
|---|---|
| Wide desktop | Task information and controls form two stable regions; no excessive floating gaps |
| Constrained desktop | Controls remain grouped; title receives available space without pushing controls outside the row |
| Tablet | Component reflows intentionally rather than shrinking columns until labels collide |
| Narrow/mobile | Task information appears first; state, owner, and actions stay in one understandable control band |
| Long title | Title truncates or wraps predictably from the correct edge; controls remain visible |
| Unassigned task | Ownership still has a label and does not look like stray metadata |
| Done task | Status and Logs/Delete actions remain distinguishable |
| Runnable task | Status and Run/More actions remain distinguishable |
| Keyboard focus | Focus order follows reading order and every action has a visible focus indicator |

Missing observations are `NOT OBSERVED`, never `PASS`.

## Evidence hierarchy for UI completion

From weakest to strongest:

1. Source contains intended markup or CSS.
2. Syntax/build checks pass.
3. DOM/contract regression checks pass.
4. The running server serves the intended asset.
5. The target state is rendered at the original viewport.
6. The original failure is absent and adjacent states remain usable.
7. Keyboard, zoom/reflow, and accessibility checks pass proportionally.

An agent may report levels 1–3 as implementation evidence. It may not claim the UI problem is fixed without level 5 or an explicit qualification.

## Communication rules during misunderstanding

When the user rejects a fix:

- acknowledge the specific mismatch, not merely the frustration;
- explain which assumption was wrong;
- do not defend the prior patch with passing tests that measured another contract;
- state what work is being discarded or superseded;
- describe the new problem model before editing;
- avoid asking the user to repeat information visible in supplied evidence;
- if intent is still ambiguous, offer one recommended interpretation and continue when safe.

Do not say “fixed” after implementation alone. Use:

- `Implemented`: source changed.
- `Served`: running application delivers the changed asset.
- `Observed`: the changed UI was visually inspected in the target state.
- `Verified`: the original failure and relevant regressions were checked.

## Required regression artifacts

For a repaired UI component, add the smallest durable checks that catch the actual failure mode:

- semantic DOM grouping assertions for relationships such as status + owner + actions;
- source-parity or served-asset assertions when an installed runtime exists;
- viewport/state screenshot or browser check when rendering tools are available;
- an explicit manual observation record when automated visual tooling is unavailable.

Do not use string-presence tests as a substitute for visual layout evidence. They prevent markup regression, not visual regression.

## Stop conditions

Stop and reconsider the component model when:

- the same complaint survives two attempts;
- each fix adds another breakpoint override;
- solving one width breaks another;
- the user describes confusion while the agent keeps changing decoration;
- the served artifact cannot be tied to the edited source;
- the agent is choosing between icons, pills, and spacing without first establishing hierarchy.

## Definition of done

A UI misunderstanding repair is complete only when:

- the user's actual complaint is stated accurately;
- the intended reading order is explicit;
- the responsible layer was corrected;
- the running application serves the intended source;
- the original viewport/state was re-observed;
- representative adjacent widths and states were checked;
- accessibility and interaction risks are reported honestly;
- regression checks cover the structural cause;
- any unobserved condition is named;
- the user does not need to restate the same issue to obtain the intended hierarchy.

## ATL routing consequence

For future UI work, `$atl` must route to `atl-ui-review` whenever the task depends on rendered comprehension. The routed review must return evidence from the real surface, not only source and tests. If the user rejects a repair once, ATL invokes the misunderstanding-recovery gate above before authorizing another implementation loop.

The final verdict remains `CONDITIONALLY TRUSTWORTHY` until the target rendered state is directly observed. Passing functional tests alone cannot raise a visual repair to `TRUSTWORTHY`.
