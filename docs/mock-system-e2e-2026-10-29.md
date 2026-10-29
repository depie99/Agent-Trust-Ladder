# ATL issue-to-delivery verification — October 29, 2026

## Result and evidence boundary

**92/92 distinct verifier programs have a passing latest result.** This includes an 89/89 full runtime regression pass, two added source-adapter contract verifiers, and the separate full-operation verifier. The latter records **15 scenarios, zero failures**. Subsequent targeted runs verified the final adapter and browser changes. Counts refer to programs, not individual assertions or simultaneous autonomous agents.

The expanded overnight journey completed **three execution queues and six dependent tasks**, covering synthetic Jira, GitHub, and Azure Boards issues. Its verifier fails against the broken baseline. Fixture workers repair actual files in isolated Git workspaces; executable checks and browser clicks observe the resulting behavior. The queue launcher, role handoffs, state persistence, dependency handling, model policy and local delivery assembly are real runtime code. Planning responses, implementation choices and independent review judgments are deterministic fixtures.

No supplied production Jira issue, Azure work item, taskboard or sprint was requested or modified. No remote PR, push, merge, deployment or issue publication took place. Local Git commits/branches inside disposable fixture repositories are part of the tests. This was an accelerated overnight-run rehearsal, **not a multi-hour soak**.

The verdict is **locally proven for the recorded mock cases; live autonomous engineering quality remains unverified**. No finite scenario set establishes “without mistakes” for arbitrary incoming issues.

## Reproduction

```text
node verification/run_mock_regression.mjs
node verification/run_mock_regression.mjs e2e/full_operation_test.mjs
python verification/atl_manager_lifecycle_model.py
python verification/atl_manager_lifecycle_model.py --mutation-test
python verification/atl_lifecycle_model.py
python verification/dependencies_model.py
npm run ui:css:check
```

The regression runner discovers all top-level `verification/*_test.mjs` programs. It creates a separate home per test, removes inherited credential variables, blocks real Node HTTP/fetch requests outside loopback, and refuses `gh` subprocess calls. Tests use injected adapters and fixture credentials. Each program has a three-minute watchdog. Logs, exit codes, durations and timeouts survive failures. The full-operation verifier is an explicit additional command; the live-provider discovery script is deliberately excluded and does not execute a real fix anyway.

After a run, explicitly record lessons and consolidate results from a bounded first-run timestamp:

```text
node verification/record_mock_regression_lessons.mjs 2026-10-29T16-31-07-165Z
```

This script refuses to record a successful aggregate if any latest verifier fails. Historical failures remain in the aggregate. It stores six inspectable local lessons and asserts that the isolation lesson can be recalled. This is local memory, not model fine-tuning or automatic permission to relax gates. Fixture cost/performance samples are not promoted into this project's real model-routing estimates.

## Covering scenario

Use a clean scratch repository containing a broken interaction, a real failing verifier, isolated manager state, fixture providers, and no production credentials. Exercise each source independently, then execute separate queues so a failure in one source cannot masquerade as success in another.

| Step | Positive observation | Negative / containment observation | Evidence |
| --- | --- | --- | --- |
| Configure sources | Issue sources exposes GitHub, Jira and Azure Boards; save configuration without importing tasks | Reject malformed URLs, embedded credentials, invalid project/token names and Azure taskboard URLs used as collection URLs | `azure_issue_journey`, `jira_adapter_contract`, `issue_source_ui_journey` |
| Authenticate | Fixture Jira bearer and Azure PAT/basic headers reach the injected transport; GitHub CLI and REST shapes normalize | Missing tokens stop before transport; simulated HTTP 401 and unavailable GitHub transports fail visibly; credentials are not returned by source settings | Adapter contract tests |
| Discover | Filter Jira projects and Azure iteration; preserve identity, description, labels, priority and revision | Missing descriptions remain empty; missing revisions are not invented; CLI label objects retain their names; different Azure collections cannot share a dedupe identity | Adapter contract tests |
| Preview | Display candidates with zero task creation | Disabled sources cannot preview; a preview is not delivery evidence | Source journeys |
| Select/import | All three browser source flows import selected records into named queues; Tasks and Queues show them | Reject invalid tokens/indices/queue IDs; re-importing the same candidates does not duplicate tasks; imported descriptions retain the plan-review blocker | Source journeys, composer/control-room coverage |
| Shape vague work | Description-only Jira/GitHub/Azure records generate reviewed plans with two dependent proposals and observable checks | Unreviewed work cannot launch; generic local previews cannot bypass accuracy review; open questions, contradictory checks, unavailable skills and ungrounded paths block approval | Overnight journey, plan-contract/studio/dependency tests |
| Review and approve | Independent fixture review binds to plan content, project evidence and captured source revision; approval creates a new execution queue | Changed Jira/Azure revisions reject approval with HTTP 409; GitHub revision drift is covered separately; edits after review invalidate approval | Overnight, plan-publish and plan-contract tests |
| Route models | Standard work chooses a capable standard model despite a cheaper economy route; routine work can select economy | Observed complexity cannot be downgraded by a planner; owner ceilings, explicit overrides, unavailable routes and review rejection govern selection | Resource-policy unit/planning/launch/UI tests |
| Bound spending | Session ceilings, review capacity, extension limits, quota cooldown and configured failover apply | No capable allowed route blocks before spend; quotas do not trigger unchanged blind retries | Resource/quota/dependency tests |
| Start queues | Launch the real queue runner with explicit confirmation; dependent work follows prerequisites | Missing confirmation refuses launch; cycles fail; paused/blocked/dependent items keep truthful states | Overnight, multi-queue, run-control and dependency tests |
| Execute team | Pip shapes, Mira assigns, Rowan edits, Sage reviews, Beacon verifies; six tasks finish across three queues | Stale credentials, actor impersonation, expired leases and writes outside the worker channel scope are rejected | Overnight, worker-channel, session-auth, lease and team-panel tests |
| Verify behavior | Baseline verifier fails; repaired fixture passes executable checks and browser interaction | Failed/stalled/policy-mismatched workers do not become successful delivery; stale/rejected evidence does not inflate acceptance progress | Overnight, execution-status, diagnostics and dependency tests |
| Recover overnight | Retry/repair records, resume state, interruption handling and process-tree termination remain observable | No retry without a successful repair/preflight; exhausted or human-owned blockers remain contained; one task's budget does not falsely complete another | Recovery, run-abort, Windows-timeout, queue-recovery tests |
| Deliver locally | Each successful source queue has a ready delivery branch; inspect repaired content; active checkout remains at baseline | Remote publication is absent; failed queues are not ready to ship | Overnight and queue-recovery-delivery tests |
| Ask ATL | Task-scoped sessions, retained conversation, diagnosis, cancellation, provider validation and workspace-scoped fix proposals pass | No provider starts before the exact approval; fix scope is bound to the task workspace; approval/access protection remains effective | `control_assistant`, execution-access and modal tests |
| Inspect operational UI | Team, task, queue, report, provider/resource settings and knowledge surfaces pass; reload preserves navigation | Invalid saved routes fall back safely; Persian queue flow remains RTL; terminal errors fit narrow screens | UI, navigation, dashboard and TUI verifiers |
| Recover platform state | Backup integrity/restore, routines, notifications and bounded supervisor fairness pass | Lease fencing and approval denial prevent side effects | Full-operation E2E and dedicated verifiers |
| Retain learning | Store failures, successful patterns and limitations; recall the recorded isolation lesson | Passing mocks do not raise autonomy or claim actual model quality/cost | Local learning recorder and learning/resource-report tests |

## Azure mapping for the supplied examples

The supplied URLs describe a self-hosted collection, project and sprint. The corresponding fields are:

```text
Collection URL: https://devops.soitco.net:32678/Solico-Group
Project: Middleware-and-Portals
Iteration path: Middleware-and-Portals\Sprint 74
PAT environment variable: AZDO_PAT
```

This is a configuration interpretation only; it was not saved to the real workspace or used for network access. Tests use `devops.example.invalid` and synthetic work items. A taskboard browser URL is not a REST collection URL; the source form now rejects that mistake. TLS verification remains enabled by default. Existing configured TLS policy is preserved; no browser warning was bypassed. Reading the real sprint path, permissions or certificate validity remains unverified.

## Failures, repairs and lessons

Every failed attempt remains in the [aggregate](../.atl-evidence/mock-regression/aggregate-2026-10-29.json), including intermediate repair attempts. There are **22 recorded failed verifier invocations** across the retained history; they are not 22 independent product bugs.

| Finding | Repair / disposition | Re-observed proof |
| --- | --- | --- |
| Azure adapter existed but source API/page only accepted Jira/GitHub | Added Azure settings, preview and browser import; retained reviewed planning flow | Azure API, three-source browser and three-queue overnight journeys pass |
| GitHub CLI labels are objects, but adapter converted them to `[object Object]` | Normalize both object and string labels; normalize trailing issue-list URL slash | New GitHub adapter contract passes priority/labels, CLI and fallback cases |
| Recovery did not recognize the quota wording emitted by the worker | Classify exhausted-quota/rate-limit messages as provider quota | Dependency and quota verifiers pass without blind retry |
| Command error text exceeded terminal width | Wrap diagnostics with the shared word-aware layout helper | Narrow TUI and Plan Studio API refusal checks pass |
| Team/settings headings lacked current Persian keys | Added the missing translations | Full Persian route/RTL test passes |
| Dashboard test depended on the mutable development portfolio | Create its own five-task fixture | Dashboard verifier passes independently |
| Two browser checks expected a pre-existing server on port 55012 | Start a fresh local fixture server per test | Reload and Persian queue checks pass independently |
| Legacy GitHub intake test assumed authentication failure | Inject offline transport/CLI refusal; no real repository is needed | Intake verifier passes with network blocked |
| Several tests expected old markup, generic-plan approval or blind retries | Align fixtures/assertions with the current review contract and independently bounded task sessions; keep refusal assertions | Status, server, dependency and run-control checks pass |
| First offline harness wrapper lost `execFile`'s promisified return contract | Preserve `{stdout, stderr}` and error outputs in the offline wrapper | Control-room and sandboxed worker-channel tests pass |
| First terminal fix split words inside API errors | Replace character chunks with word-aware wrapping | Plan Studio API and TUI tests pass together |

### Harness isolation incident

The initial runner incorrectly exported `ATL_PROJECT` as the development repository. CLI tests that did not override it could target development configuration. The legacy intake test also performed a real read-only `gh` probe of the configured GitHub repository before offline blocking was added. No GitHub issue mutation or remote publication occurred, and none of the supplied Jira/Azure hosts was accessed.

The override was removed, credential variables were scrubbed, external Node transports and `gh` were blocked, and affected tests were rerun successfully. The development configuration was already modified before this session and its exact pre-run contents were not captured. **Preservation of those pre-run configuration values cannot be certified**, so no speculative rollback was applied over existing user work. This incident is retained as a local lesson: snapshot mutable configuration before broad CLI verification, and never impose a parent project override on isolated tests.

## Evidence locations

- [Latest result for every verifier, with raw-log links](../.atl-evidence/mock-regression/aggregate-2026-10-29.md)
- [All latest results, historical failures and learning receipts](../.atl-evidence/mock-regression/aggregate-2026-10-29.json)
- [Full-operation scenario report](../.atl-evidence/full-operation/2026-10-29/report.json)
- [Lifecycle/dependency models, stylesheet parity and 179 syntax checks](../.atl-evidence/mock-regression/non-js-checks-2026-10-29.json)
- [Three-queue delivery trace, tasks, dependencies and evidence](../.atl-evidence/issue-overnight/2026-10-29T16-49-20-172Z.json)
- [Desktop source forms](../.atl-evidence/issue-sources/sources-desktop.png) and [mobile source forms](../.atl-evidence/issue-sources/sources-mobile.png)
- Local retained lessons: `.trust/manager/learning.json`; the recorder verified recall.

Independent Chrome inspection also confirmed the rendered Issue sources page exposes all three providers and the Azure collection/project/iteration/PAT fields. This was read-only navigation against an isolated local server. The supplied SVG was inspected as a source-form/preview design reference; this session did not undertake a complete visual redesign.

## Trust verdict and remaining boundaries

1. **What changed:** Azure source integration, real GitHub label normalization, quota classification, terminal wrapping, two translations, isolated verifiers, durable run evidence and six local lessons.
2. **Why:** Missing Azure UI integration and misleading test assumptions prevented credible whole-process mock verification.
3. **What could break:** Real authentication, provider variability, self-hosted TLS/proxies, source pagination, sustained concurrency and external outages remain outside these fixtures. Azure currently caps a query at 100 IDs; GitHub discovery caps at 50 issues. These runs do not prove complete large-backlog discovery. Azure dedupe keys now include collection identity; existing older-format imported keys need migration assessment before a live upgrade.
4. **Downstream impact:** The source settings API now includes Azure. Imported work still passes reviewed-plan and execution gates. No global trust policy or autonomy was advanced. Existing unrelated changes were preserved; the configuration-isolation incident above limits that preservation claim.
5. **Objective achieved:** The defined mock issue-to-plan-to-dependent-queue-to-local-delivery path, Ask ATL contracts, team boundaries and resource-policy behavior passed. Arbitrary live fixes, useful live-model planning and measured quality/token economics were not established.
6. **Contracts directly observed:** Source adapter shapes → API → browser forms → canonical tasks → reviewed plans → persisted queues → scoped team sessions → executable/browser evidence → local delivery branches. Build stylesheet parity and lifecycle/dependency models also passed. Real remote services, real provider completions, remote PR delivery and a multi-hour overnight run remain unobserved.

The next meaningful gate is an explicitly authorized pilot on owned disposable remote projects with real providers, measured outcomes and costs, plus a sustained overnight soak. The current result is complete for this finite mock rehearsal and conditional for production use.
