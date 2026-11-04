# Conditional evidence gates

Read only the gate matching the changed boundary. These gates retain ATL authority and completion requirements.

## Cross-layer contract trace

Apply this trace to bugs that cross layers, whether or not they reach deployment. Follow the complete path: producer payload → transport/schema → route adapter → domain workflow → persisted state → user-visible result. Record a come-and-go timeline with symptom, hypothesis, attempted fix, evidence, reversal or replacement, final solution, and residual uncertainty.

When a new identifier or payload shape replaces an existing one, preserve old callers, explicitly reject ambiguous input, and test both formats. Require a regression matrix covering valid new input, valid legacy input, missing referenced entity, malformed input, and downstream persistence failure.

Do not equate committed or merged with behaviorally verified. Do not declare success until the original user-visible failure is re-observed as fixed, or explicitly marked unverified. Static checks alone yield a partial verdict for a runtime contract bug.

## UI misunderstanding recovery gate

For UI work, a rejected fix is new diagnostic evidence. If the user says the same visible problem remains, supplies a second screenshot showing the same concern, or continues describing hierarchy/clarity while the agent is changing spacing, icons, colors, or breakpoints, stop incremental cosmetic edits.

Before another implementation loop:

1. restate the observed user-visible failure and the intended reading order;
2. verify the route, actual viewport/container size, state, theme, zoom, and source served by the running application;
3. distinguish source-edited, installed, served, rendered, and visually verified evidence;
4. identify the responsible layer: content, component markup, layout primitive, style/token, interaction state, data model, or build/serve boundary;
5. reconsider the component structure after two cosmetic attempts or one repeated user rejection;
6. re-observe the original state and viewport before claiming success;
7. mark the result conditional when rendered evidence is unavailable.

Do not treat passing syntax, DOM-string, or functional tests as proof of visual comprehension. Do not follow an exploratory user suggestion such as “use an icon” literally unless it improves the stated task and hierarchy. In this repository, use [the UI repair misunderstanding guide](../../../problems/enhancements/ui-repair-misunderstanding-recovery.md) for the full incident pattern, responsive matrix, source-parity protocol, and definition of done.

## Contract-to-runtime evidence gate

Apply this gate whenever a change crosses configuration, build, packaging, deployment, or an external service. A genuinely local-only UI or logic change with no such boundary does not need this deployment gate, though its ordinary behavioral checks still apply.

Create a compact contract ledger before implementation or delivery. Declare each applicable contract separately: source configuration, generated bundle, artifact layout, deployment consumer, and runtime/external-service behavior. For every contract record:

- expected observable behavior;
- the command or runtime observation that proves it;
- the owner of the contract;
- rollback or containment behavior.

Use this compact shape when a table is practical: `contract | expected behavior | proof observation | owner | rollback/containment | evidence level`. Omit inapplicable rows, but do not collapse distinct contracts into one row.

Keep fixes separated by concern when possible. Do not combine an auth/configuration fix with unrelated packaging work unless both contracts are independently verified. Treat a revert as evidence of an unresolved contract disagreement, not proof that the reverted behavior was wrong.

The final evidence packet must distinguish `locally proven`, `CI/build proven`, `deployment-consumer proven`, `runtime/external-service proven`, and `still unknown`. If the artifact consumer or deployed callback contract cannot be observed, report the solution as conditionally valid rather than complete.

Use [references/case-studies.md](case-studies.md) as calibration examples, not as project-specific instructions.

