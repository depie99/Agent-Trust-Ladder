<!-- ATL pre-test strengthening wave — 2026-10-21
Owner notes (not parsed as a task):
- Drop this file in .trust\manager\inbox\ of the ATL repo, then run: atl intake
- Process STRICTLY in task order, one task at a time through the full pipeline:
  Pip triage -> Mira assign -> Rowan build -> Sage review -> Beacon verify.
- Human gates kept human: push to remote, any real model spend, and the
  --confirm on the unattended run.
- Checks are written to be copied VERBATIM into --evidence-pass (the done gate
  compares exact string equality). Do not paraphrase them. -->

## Refresh the user install and prove it matches the repo
@priority: high
@risk: normal
@labels: install,pretest,gate

The installed ~/.atl runtime is stale (2026-10-20, missing worker/jev/learning/memory/skill-router/show-me/visual-pr). Bring the per-user install to exactly the current repo runtime so every later task exercises today's code. Do not touch PATH manually; the installer owns it.

Checks:
- scripts\install-atl.cmd runs from the repo clone and completes without error
- C:\Users\Sanaz\.atl\runtime\lib contains 13 .mjs modules including worker.mjs, jev.mjs, learning.mjs, memory.mjs, skill-router.mjs, show-me.mjs and visual-pr.mjs
- atl --help lists run, overnight, route, memory, show-me and visual-pr commands
- atl-mira.md through atl-beacon.md in %USERPROFILE%\.codex\prompts and %USERPROFILE%\.claude\commands match the repo runtime\prompts files by size and content (mtime is preserved on copy, so compare bytes, not dates)
- all five verification suites pass: node verification\install_test.mjs, intake_test.mjs, worker_test.mjs, learning_test.mjs, jev_router_test.mjs

## Sync docs and role prompts with the real runtime
@priority: high
@risk: normal
@labels: docs,prompts,gotcha

Remove the known tripwires before the first real run: the exact-match evidence gate is undocumented, runtime\README.md points to a prompts path that does not exist (~/.atl/prompts), and the root README still carries stale counts. Keep the docs-site theme untouched.

Checks:
- runtime\README.md references role prompts at runtime\prompts and no bare ~/.atl/prompts path remains in any repo doc
- pip.md, rowan.md, sage.md and beacon.md in runtime\prompts each state that --evidence-pass text must copy the completion check verbatim (exact string match)
- a text search for evidence-pass across runtime\README.md, USAGE.md and docs\team.html finds the verbatim rule next to the first mention in each file
- root README.md no longer claims "eleven skills" and uses the six-question Trust Verdict wording
- docs\team.html documents the same verbatim-evidence rule in the team usage flow

## Commit the tested tree as the pre-test release point
@priority: high
@risk: normal
@labels: git,release

Capture the tested runtime, skills, docs and verification state in clean local commits so the state the team is about to test is reproducible. This repo has had parallel sessions before: fetch and inspect the log before writing anything. Pushing is the owner's decision, not this task's.

Checks:
- git fetch origin ran and current branch plus recent log were checked before committing
- git status --porcelain lists no modified files and no untracked files outside .trust\manager\ (state, feed, inbox, briefs and workspaces are allowed runtime churn)
- the work is grouped into commits whose messages name their scope (runtime+verification, skills+commands, docs+config)
- git log origin/main..HEAD lists the new commits, proving nothing was pushed (owner gate intact)

## Run the first real team lifecycle end to end
@priority: high
@risk: risky
@labels: team,e2e,first-test

Prove the full role pipeline on Windows: in a fresh scratch project (never this repo), drive one small bounded task from new to done through the installed atl CLI with every role acting through --actor, and prove the gates that must reject, reject.

Checks:
- a scratch project reaches atl init, atl intake and one task closed done with every completion check showing PASS
- atl feed --task shows all five bot voices in order: Pip triage, Mira kick, Rowan running card, Sage review verdict, Beacon done card
- move triaged without an objective is rejected by the runner
- move done without matching evidence is rejected by the runner
- an assign attempt with --actor rowan is rejected as out-of-contract
- one changes-requested loop is exercised on the same task id: in_review to in_progress, then back through in_review, verifying, done

## Smoke the bounded unattended path safely
@priority: normal
@risk: risky
@labels: overnight,budget

Show the bounded worker path works and stops where it must, before any real overnight use. Dry-run first. A real capped run happens only after the owner says so, on a doc-only task, never on this repo's main checkout.

Checks:
- atl overnight <task-id> --worker codex --dry-run prints the plan without launching a model session
- the real capped run (owner-approved only) used --confirm with --max-minutes 60 and --max-sessions 1 on a doc-only task
- evidence and checkpoints were logged while it ran and the budget stop condition fired
- no merge, push, deploy or external message happened during the run
