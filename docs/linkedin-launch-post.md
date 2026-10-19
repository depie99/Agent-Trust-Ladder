# LinkedIn launch post

## Draft

Most AI coding workflows optimize for generation.

We built [Agent Trust Ladder](https://github.com/depie99/Agent-Trust-Ladder) to optimize for the part that decides whether generated work is safe to ship: verification.

The idea was sharpened by the conversation between Matt Pocock and Lauren Tan about shipping roughly 2,000 pull requests with agents. The important lesson was not the number of PRs. It was the infrastructure underneath the number:

- agents need a way to observe real behavior;
- repeated corrections should become rules, skills, and checks;
- trust must be earned per task class;
- humans should spend attention on intent, risk, and unknowns—not repeatable inspection.

ATL turns that into one front door for engineering work:

→ describe the issue in plain language;
→ ATL chooses the smallest sufficient route;
→ the agent frames, specifies, plans, implements, verifies, reviews, or audits as needed;
→ the result ends with evidence and a clear trust verdict.

It also covers the work around the code: architecture decisions, technical documentation, UI review, deployment contracts, diagrams, prompt shaping, and vibe-coding guardrails.

The goal is a Michelin-level engineering kitchen: every change has a recipe, a quality gate, and a result people can inspect.

The personality matters too: ATL should feel like a friendly senior engineer—easy to talk to, careful with risk, and honest whenever evidence is missing.

Try it, read the docs, and tell us where it breaks:

🌐 [ATL documentation site](https://depie99.github.io/Agent-Trust-Ladder/)

📦 [Repository](https://github.com/depie99/Agent-Trust-Ladder)

I would especially value feedback on:

1. Which workflow stage is missing from your team?
2. Which evidence is hardest for your agents to produce?
3. Where should ATL be more lightweight?

This is an open invitation to use it, challenge it, and improve it with us.

#AIEngineering #CodingAgents #DeveloperTools #SoftwareEngineering #VibeCoding #TechnicalDocumentation #CodeReview
