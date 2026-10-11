# Agent Trust Ladder

A spec-first, evidence-gated **operator** for AI coding agents — installable as a single skill, usable at any point in any project.

It answers the question every team now has: agents execute faster than humans can verify. So every stage of work here produces **evidence**, and autonomy is earned per task class — never assumed.

~~~text
bootstrap → frame → specify → plan → implement → verify → trust
                              audit ↙ (any existing work)
~~~

## What makes it different

| | Spec Kit | Discipline skills (grill / TDD style) | **Agent Trust Ladder** |
|---|---|---|---|
| Entry point | Full pipeline from `/specify` | One discipline at a time | **8 entry points — jump in wherever you are** |
| Small tasks | Heavy ceremony | Fine | **Dose control: Direct / Standard / Critical** |
| Existing projects | Painful retrofit | Not its concern | **`bootstrap` maps real rules, invents nothing** |
| Reviewing a big agent diff | Not covered | Generic review | **`audit` → five-question trust verdict** |
| Autonomy governance | None | None | **L0–L7 ladder, per task class, with gates** |
| Context cost | Loads everything | One skill each | **One mode per invocation, references on demand** |

The spine is the **Trust Verdict** — five questions with evidence attached: *What changed? Why? What could break? Downstream impact? Objective achieved?*

## Install

~~~bash
npx skills add depie99/Agent-Trust-Ladder --skill agent-trust-ladder
~~~

Or copy `skills/agent-trust-ladder/` into your agent's skills directory (`.claude/skills/`, `.agents/skills/`, `.codex/skills/`, …).

**Optional slash commands** (Claude Code): copy `commands/*.md` into `.claude/commands/` for direct `/atl-*` access.

Full install guide — per-agent paths, team installs, updates, troubleshooting: **[USAGE.md](USAGE.md)**

## Quick start

~~~text
# First time on an existing project
/atl-bootstrap

# A vague idea
/atl-frame users keep losing their filter settings

# Before writing code for something risky
/atl-specify export invoices as CSV

# "The agent ran all night — is this PR safe?"
/atl-audit PR #482

# "Can the agent work alone on docs now?"
/atl-trust docs_and_examples
~~~

No commands installed? Just ask in plain language: *"audit this diff"*, *"frame this idea"*, *"verify this is actually done"* — the skill's description routes it to the right mode.

## Modes

| Command | Mode | Purpose |
|---|---|---|
| `/atl` | router | Diagnoses your situation, runs the right stage |
| `/atl-bootstrap` | bootstrap | Map an existing project's real rules; starting trust policy; pilot proposal |
| `/atl-frame` | frame | Vague idea → bounded brief, one round of questions with defaults, dose set |
| `/atl-specify` | specify | Observable behavior + acceptance examples; human intent gate |
| `/atl-plan` | plan | Impact analysis, pre-mortem, tasks each with its verifier command |
| `/atl-implement` | implement | Self-correcting loop, repair budgets, hard lines against green-washing |
| `/atl-verify` | verify | Evidence + the five-question Trust Verdict |
| `/atl-audit` | audit | Read-only verdict on an existing diff/PR/session |
| `/atl-trust` | trust | L0–L7 advancement gate per task class |

## Structure

~~~text
skills/agent-trust-ladder/
  SKILL.md            # router: doses, modes, invariants (~1 screen)
  modes/              # the 8 entry points, each self-contained
  references/         # deep detail, loaded on demand
    ladder.md         #   autonomy levels + advancement gate
    spec-core.md      #   full spec practice (Critical dose)
    evidence.md       #   verification layers, packet, PR gates
commands/             # optional /atl-* slash commands
GUIDE.md              # full walkthrough with scenarios
USAGE.md              # install, update, troubleshooting (per agent)
README.fa.md          # راهنمای فارسی
~~~

Artifacts land in `.trust/` of the target project: `project-brief.md`, `trust-policy.md`, `ledger.md`, and `specs/NNN-slug/`. Map into your existing conventions instead of duplicating.

## Principles

- **Dose, not dogma.** Trivial edits skip the ladder entirely; only Critical work earns full ceremony.
- **Evidence over confidence.** A green check, a plan, or a confident explanation is not verification.
- **Autonomy is per task class.** Docs and payments advance on independent ladders, on independent evidence.
- **Never hide failure.** Skipped checks are reported, not buried; tests are never weakened for green.
- **Humans own intent and risk.** AI drafts, implements, checks, and proposes.

## License

MIT
