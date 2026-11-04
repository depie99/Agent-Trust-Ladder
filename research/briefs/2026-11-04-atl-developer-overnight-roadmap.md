# ATL Developer Roadmap: Azure Boards to Verified Overnight Delivery

Date: 2026-11-04

Status: Product prioritization and phased engineering proposal. No runtime, installed scheduler, queue, provider configuration, trust level, or remote system was changed by this review. Seven focused local suites were executed; their boundaries are recorded below.

User decision: **Azure Boards is the first intake source for the real pilot.**

This roadmap supersedes the implementation order in the [consolidated enhancement review](2026-11-04-atl-enhancement-review.md) and [second research batch](2026-11-04-atl-enhancement-review-batch-2.md). Those documents remain the source catalog. E01-E16 below refer to the consolidated review.

## 1. The product worth building first

The first compelling ATL experience is:

> Select real Azure Boards work, see which tasks are ready tonight, approve one bounded run, and return to a reviewable delivery with the changed files, observed behavior, acceptance evidence, and remaining decisions in one place.

The useful promise is less supervision with stronger evidence. A large agent roster, another knowledge database, an impressive graph, or many successful model sessions is not the product outcome.

The first pilot should use one Azure organization/collection, one project, one iteration or saved query, one repository, one supported application stack, and a small set of contained changes. Choose changes with objective acceptance behavior: a reproducible bug, a bounded UI interaction, a covered validation rule, or a similarly observable result. Do not begin by claiming arbitrary backlog completion.

There are two different forms of completion:

- **Verified local delivery:** the final composed revision has current acceptance evidence and independent review, with a reviewable local delivery artifact.
- **Published or shipped delivery:** the intended remote branch/PR exists at that revision, CI has the required result, and any merge/deployment boundary has actually been reached.

The first experience must label the boundary honestly. An intended PR is not a published PR, and a local passing run is not a deployment.

## 2. What a developer can credibly get today

These are capabilities observed in the source checkout and, where stated, exercised by local tests. They do not establish readiness of the user's installed runtime or authenticated Azure environment.

| Developer value | Existing implementation and evidence | Current limitation |
|---|---|---|
| Bring Azure tasks into a visible queue | Azure adapter, HTTPS validation, PAT environment-variable configuration, iteration filtering, preview/import, remote identity/revision, and duplicate-import protection. Azure journey suite passed again. | Requests in the suite are synthetic. Real organization access and the selected repository still need one live read-only pilot. Same-revision deduplication does not establish every new-revision reconciliation case. |
| Turn a description into executable work | Plan Studio has contracts, checks, dependencies, separate plan review, and stale-source rejection. Synthetic end-to-end suite passed for Jira, GitHub, and Azure. | Model-generated plan quality is simulated in that suite. Ambiguous product decisions cannot be made reliable by repeatedly generating a plan. |
| Execute away from the active checkout | Isolated workspaces, prerequisite composition, gated roles, bounded sessions, and local delivery branches. Recovery/delivery suite passed again. | Correct orchestration with fixture workers is not measured live-model coding quality. |
| Avoid some recurring manual repairs | Preflight, preparation journals, bounded contract repair, dependency repair, independent-work continuation, and persistent repair accounting already exist. | Known recipes cover particular classes. Missing authority, unsupported environments, and uncertain effects still require a real decision or capability. |
| Inspect the actual file changes | Existing Review changes view: file tree, pinned snapshots, diffs, evidence freshness, relationships, and contract Statechart. Task-change suite passed again. | The suite proves data/attribution behavior, not rendered layout. A statechart shows a contract; it is not proof the run followed it. Automatic captures, artifact-content viewing, and morning digest are not established by that view. |
| See execution resources honestly | Resource policy, model tiers, session ledger, usage coverage, and unknown-usage handling. | A relative cost order is not a bill, and token savings versus another workflow have not been established. |

The current value is a foundation for a controlled developer pilot. The entire promise of unattended, interruption-resistant overnight delivery with 99% correct completion has not been demonstrated.

## 3. Corrections to the earlier enhancement ordering

Re-reading the reports against the current code changed the priorities:

1. **No-progress prevention already exists in a bounded form.** The supervisor avoids relaunching a settled task during the same invocation, continues independent work, and passes on the remaining time allowance. Its regression suite passed. Rich failure-signature reasoning and carefully justified re-entry remain possible extensions. E11 should extend and validate this behavior, not recreate it.
2. **Recovery is already substantive.** Preparation/handoff repair, preserved inputs, bounded remedies, and verified integration exist. The gap is reliable use in the installed environment and more validated recovery classes, rather than adding a generic retry agent.
3. **Continuous hosting remains a real gap.** The supervisor exits when it is idle. Routine records are not connected to complete worker dispatch in the inspected path. The Windows adapter constructs scheduler commands; its passing test explicitly does not install or run a scheduled task.
4. **Recovery without human intervention is not the current interruption contract.** The recovery suite requires fresh confirmation and excludes an in-flight provider task with unknown effects. Automatic resumption would need an explicit bounded authorization and a verifiable reconciliation contract, rather than removal of that protection.
5. **Visual inspection already exists.** Improve its usefulness and validate its real rendering; do not start by designing another graph viewer.
6. **Memory is important, but does not come before one trustworthy execution path.** Capture small operational facts immediately; improve retrieval before broadening task classes. A new second-brain framework is not a prerequisite.
7. **Public-source facts can be overstated in summaries.** The re-read Plusxbt article explicitly says that its weekly-review skill is manual, dates do not perform live verification, and instructions do not enforce restrictions. Those are cautions already present in the source, not newly discovered omissions in it.

## 4. Phase order and user-visible milestones

Effort labels are relative engineering size, not calendar promises. Existing features may need validation or integration rather than new implementation. The chosen repository, installed runtime, provider, and baseline failures must be inspected before defensible time estimates.

| Phase | What the developer receives | Main work | Exit evidence | Relative effort / uncertainty |
|---|---|---|---|---|
| P0: One Azure task, end to end | A real imported task reaches a verified local delivery and can be inspected visually. | Live read-only intake, project readiness, acceptance mapping, one reusable journey, existing queue and change-review integration. | One actual model fixes a real contained task; an independent check observes the result; the final diff and evidence match the same revision. | Medium; uncertainty is concentrated in the target environment and provider. |
| P1: A night that finishes or explains itself | A bounded night runs without preventable intermediate questions, recovers supported faults, and continues independent work. | Durable start/dispatch/resume integration, health/preflight, recovery classification, persistent limits, host and idle behavior. | Several bounded live nights, including interruption and temporary outage; no lost/duplicated work or silent success. | Large; highest operational uncertainty. |
| P2: A morning delivery the developer can trust | One concise delivery page connects requirements, changes, proof, repairs, and the actual delivery boundary. | Structured findings, evidence capture/readback, targeted repair, final composed verification, digest and available artifacts. | A seeded defect is caught; stale evidence cannot complete work; retained evidence survives cleanup; review finds the final behavior reproducible. | Medium to large; depends on the verification surfaces. |
| P3: Less repetition and lower accepted-outcome cost | ATL remembers the correct project procedures and confirmed failures, retrieves relevant facts, and avoids paying repeatedly for the same diagnosis. | Ranked retrieval, temporal validity, versioned operational knowledge, scoped preventers, context/model experiments. | Relevant knowledge is retrieved at a fixed budget; a repeated failure is prevented; savings are observed without degraded completion quality. | Medium; savings magnitude remains unknown. |
| P4: A measured reliability target | A narrow supported task class earns a published success rate with an uncertainty interval. | Held-out task cohorts, fault injection, live-model outcomes, human review, delayed defect checks, regression tracking. | The declared 99% target is supported for the sampled class and environment, or the actual lower result is reported. | Ongoing; sample size and task distribution dominate. |
| Later | More sources, hosts, harnesses, and presentation options. | Optional UHP adapter, Obsidian export, demonstration-derived routines, more concurrency. | A demonstrated need and a passing contract justify each extension. | Conditional. |

Basic evidence and usage recording start in P0. P2 improves completeness and inspection; P3 improves retrieval and economics. P4's measurements begin in P0, even though a reliability claim comes later. These phases must not become sequential excuses to postpone essential proof or cost visibility.

### P0: Prove the first useful developer experience

Use the existing Azure integration first. Configure the selected project and iteration; confirm real read access; preview and import one item. Keep credentials in the supported environment mechanism, not model context.

Create a proposed **Ready for tonight** assessment using the existing preflight and readiness contracts. It should identify the exact installed server/UI/worker versions, source and code revision, executable acceptance checks, provider access, workspace handoff channel, dependencies, browser/runtime readiness, isolated test data, authorized actions, and remaining budget.

Readiness is not merely a saved settings form or a provider's response to a trivial prompt. A bounded rehearsal must exercise the tool and handoff path required for the task. A task that needs an unknown secret or an undefined product decision should surface that before the night starts.

Build or repair one project-specific verifier using the repository's actual commands. Run the broken baseline where possible, the fixed path, independent readback where state is persisted, and the final revision's checks. Retain the exact diff and proof. [S01] supplies the verifier lifecycle pattern.

For Azure reconciliation, distinguish stable work-item identity from source revision. Re-importing the same revision must not duplicate work. A newer revision must not silently create a second concurrent implementation or preserve stale approval. Define the refresh/replan behavior explicitly rather than inferring it from the existing duplicate-import test.

**P0 is complete when:** the user can import one real work item, see it in the queue, run it with an actual supported provider, inspect the changed files and observed behavior, and reproduce the delivered result. Failure is a useful pilot result if the exact failed boundary is recorded; it is not a completed P0.

### P1: Make unattended execution operationally real

The night needs a durable execution envelope: admitted task IDs and revisions, allowed tools/actions, task and run allowances, host policy, deadline, recovery rules, checkpoints, and expected morning output. The user approves the bounded run once; expected internal handoffs should not ask the same question repeatedly. A new authority boundary remains a separate decision.

Connect scheduling and durable run records to the existing executor. Preserve the run identity, queue lock and lease generation across restart. Decide explicitly whether an idle host should wait for eligible arrivals or finish a finite batch. Handle overdue starts and missed occurrences according to a declared policy; do not replay all missed nights blindly. Budgets and deadlines must survive restart and include previously spent work.

The initial local design should use bounded Azure API synchronization/reconciliation, with no model call merely to discover that nothing changed. Microsoft documents a public-endpoint requirement for service hooks and says they cannot target localhost [S05]. Webhook retries are finite and subscriptions can become restricted or disabled [S06]. A public ingress service is therefore optional later infrastructure, not a prerequisite for the first local pilot. Use the existing WIQL capability [S07] and stable source identities.

Use three blocker lanes:

| Lane | Examples | Expected behavior |
|---|---|---|
| Prevent before launch | Wrong runtime/UI pairing, missing locked dependencies, unusable test browser, wrong working directory, missing scoped handoff channel. | Fail readiness early; record the reusable project procedure after a verified repair. |
| Recover automatically within the approved envelope | Temporary connection failure, stale local preparation receipt, owned temporary-port conflict, a supported contract-metadata repair. | Classify, apply a bounded supported remedy, observe its postcondition, and retry only with changed evidence. An alternative provider must already be allowed and suitable. |
| Isolate for a decision | Unavailable credentials, ambiguous acceptance, unknown external effect, unsupported capability, budget extension or production authority. | Preserve evidence, park only affected work, continue independent admitted tasks, and put one actionable item in the morning inbox. |

The target is zero avoidable manual repair, not a promise to manufacture missing permissions or decide unknown product intent. Never solve repeat blockers by weakening checks, resetting accounting, or treating an unsafe replay as recovery.

For a local pilot, the chosen machine must actually remain available. A laptop that sleeps is not an always-on host. If the required operating model includes closing or powering off that machine, select a persistent runner before claiming overnight availability. No new host or schedule was installed in this review.

**P1 is complete when:** bounded live trials cover a temporary provider/network outage, process interruption, restart from a safe checkpoint, one permanently blocked task alongside independent work, and an idle-to-arrival or declared batch-end case. Three trial nights are an initial engineering milestone, not evidence of 99% reliability. Unknown-effect interruptions must remain contained unless their authorized reconciliation is directly proved.

### P2: Make the morning review a short, evidence-based decision

Extend the existing change-review experience rather than adding another dashboard. The morning delivery should show:

1. The Azure item, accepted requirements, source revision, baseline, final content identity, and actual delivery location.
2. A file tree and reviewable diffs, plus a concise explanation of changed behavior and affected contracts.
3. A requirement-to-check matrix: complete/pass, failed, partial, or unobserved. No unexplained aggregate confidence percentage.
4. For UI work, the observed before/after behavior, screenshots and relevant interaction evidence. For API, CLI, data or storage work, appropriate responses, command output, or independent readback instead.
5. Independent findings, the affected revision, repair attempts, and the final recheck. A screenshot alone does not prove persistence or completeness.
6. Artifact availability, not only a hash or a path; the final runnable output, reproduction instructions, and cleanup/rollback notes.
7. Total recorded usage, coverage gaps, run outcome, blockers, and the precise next action for the owner.

Capture stable checkpoints or final completed output automatically where an authorized consistent snapshot is available. Do not capture a busy changing workspace and present it as transactionally exact. Reuse the existing immutable snapshots, association checks and content hashes.

For integrated work, rerun the relevant complete acceptance set on the final composed revision. Checks on an earlier individual task must not stand in for final integration. Open findings cannot disappear merely because another worker exited successfully. UI, API-only and library task classes need deliberately appropriate verifier contracts; any change to a mandatory current runtime gate is an explicit design decision, not an implicit bypass.

**P2 is complete when:** a developer can inspect and reproduce the final result without reading agent transcripts; a deliberately broken journey is rejected; stale or missing proof stays visible; a task cannot become complete by changing its own success criterion. Real rendered inspection of the installed Control Plane is required in addition to DOM or data tests.

### P3: Make memory and token efficiency useful in daily work

Capture a small project profile from P0: supported run/build/test commands, environment fingerprint, readiness checks, owned data/ports, correct worker handoff procedure, relevant decisions, and validated recovery recipes. Keep execution state in the manager and operational knowledge in the existing brain/learning paths. Neither is a substitute for the other.

The observed brain retrieval uses the entire query as a substring and takes a bounded first slice. Improve it with lexical ranking, a small topic index, role-specific selection, bilingual queries, source/status/freshness information, and an explicit missing-evidence result. Keep old decisions as history, with an explicit active replacement. A remembered recipe must be rechecked when its tool, lockfile, verifier, runtime or project contract changes.

Convert confirmed recurring failures into scoped enforcement in the strongest suitable layer [S02]. A good lesson is an executable prevention or a verified procedure tied to its environment, not another long general instruction.

Optimize **total tokens and cost per independently accepted outcome**, including failed attempts, planning, review, verification, and repair. Use deterministic code for stable transformations and orchestration; avoid loading complete history or the entire repository for every role. Reuse artifacts and cached context only while their inputs remain valid. Use the cheapest route that demonstrably meets the task's quality requirement; a cheap first pass followed by expensive repair may cost more overall. Missing usage remains unknown.

Optional critics, fan-out, advisor escalation, and larger context bundles should earn their cost in controlled comparisons. Anthropic's long-running-harness report explicitly supports testing simplification component by component [S03]. Required ATL gates are not removed as an optimization shortcut.

**P3 is complete when:** measured retrieval improves on real project questions under a fixed budget; a changed environment invalidates the right recipe; a previously recurring failure is caught; comparable accepted outcomes cost less without increased failures or manual intervention. No savings percentage is predetermined.

### P4: Turn 99% into a claim that can be checked

For an individual delivered task, every required acceptance obligation should be satisfied or explicitly unresolved. "99% complete" must not mean knowingly leaving one mandatory requirement unfinished.

For reliability across tasks, define the denominator and the task class before the run. The primary target is:

**Unattended correct completion rate = admitted tasks that reach the declared deadline with independently accepted complete output and no unplanned manual repair / all tasks admitted to that cohort.**

Keep blocked, exhausted, failed, aborted, and missing-result tasks in the admitted cohort. Explain their causes separately. An issue rejected by readiness is not a successful completion; publish readiness rejection and overall backlog coverage as well so eligibility cannot be narrowed after seeing outcomes. Planned morning review is different from an unplanned intervention required to make the work finish.

Track operational execution reliability, accepted-output quality, false completion, manual intervention, escaped defects over a predeclared observation window, acceptance coverage, review delay, and cost separately. A successful scheduler does not establish correct code. A passing test suite establishes its observed checks, not the absence of every possible defect. A model/provider or task-class change can invalidate the scope of a previous reliability estimate.

Statistical illustration: for independent representative pass/fail trials from a fixed task distribution, with zero failures, a one-sided 95% exact lower bound is 0.05^(1/n). To put that bound at or above 99% requires **299 successful trials**. This calculation follows the exact binomial approach described by NIST [S08]; 0.05^(1/299) is approximately 0.990031. Repeating the same fixture is not 299 independent production tasks. Correlated bugs, environment drift and unobserved defects limit the interpretation. With failures, compute the appropriate interval rather than resetting the record until a clean streak appears.

Do not spend on hundreds of provider runs before the pilot is stable. Begin with a small development cohort, fix observed causes, freeze a candidate configuration, then evaluate held-out tasks with explicit budget authorization. Expand autonomy only for the evidenced task class.

## 5. Build order for the first backlog

These are proposed implementation slices, not tasks submitted to the manager:

| Order | Slice | Dependency | Original enhancement mapping |
|---|---|---|---|
| 1 | Azure-to-local-delivery live pilot; record the first failed boundary or full success. | Existing integration and a target repository. | Existing features + E01 + minimal E03. |
| 2 | Ready-for-tonight report and reusable project journey, including actual tool/handoff rehearsal. | Slice 1's environment facts. | E01; targeted portions of E11. |
| 3 | Pinned morning delivery receipt and available behavioral artifacts using current Review changes. | A final verified source identity. | Minimal E02/E03/E12; existing visual review. |
| 4 | Durable scheduled-start/dispatch/resume and host-health contract. | Readiness, receipts and a bounded authorized run. | E09/E11; reuse current recovery, locks and leases. |
| 5 | Supported blocker recovery catalog and interruption/fault trials. | Slice 4 and explicit postconditions. | E04/E05/E11. |
| 6 | Full finding lifecycle, targeted invalidation, final integrated proof, and actionable digest. | Real pilot failures and output-review feedback. | E02/E03/E04/E12. |
| 7 | Ranked operational memory, temporal validity, scoped preventers and measured token reduction. | Repeated real observations; minimal memory begins in slice 1. | E05/E06/E07; E08 before concurrent knowledge writers. |
| 8 | Held-out live quality evaluation and reliability expansion. | Stable measured slices; cheap regression fixtures begin immediately. | E13; E10 before concurrent quota-bound API work. |

Defer E14 routine extraction, E15 UHP integration, E16 broad exports, another graph engine, and mandatory extra agent teams. None is necessary to establish the first Azure developer workflow. Review admission control becomes more important as throughput grows; do not use concurrency as a substitute for completion quality.

## 6. Fresh verification performed for this roadmap

All seven commands below passed on 2026-11-04 in the current source checkout:

| Command | What it directly supports | What it does not establish |
|---|---|---|
| node verification/azure_issue_journey_test.mjs | Synthetic Azure auth/WIQL/revision/TLS/encoding boundaries, preview/import, duplicate rejection, and stale-source handling. | Authenticated access to the user's Azure project. |
| node verification/supervisor_runner_test.mjs | Bounded injected dispatch, independent continuation, and no repeated unchanged launch in the invocation. | Continuous hosted execution or actual provider judgment. |
| node verification/overnight_recovery_test.mjs | Persisted interruption detection, safe remaining-task boundary, and required fresh confirmation. | Automatic unknown-effect recovery or host reboot survival. |
| node verification/overnight_host_test.mjs | Inspectable Windows scheduler command construction. | Scheduler installation, host wake-up, or scheduled execution. |
| node verification/task_changes_test.mjs | Diff attribution, revision freshness, corruption handling, bounds and redaction behavior. | Rendered UI, responsive layout, accessibility or visual correctness. |
| node verification/queue_recovery_delivery_test.mjs | Isolated fixture workers, supported repairs, preserved predecessor behavior, integration, delivery branch, replay and repair exhaustion. | Live-model correctness, every blocker class or actual host restart. |
| node verification/overnight_issue_e2e_test.mjs | Synthetic Jira/GitHub/Azure intake, reviewed two-task plans, three queues, six completed fixture tasks, local delivery branches, and stale-source rejection. | Real model planning/review quality, overnight soak, remote publication, or 99% completion. |

The end-to-end suite retains a synthetic run record under .atl-evidence/issue-overnight/. These are test artifacts; live task state, credentials and remote boards were not altered.

The earlier evaluation pilot explicitly found no observed ATL advantage on its small sample, with unknown comparable model cost. It cannot establish this roadmap's target. See evaluations/atl/SUMMARY.fa.md.

## 7. Source reconciliation and inspection points

The two reports were re-read. The twelve supplied X links were revisited through the browser, using the retained pages where available. Decision-relevant sections were rechecked, including loop stopping/review cost, common verification revision, repair scope, operational harnesses, memory validity, and reviewer evaluation. This was not a new full audit of 63 commercial reviewers, all seven memory repositories, a paid course, or the untranscribed video. The original source register remains in the consolidated review.

Primary material rechecked for this decision:

- [S01: Pstack reusable project verification](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/create-verification-skill/SKILL.md) — run, doctor, drive, observe, retain evidence, clean owned resources, and prove the procedure.
- [S02: Pstack correction workflow](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/correct/SKILL.md) — turn recurring failure classes into stronger controls and prove the past failure is caught.
- [S03: Anthropic long-running harness design](https://www.anthropic.com/research/harness-design-long-running-apps) — behavioral evaluation and component-by-component simplification, not a universal improvement percentage.
- [S04: Claude goal evaluation](https://code.claude.com/docs/en/goal) — the completion evaluator judges surfaced conversation evidence and does not execute missing checks independently.
- [S05: Azure service-hook webhooks](https://learn.microsoft.com/en-us/azure/devops/service-hooks/services/webhooks?view=azure-devops) — public HTTPS endpoint requirements and localhost restrictions.
- [S06: Azure service-hook failure handling](https://learn.microsoft.com/en-us/azure/devops/service-hooks/troubleshoot?view=azure-devops) — finite retries and restricted/disabled subscriptions.
- [S07: Azure WIQL API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql?view=azure-devops-rest-7.1) — query-backed intake as a practical local starting point.
- [S08: NIST exact binomial confidence limits](https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm) — statistical framing for a bounded reliability claim.

Local decision-changing evidence:

- runtime/lib/intake.mjs and verification/azure_issue_journey_test.mjs: existing Azure integration and tested boundaries.
- runtime/lib/supervisor-runner.mjs: settled-task exclusion, remaining time propagation, idle exit, and interrupted-provider containment.
- runtime/lib/routines.mjs: persisted queued routine records, event fingerprint fallback, and disabled external delivery.
- runtime/lib/overnight-hosts/windows-task-scheduler.mjs: command-plan construction without installing a host task.
- runtime/lib/launch.mjs and docs/queue-recovery.md: bounded lifecycle, persistent accounting, supported repair, delivery and recovery boundaries.
- runtime/lib/brain.mjs: exact current retrieval and claim-conflict behavior.
- runtime/lib/execution-report.mjs: usage coverage and unknown values rather than invented billing.
- docs/task-change-review.md and runtime/lib/task-changes.mjs: the existing inspection surface and its limits.
- problems/enhancements/overnight-reliability-evidence.md: prior local improvements and explicitly open overnight acceptance.

## 8. Decisions and next boundary

Decided by the user: Azure Boards first; prioritize overnight developer delivery, fewer avoidable blockers, inspectable evidence, useful memory, and efficient execution.

Recommended initial defaults: one repository, one iteration/query, contained observable tasks, read-only Azure intake, isolated local output, explicit run allowances, and no new remote publication authority. These remain proposed defaults, not newly enabled settings.

Still needed for implementation: target repository/project selection, actual supported commands and baseline, allowed provider/authentication route, persistent host choice, and the bounded execution budget/action envelope. Inspect existing configuration before asking the user to repeat anything already available. These details do not block the product sequencing in this document.

The immediate next engineering artifact is an observable specification for P0 plus the P1 readiness/host boundary, grounded in the selected project. The next evidence milestone is one real Azure task delivered with reproducible proof. Current verdict: the roadmap is evidence-backed; the complete overnight product and the 99% claim remain unverified.
