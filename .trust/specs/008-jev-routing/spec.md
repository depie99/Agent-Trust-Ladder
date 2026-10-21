# Spec — 008 low-token Jev routing

Status: approved by explicit implementation request · 2026-10-21

## Behavior

1. Normal `route` and `triage` use local keyword/label routing without a model
   request.
2. `--smart` may send only bounded task fields and fixed route choices to Jev.
3. A missing key, timeout, invalid answer, low confidence, or HTTP failure
   falls back to deterministic routing and records the reason.
4. ATL never sends repository contents, secrets, conversation history, or full
   diffs to Jev.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| Jev disabled | route runs | local route is returned with no fetch |
| Jev returns confidence below threshold | smart route runs | deterministic route wins and reason is recorded |
| Jev returns a valid high-confidence choice | smart route runs | that available skill is selected |
| Jev times out | smart route runs | command remains usable and fallback is returned |
