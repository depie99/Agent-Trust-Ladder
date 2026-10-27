# Inspection matrix

Match the evidence method to the claim. One method does not prove a different quality axis.

| Claim | Minimum credible evidence | Common false proxy |
|---|---|---|
| Visual hierarchy and composition | Rendered views at named viewport sizes, inspected at delivery scale | Source code, token list, or build success |
| Responsive behavior | Same task exercised across representative widths, content lengths, and zoom | One desktop and one pristine mobile screenshot |
| Interaction correctness | Real control path through relevant states, including recovery | A component unit test that bypasses the handler |
| State truth | UI observation plus state/network evidence appropriate to the architecture | Appearance alone |
| Keyboard access | Keyboard-only traversal and activation on the running UI | Presence of `tabIndex` or lint success |
| Semantics and accessible names | Accessibility tree or equivalent inspection plus task-based assistive check when warranted | DOM tag names alone |
| Contrast | Measured foreground/background pairs in actual states, including overlays and disabled/error states | Visual opinion |
| Reduced motion | OS/browser preference exercised through real transitions | A media query found in source |
| Runtime stability | Console/network observation and relevant scenario execution | Successful compilation |
| Performance | Controlled measurement with named device, build, route, and conditions | Feeling fast on a developer machine |
| Design-system consistency | Token/component usage plus rendered comparison across repeated instances | Matching component names |

## Coverage record

For each inspection session, record:

~~~text
Build/environment:
Route and data fixture:
Viewport/device and scale:
Theme/locale:
Input method:
States exercised:
Evidence captured:
Tool limitations:
~~~

Use `NOT OBSERVED` when the artifact, environment, data, or tool is unavailable. Lower confidence rather than guessing.
