---
name: atl-formal-verification
description: Create and maintain a project-local formal verification skill and executable suite for one high-value invariant, state machine, concurrency property, or bounded code property.
---

# ATL Formal Verification

Use this skill when a requirement must hold across a whole stated state space, every event ordering in a bounded model, or every input covered by a code-level verifier. It is a meta-skill: the deliverable is a project-local verification skill plus a runnable suite, not a promise that the system is globally correct.

ATL still owns scope, authority, lifecycle, and the final trust verdict. Formal verification adds a proof-shaped evidence layer; it does not replace tests, runtime observation, review, or rollback.

## 1. Choose a property worth proving

Inspect the code and existing tests first. Select the strongest user-harming promise that ordinary examples are least likely to cover. Phrase it in plain language:

> Property: name the rule that must always be true.
> Harm prevented: name what users or operators suffer if it is false.

Record the exact code paths, events, data, and configuration represented by the property. Reject a target that cannot be mapped back to named repository concepts.

## 2. Let the question choose the verifier

Choose the cheapest credible tool that can answer the property:

- event ordering, state machines, or concurrency → model checker such as TLA+ or PlusCal;
- bounded inputs, memory safety, overflow, or Rust implementation behavior → Kani or another code-level verifier;
- algebraic laws or type-level guarantees → the language's proof/type system;
- finite relational constraints → Alloy or an SMT-backed checker;
- otherwise → a small exhaustive reference model, while labeling it as bounded evidence.

Prefer tools already installed or easy for this repository's developers to reproduce. State why the selected tool fits and list the assumptions it cannot check.

## 3. Generate the local verification contract

Create a project-local skill under the repository's established skill directory. Its frontmatter must name the target and trigger condition. From that skill alone, a cold agent must be able to:

1. decide whether a change touches the verified surface;
2. run one documented command with a pinned or discoverable tool version;
3. read a pass, counterexample, timeout, or modeling error;
4. distinguish a real product finding from a model/encoding failure;
5. update the model when the intended design changes; and
6. report scope, bounds, assumptions, and uncovered behavior.

Do not leave placeholders. Use repository paths, commands, and domain nouns.

## 4. Make the proof traceable and able to fail

For every modeled action, map it to an atomic code operation or explicitly document the abstraction. Include at least one positive invariant and one meaningful negative or safety property. Then run a mutation check:

1. make a scratch-only change that removes a guard, reorders a step, or violates the invariant;
2. run the generated skill exactly as a new agent would;
3. require the verifier to fail with a counterexample or rejected proof;
4. restore the scratch change without touching unrelated user work; and
5. rerun the original command and record the result.

If the mutation is not caught, repair the model, property, or harness. Never weaken the property to make the current implementation pass.

## 5. Keep the proof honest and cheap

The skill must state:

- the exact scope and bounds;
- assumptions about scheduling, persistence, environment, and omitted actors;
- the command and expected runtime;
- what a counterexample means in the code's terms;
- how code/model drift is detected; and
- what remains unverified.

A passing bounded model proves only the modeled scope. A timeout is not a pass. A modeling error is not a product failure. A changed verified code path requires rerunning or revising the skill.

## Handoff

Return the generated skill path, suite path, selected tool and rationale, property, bounds, mutation result, command, findings, and gaps. Suggest a second target only when the inspection found a closely related high-value invariant. Feed the result into `atl-verify`; do not advance autonomy without `atl-trust`.
