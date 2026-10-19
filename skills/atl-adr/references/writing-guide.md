# ADR writing guide

## A good record is

- **One decision:** do not hide several architectural choices in one file.
- **Specific:** state the chosen direction, not a list of unresolved possibilities.
- **Contextual:** explain constraints, stakeholders, quality attributes, and forces in tension.
- **Trade-off honest:** record what gets easier and what gets harder.
- **Time-aware:** date costs, vendor behavior, scaling assumptions, and review triggers.
- **Evidence-linked:** connect the decision to requirements, code/contracts, tests, fitness functions, and runtime observations.
- **Lifecycle-aware:** use `proposed`, `accepted`, `rejected`, `deprecated`, or `superseded by <link>`.

## Review checklist

1. Could a future contributor understand why this decision existed?
2. Are the important alternatives and rejection reasons visible?
3. Are consequences concrete for callers, data, security, operations, and delivery?
4. Does the decision have an owner and a trigger for reconsideration?
5. Is there an objective verifier or fitness function where drift is detectable?
6. Are unknowns labeled `OPEN` rather than converted into confident prose?
7. If this supersedes another record, are both records linked without erasing history?

## Fitness functions

An ADR documents a rule; a fitness function continuously checks that the rule remains true. Prefer executable checks such as architecture tests, dependency rules, schema checks, contract tests, CI policies, or deployment assertions. If no automated check is practical, record the manual observation and its owner/frequency instead.
