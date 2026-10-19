# UI quality standard

Use this as a question set, not a style prescription. Project requirements and the intended user task outrank generic conventions.

## Intent and comprehension

- Is the page's purpose evident without relying on internal knowledge?
- Is the primary action visually and semantically distinct from secondary actions?
- Does the information order match the user's decision order?
- Are labels, units, status, and consequences understandable and truthful?
- Does decoration support recognition and mood without competing with the task?

## Composition and visual system

- Does attention move through a deliberate hierarchy at the actual delivery size?
- Do grid, alignment, spacing, and grouping reveal relationships?
- Are type scale, line length, contrast, and density readable for the content?
- Are color, shape, icons, and imagery used consistently and with enough non-color cues?
- Do repeated elements have purposeful rhythm without accidental monotony or noise?
- Does the most demanding component still look intentional, or does the system only work in a clean hero state?
- Are project tokens and components used at the correct semantic level rather than patched locally?

## Interaction and state truth

- Can users tell what is interactive, what is selected, what changed, and what is pending?
- Do hover, focus, active, disabled, loading, empty, error, success, and validation states convey distinct meanings?
- Is feedback close enough in time and space to the action that caused it?
- Are destructive or irreversible consequences explicit and recoverable where feasible?
- Do pause, resume, retry, cancel, back, reset, and interruption produce coherent state?
- Does the visible state reflect the authoritative application state, including after navigation or refresh?

## Responsive and adaptive behavior

- Does content reflow by priority instead of being uniformly compressed?
- Are reading order, focus order, and visual order still coherent?
- Do controls remain reachable and appropriately sized for the input method?
- Are tables, charts, dialogs, menus, long labels, user content, and zoom handled without hidden critical information?
- Are safe areas, virtual keyboards, orientation changes, and sticky regions handled when relevant?

## Accessibility

- Is the semantic structure meaningful without the visual styling?
- Can the primary path be completed with a keyboard, with visible and unobscured focus?
- Do controls have accurate accessible names, roles, values, instructions, and error associations?
- Is meaning preserved without color, motion, hover, sound, or precise pointing?
- Are text and meaningful graphical elements sufficiently distinguishable in their real states?
- Does zoom/reflow preserve task completion without two-dimensional scrolling except where intrinsically necessary?
- Does reduced motion preserve the action and state change rather than merely hiding information?
- Are dynamic changes announced appropriately when assistive technology needs them?

Exact conformance claims require the applicable standard version, supported platforms, appropriate tools, and human testing. Report a scoped review otherwise.

## Runtime quality

- Are there console/runtime errors, broken assets, hydration mismatches, layout shifts, or clipped layers?
- Are loading, slow network, failure, retry, offline, and empty results understandable when applicable?
- Do overlays, focus traps, scroll locking, stacking, and portals recover correctly?
- Is performance acceptable for the required environment? State this only when measured with a suitable method.

## Distinctiveness without slop

- Can the product be recognized from its structure and visual language, not only its logo?
- Are effects, animation, gradients, shadows, and decorative surfaces doing a specific job?
- Are default-library aesthetics or fashionable motifs overriding the product's own direction?
- Is detail concentrated where users inspect or decide, with quieter treatment elsewhere?
