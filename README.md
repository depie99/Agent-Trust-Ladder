# Agent Trust Ladder

A portable, spec-first and evidence-gated skill for executing non-trivial software changes with AI agents.

It turns a request into a bounded workflow:

~~~text
discover -> frame -> specify -> clarify -> plan -> tasks -> implement
-> self-correct -> verify -> evidence
~~~

The skill treats autonomy as evidence about a task class in a specific project, not a property of a model or prompt.

## Install

~~~bash
npx skills add depie99/Agent-Trust-Ladder --skill agent-trust-ladder --agent codex
~~~

## Contents

- `skills/agent-trust-ladder/SKILL.md` — on-demand workflow instructions.
- `skills/agent-trust-ladder/references/trust-policy.md` — detailed advancement, verification, and delivery gates.

## Core principles

- Specify observable behavior and acceptance examples before non-trivial implementation.
- Make unknowns explicit; clarify consequential assumptions before an agent decides them.
- Treat code, plans, checked tasks, and test coverage as evidence—not proof.
- Require evidence of behavior, impact, review, and residual risk.
- Increase autonomy only when failures can be detected, contained, reviewed, and recovered from.

## License

MIT
