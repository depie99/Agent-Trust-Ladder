# Starting task trust policy
Updated: 2026-11-15. Conservative audit of local checkout `7f5defc` plus uncommitted work.

| Task class | Observed ceiling | Required gate |
|---|---|---|
| Local docs and audit | L2 | Review diff and relevant checks |
| Bounded Plan Studio changes | L2 | Approved behavior, focused tests, independent review before delivery |
| Coding worker and queue integration | L1 | Approved task/spec, isolated workspace, bounded run, explicit owner review |
| Scheduled or overnight execution | L0 | No autonomous dispatch until routine-to-executor and recovery are proven |
| GitHub PR creation | L0 | Scope and current-commit verification plus owner authorization |
| Merge or production action | L0 | Explicit human authorization |

These are conservative ceilings, not claims of earned autonomy. Raise a class only after positive and negative behavior, recovery, and independent evidence are recorded. Current pilot: prove a routine can select exactly one already-approved task and hand it to the existing bounded executor without duplicate dispatch after restart.
