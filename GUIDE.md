# Agent Trust Ladder — User Guide

Everything you need to use this skill well, from first install to governing a semi-autonomous agent. (نسخه فارسی: [README.fa.md](README.fa.md))

---

## 1. The problem it solves

AI agents made execution cheap. A change that took a week now takes minutes — across hundreds of files, tests, configs, and pipelines. But verification did not get faster, and that created the modern bottleneck: **you cannot personally review everything an agent produces.**

Process frameworks answered with more documents. Discipline skills answered with better habits. Both help, but neither hands you the thing you actually need at the end: **a verdict you can trust, with evidence attached.**

This skill is an operator, not a religion. It runs one stage at a time, sized to the risk of the change, and every stage ends in evidence:

> **What changed? · Why? · What could break? · Downstream impact? · Objective achieved?**

If those five have real, checkable answers, you can trust the change. If any answer is "the agent said so", you can't — and now you know exactly which question to push on.

---

## 2. Install

~~~bash
npx skills add depie99/Agent-Trust-Ladder --all
~~~

or copy every folder under `skills/` into your agent's skills folder (`.claude/skills/`, `.agents/skills/`, `.codex/skills/`, …). Codex users invoke individual workflows as `$atl-frame`, `$atl-specify`, `$atl-audit`, and so on; `$agent-trust-ladder` remains the router.

Optional but recommended — slash commands (Claude Code and compatible agents):

~~~bash
cp commands/*.md .claude/commands/
~~~

That gives you `/atl`, `/atl-bootstrap`, `/atl-frame`, `/atl-specify`, `/atl-plan`, `/atl-implement`, `/atl-verify`, `/atl-audit`, `/atl-trust`.

These slash commands are Claude Code adapters. Codex discovers the independent `$atl-*` skills from their own `SKILL.md` metadata. Plain language works too.

> Per-agent install paths (Codex, Cursor, Copilot, Gemini, …), team/submodule installs, updates, and troubleshooting: **[USAGE.md](USAGE.md)**

---

## 3. Dose control — the anti-ceremony rule

If you do not know which workflow applies, start with `$atl <request>`. It assesses the current project, selects one primary playbook, and composes only the available ATL, PStack, or Matt Pocock specialist skills needed for distinct failure modes. It shows the route and gates before material work; unavailable optional skills use an explicit native fallback.

### The zero-choice workflow

Your input can be as short as a symptom, issue, or desired outcome. You do not need to name a skill. ATL reads the request together with the repository state and chooses the furthest safe route:

~~~text
raw prompt
  → frame when the intent is vague
  → specify when behavior or acceptance is missing
  → plan when repository impact is not mapped
  → implement when the plan and authority are ready
  → verify when a change exists
  → review/audit or delivery when the question concerns existing work or release
~~~

This is adaptive, not a mandatory ceremony. A one-file, low-risk, reversible edit can use Direct dose. A payment, auth, migration, production, cross-service, or deployment-boundary change gets Standard or Critical handling and cannot close on a local green check alone.

### Token-efficient by design

ATL uses progressive disclosure rather than loading the whole framework into every request:

| Context budget | ATL loads | Typical use |
|---|---|---|
| **Minimal** | local instructions, target files, one route row, proportionate verifier | isolated copy/style/lint change |
| **Focused** | minimal context plus the primary playbook, selected specialist, and affected callers/contracts/tests | normal feature or bug fix |
| **Expanded** | focused context plus rollback, CI, deployment/runtime, and independent review evidence around the actual risk | auth, production, migration, external service, or unresolved boundary |

It deliberately does not read every skill, every reference, or the whole repository. If a skipped source could change the verdict, ATL labels it `OPEN`; otherwise it stays unloaded. The goal is fewer tokens with the same gates, not fewer gates.

### How ATL decides what you need

| Signal in your request or project | Route | What must come back before continuing |
|---|---|---|
| “Users are losing…”, “it is broken…”, or an idea with unclear meaning | `frame` / `specify` | bounded outcome, unknowns, acceptance examples, rollback |
| The behavior is agreed but the codebase impact is unknown | `plan` | callers, contracts, task list, and verifier per task |
| A plan already exists and implementation is authorized | `implement` | diff plus observed verify/repair results |
| “Is this done?”, “does it work?”, or a built artifact | `verify` | commands that ran, results, skipped checks, and verdict |
| A PR, diff, merge, or agent run already exists | `audit` / review | scope, intent fidelity, risk, evidence gaps, and verdict |
| A real page or interaction needs critique or repair | `ui-review` | rendered-surface findings and re-observation of repairs |
| Build, config, package, deploy, auth, or external service is involved | relevant playbook + contract gate | contract ledger, artifact-consumer proof, runtime proof or an explicit conditional verdict |

The user remains the owner of product intent, irreversible actions, production access, and risk acceptance. ATL asks a question only when that human decision cannot be safely inferred. It does not ask you to choose between skills merely because several skills could technically apply.

### What “best possible result” means

ATL optimizes for a trustworthy outcome, not the largest process. It keeps concerns separate, tests competing explanations, preserves compatibility when contracts change, re-observes the original failure, and reports unknowns instead of smoothing them over. “Committed”, “merged”, “typechecked”, and “built” are useful evidence levels; none is automatically proof of runtime behavior.

For deployment-boundary work, the final report separates `locally proven`, `CI/build proven`, `deployment-consumer proven`, `runtime/external-service proven`, and `still unknown`. If the artifact consumer or deployed callback cannot be observed, the result is **conditionally valid**, not complete.

The #1 complaint about spec-driven workflows is ceremony: a typo fix forced through the same pipeline as a payments migration. This skill's answer is **dose control**, chosen per change and stated in one line:

| Dose | Typical change | What you get |
|---|---|---|
| **Direct** | Typo, copy, comment, one-file lint fix | One-line plan → do it → show the diff. No artifacts. |
| **Standard** | Feature, bugfix, tested refactor in one area | Brief → spec-lite → plan with tasks → evidence summary. One page each. |
| **Critical** | Auth, payments, privacy, migrations, production, cross-service | Full spec + evidence packet + explicit human gates. No silent autonomy growth. |

You can always override ("make this Critical", "keep it Direct"). When the skill is unsure, it asks one question with a recommended default.

---

## 4. The workflow skills, with scenarios

### `bootstrap` — first contact with a project
> *You just cloned the company monorepo and want the agent to help. What are the real rules?*

Read-only sweep: instructions, real build/test commands (never invented), CI reality, boundaries, existing docs — then writes `.trust/project-brief.md` (the "constitution": rules already true for this repo) and a conservative `.trust/trust-policy.md`. Ends with a **pilot proposal**: one low-risk task class for the first evidence loop.

**Why it matters:** every later stage checks the brief instead of guessing. This is the brownfield answer — nothing is retrofitted, rules are only captured where they already exist.

### `frame` — vague idea → bounded brief
> *"Users keep losing their filter settings"* — what does that even mean?

One round of questions (max 5, each with a recommended default so "yes" is enough), covering the gaps agents usually guess at: who's allowed, what happens on retry, empty states, retention, rollback. Unanswered items stay `OPEN`, guesses stay `ASSUMPTION`. Sets the dose. Writes `brief.md`.

### `specify` — behavior before code
Turns the brief into observable behavior: numbered main flow, alternatives citing the step where they diverge, Given/When/Then acceptance examples. Ends at the **intent gate**: nothing proceeds until a human approves the spec. Critical work gets the full treatment (requirement IDs, domain model, use cases — see `references/spec-core.md`).

### `plan` — map behavior onto this codebase
Impact analysis by reading code (callers, data, contracts), a constitution check against the brief, a **pre-mortem** (top failure modes → detection → rollback), then tasks where each one names its **exact verifier command**. "Done" means verified, not edited.

### `implement` — the self-correcting loop
Per task: do → verify → record observed result. On failure: new evidence, falsifiable hypothesis, smallest repair, rerun. Budgets: 2 same-class repairs, 4 major cycles — then stop and escalate. Hard lines: never weaken a test for green, re-read the actual diff after every task, no silent scope creep.

### `verify` — work becomes evidence
Runs the **smallest credible verification set** covering the changed risks, then writes the Trust Verdict (the five questions). Skipped checks are reported separately — a green summary with buried skips is a failed verification. May propose a trust advancement (which goes to `trust`, never self-granted).

### `audit` — the big-diff reviewer
> *"The agent ran overnight and touched 500 files. Is it safe?"*

Read-only. Classifies every file (behavior/tests/config/deps/unrelated), surfaces scope leaks and orphans, reconstructs intent, inspects the diff's own tests for **circularity** (asserting what the code does instead of what it should do), analyzes downstream impact, and ends with: `trustworthy | conditionally trustworthy | not trustworthy` + required follow-ups. Honest about coverage: reading a diff is not running it.

### `ui-review` — inspect and repair the interface people actually use
> *"This page feels wrong. Test it against the product standards and fix the real problems."*

Runs the implemented surface at representative viewports and states, then evaluates product intent, visual hierarchy, interaction truth, responsive behavior, accessibility, runtime quality, and design-system consistency as separate axes. Findings carry evidence, user impact, severity, and an exact recheck. Authorized repairs repeat the same observed condition; a build or screenshot alone cannot close an interaction defect.

### `adr` — preserve the why behind durable architecture choices
> *"We have three viable approaches. Which one should we choose, and how do we keep the reasoning from disappearing?"*

First decides whether an ADR is warranted; tiny isolated changes and temporary experiments do not get process tax. When it is warranted, it inspects the repository's existing `adr/`, `adrs/`, or `decisions/` convention, records one decision with context, alternatives, consequences, owner, date, status, and a verifier/fitness function, then links superseding decisions instead of silently rewriting history. An ADR informs implementation but never proves runtime behavior by itself.

Use `$atl-adr` directly, or simply describe the architecture choice to `$atl` and let it route there.

### `trust` — the autonomy ladder
Decides what the agent may do alone next time, **per task class** (docs, refactors, features, migrations, auth/payments, production ops advance independently on L0–L7). The nine-question advancement gate must pass on recorded evidence; weak, stale, or unrepresentative evidence means no advance. Regressions trigger downgrade. Every change is explicit, in `.trust/trust-policy.md` + the ledger.

---

## 5. Two paths through the skill

**Beginner path** (solo dev, new project):
1. `$atl-bootstrap` — learn your own project honestly (you'll be surprised what's uncaptured)
2. `$atl-frame` + `$atl-specify` on your next feature — feel the difference when the agent stops guessing
3. `$atl-verify` before calling anything done
4. Add `$atl-audit` whenever an agent run is bigger than a screenful of diff
5. Ignore `trust` until you're comfortable — the conservative defaults already protect you

**Advanced path** (team, brownfield, agents running semi-autonomously):
1. `bootstrap` with the whole team reviewing the brief (it's your constitution — 30 minutes, once)
2. Frame/specify for anything touching a contract; Direct dose for the rest
3. `audit` as a merge gate for agent PRs; `verify` evidence linked in the PR description
4. `trust` sessions quarterly (evidence expires): which classes advanced, which downgraded
5. Customize: tune dose rules, artifact templates, and the conservative ceilings to your stack

---

## 6. What lands in your repo

~~~text
.trust/
  project-brief.md      # the constitution: real commands, boundaries, standing rules
  trust-policy.md       # task class → autonomy ceiling + required approvals
  ledger.md             # append-only: verdicts, failures, trust changes
  specs/001-filter-persistence/
    brief.md  spec.md  plan.md  evidence.md
~~~

Small by design — created only at the dose the change deserves, mapped into existing conventions (`.specify/`, ADRs, docs) instead of duplicating them. Delete the folder and nothing breaks; the skill rebuilds what it needs.

---

## 7. FAQ

**Is this just Spec Kit again?**
No — it borrows the best mechanisms (clarify-with-defaults, analyze passes, constitution) and drops the parts communities complain about: full-pipeline ceremony for small work, brownfield retrofit, no review/verdict stage, no autonomy governance. Spec Kit and this skill can coexist; `bootstrap` maps `.specify/` instead of duplicating it.

**Doesn't this slow me down?**
Direct dose is faster than any framework (it's just "do the small thing"). Standard adds ~1 page per stage — and the video-era math holds: an hour of framing beats ten rounds of "no, not like that". The dose table exists precisely so ceremony never hits trivial work.

**Solo dev — is the "human gate" just me approving myself?**
Yes, and that's fine: the gates force *explicit* intent decisions that would otherwise be silent agent assumptions. The spec-lite approval is one "yes".

**Can I use it with other skills?**
Yes. It composes: TDD-style skills slot into `implement`, architecture explainers feed `frame`, code review skills complement `audit`. It only asks that no other skill overrides its hard lines (no green-washing, no silent autonomy).

**Why `.trust/`?**
Short, collision-free, and honest about what the folder contains. Rename via the project brief if your convention differs.

**What about non-English teams?**
Work in any language; the agent answers in yours. The five questions and verdict structure are language-neutral.

---

## 8. Customizing

- **Templates** live inline in each mode file — edit them to your house style; keep the field names (later modes read them).
- **Dose rules** — the Critical triggers live in `SKILL.md`; add your own (e.g., "anything touching `billing/`").
- **Ladder ceilings** — start from the conservative posture in `references/ladder.md`; raise only through the `trust` gate.
- **Per-project** overrides belong in `.trust/project-brief.md` — that's what it's for.
