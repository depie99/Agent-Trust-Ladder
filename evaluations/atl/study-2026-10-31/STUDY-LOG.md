# Study log — atl-development-replay-2026-10-31-v2

## 2026-10-31 (session 2)

- All five independent graders now exist and are **calibrated**: each FAILs on the
  case's base (pre-fix) revision and PASSes on the reference-fix revision.
  New graders: `grade-simple-v2.mjs` (test-source exact-heading assertion + live
  Playwright headings/RTL), `grade-worker-atlbin.mjs` (workerEnvPolicy ATL_BIN
  contract + claude credential stripping + launch set-map merge), `grade-docs-paths.mjs`
  (local .atl-evidence paths visible as code text, none is a Markdown link).
  Calibration harness: `calibrate-graders.mjs` (5×2 checks, all OK).
- Sequencing driver `run-remaining.mjs`: iterates frozen schedule, skips recorded
  trials, runs trial → grader → `record-result-v2.mjs`. Aborts the whole sweep if
  the provider reports a usage/rate limit (infrastructure failure, not a trial).
- **Incident:** after 4 valid trials the ChatGPT/Codex account hit its usage limit.
  31 further launches failed in <12s with `turn.failed: usage limit ... try again
  at 7:09 PM` — the model never received task work, so these are **not trials**.
  They were quarantined (not deleted) to `.atl-evidence/trials-v2-quota-blocked/`
  with `MANIFEST.json`, so the schedule slots stay runnable after quota reset.
- Graded pre-limit run B1-REAL-BUG-CLI-ONCE-specialist-only: PASS ($0.30, 163s).
  One out-of-scope path (`.atl/project.json`) recorded.
- Recorded so far: 4/75 (SIMPLE ×3 conditions, REAL-BUG specialist-only).
  No conclusion yet — repetition 1 of 5, and 4 of 5 cases untouched.
- Driver relaunched in background, gated on quota reset at ~19:12 local.

## Honest-status note

No ATL-vs-baseline claim is supported at n=1. The preregistration
(`preregistration-v2.json`, sha256 pinned in schedule-v2.json) was not modified.

## 2026-10-31 (session 3) - v3 skillbench complete + ATL strengthened

- v2 (Codex replay on product issues) superseded per owner direction: tests must
  target the ATL skills themselves, model switched to GLM-5.3-flash.
- v3 preregistered and fully executed: neutral skillbench (expense-tracker fixture,
  5 cases: bug/feature/ui/docs/refactor) x {baseline, specialist-only, atl} x 3 reps
  = 45/45 trials recorded, graded by 5 calibrated graders (fail pre-fix, pass fix).
- Result: task success 15/15 in EVERY condition. Observed differentiator is cost:
  mean subagent tokens baseline 194.6k, specialist-only 316.9k, atl 312.8k (1.61x
  baseline). n=3, purpose-built tasks, self-graded harness: development signal only.
- Strengthened skills/atl/SKILL.md from observed failures: Direct-dose economy rule
  (one-line manifest, six-line verdict, single verifier run, no throwaway probes) and
  known-environment shortcut (node --test <dir> MODULE_NOT_FOUND on Windows).
- Confirmation (post-hoc, n=3 per case, FEATURE + REFACTOR): atl tokens -29.3% and
  -11.6% vs frozen snapshot, 6/6 pass. ATL remains ~1.2-1.6x baseline tokens.
- Committed and pushed as a92ff48. No accuracy superiority or general-improvement
  claim is supported by this data.
