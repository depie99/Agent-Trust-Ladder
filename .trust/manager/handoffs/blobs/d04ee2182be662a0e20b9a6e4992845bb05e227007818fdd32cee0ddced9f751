# Mode: bootstrap — learn an existing project before working on it

Read-only except `.trust/`. Goal: a project brief honest enough that a fresh agent could work safely on this codebase, plus a starting trust policy that errs low.

## When

First session on an existing repo (brownfield), first use of this skill on it, after a long gap, or after a major architecture change. If `.trust/project-brief.md` exists and is current, refresh the stale sections instead of rewriting.

## Steps

1. **Protect.** Note uncommitted work, secrets, generated files. Change nothing outside `.trust/`.
2. **Discover the truth, not the docs.**
   - Instructions: AGENTS.md / CLAUDE.md / README / CONTRIBUTING / CI configs.
   - Stack and structure: manifests, lockfiles, entrypoints, module boundaries.
   - Real commands: build, test, lint, run — only what is actually configured (package scripts, tasks, workflows). **Never invent one.**
   - Verification reality: what is checked today (tests? types? lint? CI?) and — more important — what is *not* covered.
   - Boundaries: data stores, external services, deploy targets, where production-like danger starts.
   - Existing specs, docs, ADRs, runbooks: map them, do not duplicate them.
3. **Interview the user** only for what code cannot answer: owners, intent behind oddities, known fragile areas, decision rights. Batch all questions into **one round**.
4. **Write `.trust/project-brief.md`** using the template below. Honesty rules:
   - Capture rules that are *already true* for this repo. Do not invent standards to fill the template.
   - Mark unknowns `OPEN`. Mark inferred behavior `ASSUMPTION (source)`.
   - Keep it under ~150 lines — it gets loaded often.
5. **Write `.trust/trust-policy.md`** with conservative defaults from [references/ladder.md](../references/ladder.md) §Conservative starting posture, adjusted to the observed verification reality (a repo with no CI cannot hold L3 anywhere).
6. **Propose a pilot**: one low-risk, representative task class for the first Standard-dose loop. Bootstrap succeeds when one honest verify loop has run on the pilot — not when the files exist.

## Output template

~~~markdown
# Project Brief — <name>
Updated: <date> · Source: live inspection of the repo, not memory
## Map
<architecture in 5–10 lines: layers, boundaries, entrypoints>
## Commands
<build / test / lint / run — exact, as configured>
## Verification reality
<what is checked today, by what; known coverage gaps>
## Constitution — standing rules every change must obey
- Architecture: <boundaries, layering, ownership>
- Data: <origin, validation, retention, migration rules>
- Security: <secrets, authz, audit>
- Reliability: <errors, retries, logging, rollback>
- Delivery: <required checks, migrations, release rules>
## Risk register
<fragile areas, protected data, irreversible spots>
## Owners & decision rights
<who approves what>
## OPEN / ASSUMPTION
<each with owner or source>
~~~

End with: brief location, the pilot proposal, and the suggested next mode (`frame` for real work, `trust` to review autonomy ceilings).
