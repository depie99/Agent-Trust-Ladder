# Plan — 015 interactive run telemetry

Status: implemented locally; verification evidence recorded in the task handoff.

This slice adds complete wrapped run transcripts, structured per-session timeline
and JSON completion briefs, default click/wheel mouse capture with Shift+M
terminal-selection fallback, durable checkpoint/interrupt feedback, prompt
delivery on the next applicable provider session, scoped session interruption
and restart, and optional `--pause-after-bot` queue review gates.

Authoritative contracts remain `.trust/manager/state.json`, existing lifecycle
transitions/evidence gates, provider-neutral worker invocation, explicit launch
confirmation, and sequential queue execution.

Verification:

- `node verification/control_room_ui_test.mjs`
- `node verification/control_room_test.mjs`
- `node verification/feedback_test.mjs`
- `node verification/worker_test.mjs`
- `node verification/dashboard_test.mjs`
- `node verification/run_abort_test.mjs`
- all repository `verification/*.mjs` and `verification/*.py` checks

All checks passed in the implementation run.
