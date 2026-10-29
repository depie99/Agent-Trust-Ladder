# Issue intake and overnight delivery: end-to-end scenario

Follow-up: [October 29 whole-process mock verification](mock-system-e2e-2026-10-29.md) adds Azure Boards, dependent queues, failure repairs, raw evidence and retained lessons. The results below describe the earlier, narrower run.

Run date: 2026-10-29. All issue records, tokens, providers, workspaces, and remote responses in this scenario are synthetic. The supplied `IT-1054109` and `IS-4846` URLs are examples only; the tests never request or modify them.

## Scenario and expected behavior

1. In **Issue sources**, configure an HTTPS Jira base URL and project key, or a GitHub repository. Keep credentials in environment variables. Preview issues without changing task state. Select candidates and import them into a named intake queue. Re-importing the same remote revision must not duplicate tasks.
2. An imported description with no observable completion checks is an unplanned task. `Plan task` sends its source and intent to Plan Studio. The proposed contract must include requirements, acceptance examples, implementation steps, verifier commands, and task proposals. An independent reviewer checks the draft. Approval must verify that the source revision is still current and publish a new execution queue. A changed Jira revision must reject approval.
3. Configure the allowed model pool with capability tiers and relative cost order. A standard-complexity task must use a standard-capable model even when a cheaper economy route exists. A missing capable route must block before spending. The manager may override provider/model per task.
4. Launch each published queue as an overnight run. The worker changes the isolated task workspace and records checks; Rowan reviews the work, Sage audits it, and Beacon verifies delivery. The active checkout must remain at the baseline commit. A successful run ends with tasks done, a completed run, and a ready delivery branch. Failed checks, review findings, stale sources, or exhausted limits must stay visible rather than being marked shipped.
5. Ask ATL in a task modal must preserve the conversation after a response and provide actionable next steps for blockers. A fix request must operate within the task workspace and return reviewable evidence. The manager can inspect the answer and close the modal deliberately.

## Executed mock coverage

| Area | Fixture and observation |
| --- | --- |
| Jira discovery and queue | Synthetic `jira.example.invalid` issue `IT-1054109` previewed, imported, and deduplicated through the control-plane API. Browser test saved a Jira source, previewed it, imported it, then found it on Tasks and Queues. |
| GitHub discovery and queue | Synthetic `example/demo#17` previewed and imported. No GitHub network request was needed. |
| Vague issue to plan | Both source tasks began without completion checks. A mock planning provider generated contract v2 with acceptance examples, verifier commands, and a proposed task; independent mock review preceded approval. |
| Source freshness | Mock Jira revision changed from `r1` to `r2`; approval returned HTTP 409. Restoring `r1` allowed approval. GitHub revision was also verified through mocked publish fetch. |
| Model suitability | With economy and standard models allowed, the standard task selected `standard-model` despite the economy model's lower cost order. Dedicated resource-policy tests cover ceilings, failover, and usage reports. These are policy decisions against owner-supplied tiers/cost rankings, not measured model quality or actual provider prices. |
| Two overnight queues | `verification/overnight_issue_e2e_test.mjs` ran the actual queue launcher twice against a local fixture worker. Each queue reached done and a ready delivery branch; the active checkout stayed at its baseline commit. |
| Agent team | The fixture advanced Pip, Rowan, Sage, and Beacon through the real launch orchestration. Dedicated team-panel and execution-report tests passed. Review judgments and code quality were simulated. |
| Ask ATL | `verification/control_assistant_test.mjs` exercised task-scoped conversation, provider/model validation, cancellation, task workspace protection, and fix review state. It does not establish that a live model gives a good solution to arbitrary issue prose. |

## Commands and results

The mock journey, browser journey, Plan Studio journey, queue recovery/delivery, task run, Ask ATL, resource policy, quota failover, execution report, team panel, and plan contract checks passed. Run the key paths with:

```text
node verification/issue_source_journey_test.mjs
node verification/issue_source_ui_journey_test.mjs
node verification/overnight_issue_e2e_test.mjs
node verification/control_assistant_test.mjs
node verification/resource_policy_test.mjs
```

An older `verification/intake_test.mjs` failed because it asserts that a configured public GitHub repository is unreachable. The repository was reachable through the local `gh` authentication. That test is environment-dependent and must use a mock probe before it can serve as a reliable gate. The new source and overnight journeys do use mocked network boundaries.

## What ATL should retain from this run

The strong path is source identity and revision tracking, a visible plan for vague input, independent review, bounded model routing, isolated execution, and a delivery branch that preserves the active checkout. The failures worth retaining are the older network-dependent test and the gap between a fixture worker's success and a real model's fix quality. A green mock run is evidence that orchestration works under these cases; it is not evidence that 2,000 real pull requests will be correct or that an external Jira/GitHub integration has been authenticated. A later pilot should use an owned test repository and test Jira project, with explicit publish authorization and measured quality, latency, token, and failure rates.
