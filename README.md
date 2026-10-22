# Agent Trust Ladder

A spec-first, evidence-gated **operator** for AI coding agents — packaged as one smart control plane, one lifecycle router, and nineteen independently invocable workflow skills.

It answers the question every team now has: agents execute faster than humans can verify. So every stage of work here produces **evidence**, and autonomy is earned per task class — never assumed.

## Why this repository exists

ATL grew from one practical question: if an agent can produce thousands of pull requests, what makes the work trustworthy when a human cannot read every line? The Matt Pocock and Lauren Tan conversation about shipping roughly 2,000 PRs made the lesson concrete: throughput depends on verification infrastructure, runtime observation, reusable rules, and feedback that becomes part of the codebase. [Listen to the conversation](https://zeno.fm/podcast/kua-guo-chuan-men-er-ji-hua/episodes/755-lauren-matt-pocock-ru-he-ba-2000-gepr-shang-dao-sheng-chan-huan-jing/).

Agent Trust Ladder turns that lesson into a reusable platform for engineering, prompting, vibe coding, code review, delivery, and technical documentation. It routes each request to the smallest safe workflow, makes the agent show its evidence, and expands autonomy only for task classes that have earned it. The target is not a PR count; it is a Michelin-level engineering kitchen where every change has a recipe, a quality gate, and a result people can inspect.

ATL's operating character is equally important: a sharp engineering colleague who is easy to think out loud with and uncompromising with evidence. It should feel natural to work with, challenge weak assumptions when needed, and treat production risk, compatibility, rollback, and unknown runtime behavior with professional care.

### Optimize the whole loop

ATL is designed to remove avoidable friction: bring one plain-language prompt, and it infers the route, shapes the acceptance criteria, loads only decision-changing context, and stops at sufficient evidence. It asks questions only for material human decisions, rejects unnecessary ceremony, and challenges a weak approach instead of agreeing politely. The target is zero avoidable back-and-forth, zero avoidable over-engineering, and the lowest context cost that still supports a correct result.

~~~text
bootstrap → frame → specify → plan → implement → verify → trust
                              audit ↙ (any existing work)
~~~

## What makes it different

| | Spec Kit | Discipline skills (grill / TDD style) | **Agent Trust Ladder** |
|---|---|---|---|
| Entry point | Full pipeline from `/specify` | One discipline at a time | **19 workflow entry points — jump in wherever you are** |
| Small tasks | Heavy ceremony | Fine | **Dose control: Direct / Standard / Critical** |
| Existing projects | Painful retrofit | Not its concern | **`bootstrap` maps real rules, invents nothing** |
| Reviewing a big agent diff | Not covered | Generic review | **`audit` → six-question trust verdict** |
| Autonomy governance | None | None | **L0–L7 ladder, per task class, with gates** |
| Context cost | Loads everything | One skill each | **One mode per invocation, references on demand** |

The spine is the **Trust Verdict** — six questions with evidence attached: *What changed? Why? What could break? Downstream impact? Objective achieved? Which boundary contracts were directly observed, and which remain inferred?*

## One smart entry point

### Install the ATL package

Install the control plane globally from GitHub Packages, or run it once with `npx`:

```powershell
npm install -g @depie99/atl --registry=https://npm.pkg.github.com
atl init
```

For a one-off project bootstrap:

```powershell
npx --yes @depie99/atl init
```

`atl init` creates only the project adapter (`.atl/project.json`), manager state, inbox, briefs, workspace root, and local routing config. Skills and runtime stay in the installed package; generated visual handoffs belong under ignored `.atl/tasks/`.

Use `$atl <request>` when you do not want to choose skills yourself. ATL inspects the project and request, selects one proportionate playbook, and composes only the available specialist skills the work needs. It can route native ATL stages plus optional PStack and Matt Pocock skills without letting either bypass scope, approval, evidence, or autonomy gates.

~~~text
$atl fix the intermittent checkout timeout and prove the real cause
~~~

Before material work it shows a compact Workflow Manifest: outcome, observed project need, playbook, dose/risk, selected skill route, gates, and stop condition. Missing optional skills are explicit and fall back to native ATL behavior; ATL never pretends a dependency ran.

### Skill-aware team routing

The manager now reads `config/skill-routing.json` during intake and triage. Pip records the best local specialist match—such as `atl-content-quality`, `atl-tech-docs`, `atl-diagrams`, `atl-ui-review`, or `atl-implement`—and proposes Rowan as the implementation owner. Mira still assigns workers, Sage reviews independently, and Beacon verifies the result.

Inspect a task route with `node runtime\\atl-manager.mjs route T-001`. The repository also ships as an npm package with the `atl` CLI and the `./team` capability export; package metadata is a distribution boundary, not a replacement for the runtime trust gates.

Jev is an optional decision aid for routing. Enable it in `config/jev.json`, set `TYPESAFE_API_KEY`, and run `node runtime\\atl-manager.mjs route T-001 --smart` or `node runtime\\atl-manager.mjs triage T-001 --smart`. You prompt it indirectly by writing a clear ATL task title/objective; ATL sends only those fields, labels, and the fixed available route choices. It returns one typed choice and confidence. Low confidence, timeout, missing-key, invalid-choice, and API failures fall back to deterministic routing. Read the complete [Jev guide](docs/jev.md), including prompt examples and token policy. No Jev SDK dependency is added.

ATL also keeps a small local learning journal at `.trust/manager/learning.json`. Record explicit preferences and lessons with `node runtime\\atl-manager.mjs memory learn style "Prefer concise explanations with direct evidence."` or `memory learn lesson "Do not add third-party directories to the repository."`; triage recalls matching lessons, and verified task outcomes are recorded automatically. It is inspectable, bounded, and advisory—never a replacement for policy, state, or evidence.

Keep verification infrastructure healthy with `python scripts\\maintain_verification_skill.py`; it checks the local verification skill, manager contract, baseline models, and mutation controls. For independent perf or regression samples, the team may split disjoint verifier runs, but ATL records the commands and evidence rather than treating “swarm passed” as a substitute for a trust verdict.

### You only need to bring the problem

Do not spend time deciding whether you need a frame, spec, plan, implementation loop, verification pass, code review, UI review, or audit. Describe the problem in plain language and ATL chooses the route from the evidence it finds:

| What you give ATL | What it selects |
|---|---|
| A vague idea or incomplete issue | Frame/specify first, so the agent does not invent the behavior |
| A bounded behavior with no code plan | Specify, then plan the real repository impact |
| An approved plan | Implement with bounded repair and re-verification |
| A finished change or artifact | Verify with checks that actually run |
| A diff, PR, merged change, or overnight agent session | Audit/review the existing work instead of treating it as greenfield |
| A rendered page or interaction problem | UI review against real states, viewports, and inputs |
| Production, auth, packaging, deployment, or external-service work | Contract ledger plus consumer/runtime evidence |
| A tiny isolated copy or style edit | Direct dose and proportionate checks; no ceremony tax |

ATL can chain stages when each stage returns the artifact required by the next gate. It stops when intent, authority, rollback, or evidence is genuinely unresolved and tells you exactly what decision or observation is missing.

### Trust without token waste

ATL treats context efficiency as part of engineering quality. It reads metadata first, loads only the selected route and relevant references, and scales context with risk: **minimal** for Direct, **focused** for Standard, and **expanded** only for Critical or unresolved boundary risk. It does not trade away a required safety or verification gate; it removes unrelated reads, duplicate explanations, speculative scans, and tests that cannot change the verdict.

~~~text
$atl the selected store changes in the UI but comes back after refresh
~~~

This is enough to start. ATL should discover whether it is a UI-only issue or a cross-layer persistence bug, trace the contract from producer payload to user-visible result, preserve legacy callers where relevant, and verify the original failure—not merely run a typecheck.

## Install

For Codex, install the repository as a plugin so the full skill set is discoverable. The plugin manifest is `.codex-plugin/plugin.json` and exposes `skills/`.

With a generic Agent Skills installer, install all skills rather than only the router:

~~~bash
npx skills add depie99/Agent-Trust-Ladder --all
~~~

Or copy every folder under `skills/` into your agent's skills directory (`.claude/skills/`, `.agents/skills/`, `.codex/skills/`, …).

**Optional slash commands** (Claude Code): copy `commands/*.md` into `.claude/commands/` for direct `/atl-*` access.

Full install guide — per-agent paths, team installs, updates, troubleshooting: **[USAGE.md](USAGE.md)**

### Documentation site prototype

The live documentation site is **[depie99.github.io/Agent-Trust-Ladder](https://depie99.github.io/Agent-Trust-Ladder/)**. Its source UI is **[docs/index.html](docs/index.html)**, including the **[Codex history bridge guide](docs/codex-history-bridge.html)**. The diagram is available as both **[HTML](docs/diagrams/atl-route.html)** and directly previewable **[SVG](docs/diagrams/atl-route.svg)**. Updates to `main` deploy through GitHub Pages Actions.

## Quick start

~~~text
# First time on an existing project (Codex / Agent Skills)
$atl-bootstrap

# A vague idea
$atl-frame users keep losing their filter settings

# Before writing code for something risky
$atl-specify export invoices as CSV

# "The agent ran all night — is this PR safe?"
$atl-audit PR #482

# Review and repair an implemented page from the real rendered states
$atl-ui-review checkout page

# "Can the agent work alone on docs now?"
$atl-trust docs_and_examples
~~~

`/atl-*` commands are optional Claude Code adapters; they are not how Codex discovers skills. In Codex invoke `$atl-specify`, `$atl-audit`, etc., or select the skill in the composer. Plain language still supports automatic routing.

## Modes

| Skill | Mode | Purpose |
|---|---|---|
| `$atl` | smart control plane | Assesses the project and composes the smallest trustworthy workflow |
| `$agent-trust-ladder` | router | Diagnoses your situation, runs the right stage |
| `$atl-bootstrap` | bootstrap | Map an existing project's real rules; starting trust policy; pilot proposal |
| `$atl-frame` | frame | Vague idea → bounded brief, one round of questions with defaults, dose set |
| `$atl-specify` | specify | Observable behavior + acceptance examples; human intent gate |
| `$atl-plan` | plan | Impact analysis, pre-mortem, tasks each with its verifier command |
| `$atl-implement` | implement | Self-correcting loop, repair budgets, hard lines against green-washing |
| `$atl-verify` | verify | Evidence + the six-question Trust Verdict |
| `$atl-audit` | audit | Read-only verdict on an existing diff/PR/session |
| `$atl-ui-review` | UI review and repair | Runtime inspection across visual, interaction, responsive, accessibility, and state quality |
| `$atl-diagrams` | diagrams | Create and keep architecture, flow, lifecycle, and dependency diagrams aligned with the code they explain |
| `$atl-adr` | architecture decision record | Decide whether a durable architecture decision needs a record; capture alternatives, consequences, lifecycle, and fitness evidence |
| `$atl-tech-docs` | technical documentation | Create or update docs from audience and source-of-truth contracts; verify examples, links, style, and freshness |
| `$atl-content-quality` | SEO and site content | Audit search/content quality or write bounded factual copy with evidence and explicit unknowns |
| `$atl-trust` | trust | L0–L7 advancement gate per task class |
| `$atl-formal-verification` | formal verification authoring | Create a project-local proof/model skill, executable suite, mutation check, and honest scope |
| `$atl-team` | team orchestration | Coordinate bounded parallel agents through ownership, contracts, integration, and evidence |
| `$atl-maintain-verification` | verification maintenance | Keep the verification skill, contract mapping, baseline checks, and mutation checks healthy after verification-related changes |
| `$atl-verify-atl-manager-lifecycle` | manager lifecycle model | Verify manager state transitions and evidence gates when `runtime/lib/state.mjs` or lifecycle behavior changes |

### Model routing

ATL routes work by capability rather than defaulting to one model:

| Work | Role | First output |
|---|---|---|
| Implementation, refactors, debugging | `code` | plan, files, checks |
| Architecture, tradeoffs, hard judgment | `judgment` | decision, alternatives, risks |
| Reading, comparison, synthesis | `analysis` | findings and open questions |
| Brainstorming and exploration | `ideas` | candidate approaches |

The default team loop is `route → plan → implement → independent review → fix/iterate → verify → log`. The first model must restate the goal, propose an approach, list files and changes, identify risks, and wait for the applicable gate before implementation. A different model or independent context reviews the work; model confidence is never treated as evidence.

> **The operating principle:** pick the right model, give it real tools, make it show its plan, have another model challenge the result, and keep the lesson.

Configure exact accessible models in [`config/model-routing.json`](config/model-routing.json), validate it with `python scripts/validate_model_routing.py`, and keep run memory in [`.trust/agent-runs/`](.trust/agent-runs/).

### Manager mode

You are the manager of the digital team. ATL gives each colleague a bounded mission, role, status, checkpoint, and evidence trail while you stay at the portfolio level: priorities, decisions, blockers, risks, and outcomes. The terminal control room (`atl ui`) is where work starts: compose or import tasks in plain language, review each packet, queue what may execute, and preview the provider plan before `atl launch --confirm` dispatches bounded sequential sessions. For unattended work, use `$atl-team` with an explicit `Complete when`, allowed/forbidden actions, workspace, checks, wake condition, stop rule, and morning brief. Time alone is never a finish condition.

The default roster is **Mira** (coordinator), **Pip** (triage), **Rowan** (builder), **Sage** (reviewer), and **Beacon** (verifier/night watch). They are friendly names over strict role contracts, not pretend personalities or hidden capabilities.

## Structure

~~~text
skills/atl/           # smart project assessment, playbooks, and cross-skill routing
skills/agent-trust-ladder/
  SKILL.md            # router: doses, modes, invariants (~1 screen)
  modes/              # the 8 canonical lifecycle modes, each self-contained
  references/         # deep detail, loaded on demand
    ladder.md         #   autonomy levels + advancement gate
    spec-core.md      #   full spec practice (Critical dose)
    evidence.md       #   verification layers, packet, PR gates
skills/atl-*/         # independent, directly invocable workflow skills
scripts/build_mode_skills.py # rebuild wrappers from canonical mode sources
.codex-plugin/plugin.json    # Codex multi-skill package
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
- **Bring the issue, not the workflow.** ATL is the front door; you do not need to know which specialist should run.
- **Quality is evidence-shaped.** A polished patch is not complete until the changed behavior, downstream contracts, and relevant runtime surface are observed.
- **Context is a budget.** Load the smallest body of information that can change the route or verdict, then stop when the risk-matched evidence is sufficient.

## License

MIT
