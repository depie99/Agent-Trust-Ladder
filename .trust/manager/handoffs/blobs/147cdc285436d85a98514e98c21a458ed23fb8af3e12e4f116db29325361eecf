# UI fix loop

## 1. Preserve the baseline

Record the exact route, fixture, viewport, theme, input, state, and observed defect. Capture a screenshot or trace when tooling allows, but do not imply that a capture exists when it does not.

## 2. Locate the responsible layer

Classify the cause before editing:

- content or information architecture;
- design token or theme;
- layout primitive;
- reusable component;
- page composition;
- application state or event handling;
- responsive rule;
- browser/platform integration.

Prefer the smallest shared layer that fixes every instance without broadening the change unnecessarily. Preserve deliberate exceptions.

## 3. Make one bounded correction

Tie the change to one or more findings. Avoid opportunistic redesign. If the fix changes product meaning, navigation, brand direction, or a destructive flow, return for human approval.

## 4. Recheck the same condition

Repeat the original path under the same conditions. A changed file or passing build does not close a visual or interaction finding.

## 5. Check adjacent regressions

Inspect the component's other states and the nearest affected breakpoints, themes, locales, and consumers. Run project tests and static checks appropriate to the edited layer.

## 6. Decide

- Close the finding only with matching evidence.
- Keep it open when improvement is plausible but unobserved.
- If two local attempts fail, reconsider the underlying representation or request a product/design decision.
- Separate remaining blockers from optional polish.
