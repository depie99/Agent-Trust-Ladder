# Workflow review — 2026-11-15

## Changes
- Imported cards show Azure/Jira source, work item, sprint, colored source priority and ready-review badge.
- Review details show source, sprint, provider/model, date and code-evidence coverage.
- Mermaid output removes duplicate status prefixes without treating unknown or proposed behavior as observed.
- Plan approval preserves `source_task_id` and `source_origin` on each executable child.
- Workflow run steps show task titles and Azure work item/sprint; a compact guide links review, Plan Studio and queues.

## Evidence
- Browser import/revision journey: Azure import, model plan, review, manual edit, regeneration failure/retry, reload, stale source refusal, fresh approval and two queued children. Origin assertions passed.
- Preparation UI/API: brief, investigation, owner question/answer, readiness gate, source revision drift and handoff passed.
- Batch API/browser: run selection, step title/origin, navigation and mobile fit passed; scope/limits, stop/resume, reconciliation and forged checkpoint refusal passed.
- Portable/runtime batch tests: bounded repair, mixed outcomes, interruption, deadline and persisted attempt limits passed.
- Single-task run tests: real spawned fixture process, preview/confirmation, scoped task isolation and pause gate passed. This is not a production coding delivery.
- Review UI: 205 cached reviews, evidence inspection, Mermaid/fallback, themes, RTL and mobile passed. Test output also included post-response missing temporary-state warnings during fixture teardown; these did not fail assertions.
- Review contract, triage, plan contract, review gate and planning-model selection tests passed.
- Actual configured `example-org-glm` / `glm-5.3-flash`: one isolated plan generation and accuracy review both returned HTTP 200. Review passed with two minor findings, including explicit BigInt assertion coverage. Raw bounded result: `.trust/blueprint-glm-smoke-result.json`.
- Live UI at port 4173 inspected. Screenshots: `.atl-evidence/workflow-review/`.

## Limits
- Existing archived/shipped S2H tasks were inspected as review context; no shipped task was reexecuted.
- Urgency is grounded in request metadata, dates and dependencies; code evidence is a separate review coverage claim. Unknown urgency remains unknown.
- Real Azure-to-coding-to-PR delivery was not demonstrated. The real external observation here is GLM planning/review; Azure mutation and PR creation were not part of this check.
- Source origin is preserved on newly approved tasks; historical children without it still lack that label.

## Using the flow
1. My Tasks: inspect source priority and ATL urgency; open Request review for findings, code references and provenance.
2. Preparation: check the brief, run discovery, settle questions, and hand off when ready.
3. Plan Studio: select a configured GLM model, generate, resolve blocking questions, inspect requirements/test seams and request a fresh review.
4. Approve the reviewed plan to create its queue. Approval alone does not execute it.
5. Queues: preview the exact scope and limits, then confirm the bounded run. Workflow runs exposes batch progress and recovery controls.
