# ATL evaluation workbench

This dependency-free development suite separates skill structure, routing
decisions and implemented behavior. It does not launch model providers or spend
API credits. Existing participant outputs are replayable evidence, not new model
runs when the commands are rerun.

Run from the repository root with Node 22+ and Python 3:

```sh
python scripts/build_mode_skills.py --check
python -B verification/build_mode_skills_test.py
node verification/atl_skill_eval_test.mjs
node verification/atl_poc_grader_test.mjs
node evaluations/atl/run.mjs evaluations/atl/pilot/baseline-decisions.json evaluations/atl/pilot/atl-decisions.json evaluations/atl/pilot/report.json
node evaluations/atl/poc/run.mjs
```

The decision runner writes a descriptive report; nonzero quality loss does not
change its exit status. Malformed submissions fail. The PoC runner exits nonzero
on infrastructure errors or failed acceptance assertions. Neither command edits
the participants' modules. Reports include timestamps and will change on replay.
The PoC runs each condition in a child process with a 10-second deadline and
bounded output. This limits accidental hangs; it is not a security sandbox for
untrusted code. Its mutation checks verify the grader detects known bad behavior.

| Resource | Purpose |
|---|---|
| [cases.json](cases.json) | 12 development cases with explicit allowed routes and doses |
| [lib.mjs](lib.mjs) | Fail-closed submission validation, paired descriptive grading, byte/link inventory |
| [run.mjs](run.mjs) | Replay decision submissions and record hashes |
| [pilot/](pilot/) | Independent baseline and ATL decisions, read metadata and report |
| [poc/task.md](poc/task.md) | Identical contract given to both implementation participants |
| [poc/run.mjs](poc/run.mjs) | Acceptance assertions written independently of participants |
| [poc/runs/](poc/runs/) | Frozen candidate modules and self-reported check provenance |
| [poc/report.json](poc/report.json) | Actual implementation assertion outcomes |
| [SUMMARY.fa.md](SUMMARY.fa.md) | Findings, limits and next experiment in Persian |
| [AI evaluation guidance](../../skills/atl/references/ai-evaluation.md) | Research basis, methods and comparison design |

The pilot was run in isolated agent contexts. Participants received the same
task descriptions, condition-specific skill access and a required response
schema. Expected routes were authored during the pilot, and the parent had
already seen a baseline response; grading was not blinded or preregistered.
The 12 stored prompts are concise
normalizations of the supplied descriptions, not a byte-identical prompt archive.
Baseline retained platform instructions; neither model identity nor token/cost
telemetry was independently exposed. This is not a randomized controlled study.

The ATL decision pilot read the original entrypoint. The implementation PoC used
the refactored entrypoint. They are separate trials and cannot establish that the
refactor preserved all routing behavior. Participant self-tests are not the
external evaluator. Each evaluator assertion is a contract check, not an
independent model/task sample.
The implementation participants reused their respective decision-pilot contexts;
these were not clean model sessions, and retained instruction context is a
further confound. No participant outputs were repaired after external grading.

For a new trial, give participants only the task text and minimum raw context,
write to fresh directories, pin all instruction/task/evaluator hashes before
launch, retain raw prompts, transcripts and measured provider telemetry, and
keep held-out tasks away from skill authors. Add repetitions and real repository
issues before claiming an improvement. See the guidance for judge calibration,
pass@k/pass^k and ablation design. The optional suite lives in repository source;
it is not currently included in the published package's file allowlist.
