# ATL First Developer Delivery: Implementation Plan

Date: 2026-11-04

Status: User-authorized planning and GitHub issue publication. Implementation is pending. All new issues and this plan are English; the conversation summary is Persian.

This plan supersedes the execution order in [the enhancement review](2026-11-04-atl-enhancement-review.md), [the second batch](2026-11-04-atl-enhancement-review-batch-2.md) and [the overnight roadmap](2026-11-04-atl-developer-overnight-roadmap.md). Their source limitations and baseline qualifications still apply. No new provider benchmark or live overnight run was performed for this planning publication.

Tracking issue: [#14](https://github.com/depie99/Agent-Trust-Ladder/issues/14). Individual implementation bodies are preserved in [the issue draft/publication directory](2026-11-04-atl-first-delivery-issues/).

## First product outcome

Select a few real Azure Boards tasks from one project/repository, confirm they are ready, start one finite evening run, and return to inspectable local changes with current acceptance evidence, review results and the smallest remaining decisions. Deliver this through both ATL UI Control Plane and an installation of ATL skills alone.

This is the user-authorized planning scope dated 2026-11-04. It translates the two enhancement reviews into an executable sequence. It does not claim the runtime changes below have already shipped.

## Phase E0: preserve and finish the existing work

The baseline has 9 open issues and 1 completed issue; do not recreate them.

| Existing issue | Place in the execution order |
| --- | --- |
| #12 - CI for Plan/EGM suites | Completed; keep the closure and historical evidence. New changes still need current CI. |
| #4 - cross-process review/cost gate | Finish/verify the in-flight implementation first when using deep review. At planning time the issue remains open despite recent code commits. |
| #6 - parser/regression bank | Next deep-review correctness task; required before trusting that optional path. |
| #8 - staged progress/cancellation | Follow the correctness work. |
| #9 - browser deep-review journey | Exercise the completed UX and failure states. |
| #11 - plan finding disposition | Continue the existing policy phase; new code-task receipts reuse semantics without duplicating this work. |
| #10 - risk-based review depth | Add only after correctness and disposition are usable; keep optional policy scoped. |
| #5 - isolation probes | Explicit opt-in integration assurance; no automatic live calls. |
| #7 - backend benchmark | Bounded opt-in measurement after parser correctness; reuse results in P3. |
| #13 - working-tree ownership/commit waves | Coordinate scope throughout and before release; never sweep unrelated live manager state into commits. |

Suggested existing-work order: #4 -> #6 -> #8 -> #9 -> #11 -> #10 -> #5 -> #7; #13 ownership work runs alongside. This is a recommended queue, not a claim that every edge is a technical dependency. Optional deep-review improvements do not all block the Azure-first release. Keep deep review disabled/unclaimed until its applicable gates pass.

Baseline note: at commit 2468321316eaa83947556d3638170550b58c0314, runtime verification and docs deployment are green, but documentation verification failed (run 41793162185). Resolve the current failure in its owning work before the new release; do not reopen #12 merely to erase historical completion. The checkout contains unrelated local changes, so HEAD alone does not reproduce it.

## Phase P1: six small ordered delivery slices

- [ ] [#15](https://github.com/depie99/Agent-Trust-Ladder/issues/15) - common executable delivery contract and packaged portable helper.
- [ ] [#16](https://github.com/depie99/Agent-Trust-Ladder/issues/16) - readiness plus one reusable broken/fixed project verifier.
- [ ] [#17](https://github.com/depie99/Agent-Trust-Ladder/issues/17) - real Azure intake and a single-task local path in both surfaces.
- [ ] [#18](https://github.com/depie99/Agent-Trust-Ladder/issues/18) - actual file/behavior evidence and a current revision-bound delivery receipt.
- [ ] [#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19) - finite unattended sequential batch, persisted limits and safe resume.
- [ ] [#20](https://github.com/depie99/Agent-Trust-Ladder/issues/20) - paired real pilot, install/quickstarts, current CI and release evidence.

Execute in that order. A single task becomes useful at [#17](https://github.com/depie99/Agent-Trust-Ladder/issues/17)/[#18](https://github.com/depie99/Agent-Trust-Ladder/issues/18); unattended batch release is complete at [#20](https://github.com/depie99/Agent-Trust-Ladder/issues/20). Start with concurrency 1 and two or three contained tasks. Reuse existing intake, workspaces, preflight, supervisor, recovery, diff and delivery gates. No new database, graph engine or always-on scheduling platform.

Each issue has separate Control Plane and skills-only scope, observable acceptance, impact paths, existing verification commands, explicitly proposed new tests and rollback. Do not close a dual-surface issue after implementing only the UI or only prose in a skill.

## Release acceptance

- [ ] One Azure project/repository/stack is declared; real source IDs/revisions trace through the receipts.
- [ ] A comparable small batch runs in isolated workspaces through both surfaces, with actual changed files, verifier/review evidence and explicit blockers.
- [ ] A controlled interruption and known repair are exercised; unresolved effects are reconciled instead of blindly replayed.
- [ ] Runtime and skills-only fixtures agree on completion/staleness/stop outcomes; the skills installation works without the manager service.
- [ ] Current acceptance evidence identifies final content including relevant dirty/untracked files; remaining blocking findings cannot be hidden by a successful worker exit.
- [ ] Usage coverage, failed attempts, manual interventions and review effort are reported honestly. Unknown usage is not zero.
- [ ] Relevant CI at the release revision passes, and each surface has a usable English quickstart.

Local delivery is distinct from a published PR, merge, deployment or Azure state update. Host availability, credentials, tool access and enforceable budget capabilities are explicit prerequisites. A skill cannot supply a scheduler or guarantee token enforcement by prompting alone. A tiny pilot cannot substantiate 99% reliability; first establish observable completion and bounded failure behavior.

## Follow-up phases, after the first release

- [ ] [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21) - operational memory, temporal provenance, recoverable writes and one tested preventer for a repeated failure.
- [ ] [#22](https://github.com/depie99/Agent-Trust-Ladder/issues/22) - accepted-outcome quality/cost, enforceable admission where possible, review capacity and held-out evaluation.
- [ ] [#23](https://github.com/depie99/Agent-Trust-Ladder/issues/23) - durable event bridge and optional routine/harness/knowledge adapters only where measured need exists.

These are future execution tracks, not hidden P1 requirements. Basic context selection, attempt capture and usage recording start in P1.

## Research-to-work coverage

| Enhancement | First delivery / follow-up |
| --- | --- |
| E01 reusable verifier | [#16](https://github.com/depie99/Agent-Trust-Ladder/issues/16), real integration [#17](https://github.com/depie99/Agent-Trust-Ladder/issues/17)/[#20](https://github.com/depie99/Agent-Trust-Ladder/issues/20) |
| E02 structured task findings | Minimal [#18](https://github.com/depie99/Agent-Trust-Ladder/issues/18), fuller history [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21); existing #11 remains plan-specific |
| E03 provenance/receipt | [#15](https://github.com/depie99/Agent-Trust-Ladder/issues/15)/[#18](https://github.com/depie99/Agent-Trust-Ladder/issues/18) |
| E04 affected repair/invalidation | Basic [#18](https://github.com/depie99/Agent-Trust-Ladder/issues/18)/[#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19), richer closure [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21) |
| E05 correction to prevention | Capture [#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19), prove one preventer [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21) |
| E06 bounded bilingual retrieval | [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21) |
| E07 temporal knowledge/source independence | [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21) |
| E08 recoverable knowledge writes | [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21), before concurrent knowledge writers |
| E09 event/executor | Finite Azure batch [#17](https://github.com/depie99/Agent-Trust-Ladder/issues/17)/[#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19), durable continuous bridge [#23](https://github.com/depie99/Agent-Trust-Ladder/issues/23) |
| E10 atomic tool budgets | Existing enforceable limits + coverage [#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19); stronger wrappers [#22](https://github.com/depie99/Agent-Trust-Ladder/issues/22) before wider concurrent paid dispatch |
| E11 progress/routine health | [#16](https://github.com/depie99/Agent-Trust-Ladder/issues/16)/[#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19), continuous routine health [#23](https://github.com/depie99/Agent-Trust-Ladder/issues/23) |
| E12 review capacity/outcome economics | Basic receipt/decision summary [#18](https://github.com/depie99/Agent-Trust-Ladder/issues/18)/[#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19), capacity/economics [#22](https://github.com/depie99/Agent-Trust-Ladder/issues/22) |
| E13 evaluation/ablation/routing | Cheap paired fixtures and real pilot [#20](https://github.com/depie99/Agent-Trust-Ladder/issues/20), held-out comparisons [#22](https://github.com/depie99/Agent-Trust-Ladder/issues/22); reuse #7 |
| E14 demonstrated routine promotion | Conditional [#23](https://github.com/depie99/Agent-Trust-Ladder/issues/23) |
| E15 harness adapter | Conditional [#23](https://github.com/depie99/Agent-Trust-Ladder/issues/23) |
| E16 readable projections/imports | Portable sourced knowledge [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21), optional external projection [#23](https://github.com/depie99/Agent-Trust-Ladder/issues/23) |

The local source catalog is research/briefs/2026-11-04-atl-enhancement-review.md (all twelve supplied X links and primary-source qualifications). The second batch and developer overnight roadmap remain background. The new first-delivery plan supersedes their ordering. Useful principles are carried into both surfaces; unverified marketing claims, inaccessible paid material and redundant frameworks are not product requirements.

## Next action

Start [#15](https://github.com/depie99/Agent-Trust-Ladder/issues/15) after checking the current issue/checkout ownership and the existing #4/#6 deep-review work. Do not begin by building advanced memory, purchasing a reviewer, running a large provider benchmark or adding another harness. Issue creation authorizes planning/publication only; each live run and remote side effect still needs the appropriate concrete authority.

## Implementation decisions

### One contract and two real entry points

Decision: keep the existing manager lifecycle authoritative for Control Plane. Share a small versioned delivery/receipt contract and portable helper under the packaged skills tree. Skills-only users keep their local evidence and checkpoints without a manager service.

Rationale: the checkout already contains most orchestration foundations. Parity needs common observable completion rules, not two independently maintained definitions of done. A receipt validates recorded evidence and freshness; it cannot confer the authority to approve, merge or ship.

Alternative considered: a separate skills orchestrator with its own database and state machine. Rejected for the first release because it duplicates authority and creates migration/maintenance work before a developer gets value.

Implementation boundary: inspect existing pure revision and verification utilities first. Extract only where needed, preserve existing content-identity semantics, and keep the portable helper independent of runtime manager files. Portable mode coordinates only its own batch; do not claim global cross-host locking.

### One verifier and one stack before broad automation

Decision: choose one pilot repository/stack with its actual readiness requirements and one reusable verifier. Include one deliberately broken/fixed fixture and an appropriate observed readback.

Rationale: deterministic preparation and verification remove more recurring supervision than a large collection of agent prompts. Fixing the verifier to suppress a defect would invalidate this value.

Alternative considered: promise arbitrary backlog/stack support immediately. Defer it until the first declared environment works through both entry points. The actual target repo/stack and Azure credentials are OPEN pilot inputs, not prerequisites to publishing this plan.

### Finite sequential evening batch before continuous ingestion

Decision: explicitly select the items and limits, start the existing supervisor or a portable sequential runner before leaving, and persist scope, attempts and checkpoints. Start with concurrency 1.

Rationale: this delivers unattended work while keeping dependencies, recovery and spending controllable. Current supervisor idle exit is compatible with a finite batch. Persistent compute and scheduling are host capabilities and must be declared honestly.

Alternative considered: an always-on daemon, generic event bus and automatic new-work discovery in P1. Defer them to the measured-need gate in [#23](https://github.com/depie99/Agent-Trust-Ladder/issues/23). Existing routine preview/queue records do not demonstrate durable execution.

### Reuse review work without making every task expensive

Decision: keep existing EGM issues as their own phase and keep optional deep review gated. A bounded low-risk task can use the standard route while that work finishes. Never replace independent evidence with multiple role names in one conversation.

Rationale: #4/#6 address correctness of a specific review path; #7 is a benchmark rather than an overnight prerequisite. Requiring the entire optional reviewer backlog first delays the first user benefit and can increase total tokens.

Alternative considered: force every Azure task through all review depths. Rejected absent task risk and outcome evidence. Existing #10 owns configurable risk-based depth.

## Concrete work packages and impact

| Package | Primary outcome | Main existing impact boundary | Portable/canonical impact | Size/risk judgment |
| --- | --- | --- | --- | --- |
| [#15](https://github.com/depie99/Agent-Trust-Ladder/issues/15) | Common executable completion/receipt contract | runtime/lib/delivery.mjs; runtime/lib/handoffs.mjs; existing revision/role consumers | skills/atl/references and scripts; canonical modes; installer | Small foundation; compatibility-sensitive |
| [#16](https://github.com/depie99/Agent-Trust-Ladder/issues/16) | Readiness and reusable real verifier | runtime/lib/dispatch-preflight.mjs; preparation/dispatch callers | shared verifier manifest/helper; bootstrap/plan/implement/verify | Medium; cleanup/tool readiness |
| [#17](https://github.com/depie99/Agent-Trust-Ladder/issues/17) | Azure item to one verified local task | runtime/lib/intake.mjs; existing source/Plan Studio/queue journey | portable read-only intake; frame/plan/implement | Medium; auth/freshness/reconciliation |
| [#18](https://github.com/depie99/Agent-Trust-Ladder/issues/18) | Inspectable current changes and evidence | delivery; change-review store/API; runtime/control-plane-changes.js | Markdown/JSON receipt; implement/verify/audit | Medium; false completion/stale artifacts |
| [#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19) | Bounded finite unattended execution/resume | supervisor-runner; leases/recovery/dispatch; execution reports | local portable runner/checkpoint; implement/verify | Medium to large; interruption/side effects |
| [#20](https://github.com/depie99/Agent-Trust-Ladder/issues/20) | Evidence-backed first release in both surfaces | paired journey fixtures; CI; canonical docs | fresh install; English quickstarts; comparable live pilot | Medium plus access-dependent live gate |

These are relative complexity judgments, not person-day or calendar commitments. Reassess after each runnable slice. [#15](https://github.com/depie99/Agent-Trust-Ladder/issues/15) should remain executable glue; if it becomes an architecture rewrite, reduce it before proceeding.

Generated mode skills must be changed at skills/agent-trust-ladder/modes/*.md and regenerated with python scripts/build_mode_skills.py. A direct patch to generated skills alone is not completion. Package references/scripts with the actual skills installer; test a fresh no-manager installation. Existing unrelated changes are not part of this work.

Use additive optional fields and explicit versions. Legacy records remain readable but do not acquire new verification guarantees. Any extraction of identity or gate logic must keep current consumers compatible. Freshness includes relevant admitted dirty/untracked source, verifier and policy identity; do not confuse content digests with Git SHAs.

## Top three pre-mortem failures

| Failure | Early detection | Containment and rollback |
| --- | --- | --- |
| UI says verified while skills-only lacks evidence or uses a different freshness rule | Run the same passing, missing, stale and forged fixtures through both entry points; require normalized verdict parity and a fresh installer test | Keep one portable contract/helper; reject unsupported versions; revert the projection/adapter while retaining existing lifecycle gates and evidence |
| Restart repeats completed work, resets attempts or replays an uncertain effect | Inject interruption at checkpoint/lease boundaries, repeated no-progress and concurrent duplicate batch start; compare identities and attempt accounting after resume | Stop new admission; preserve checkpoints and receipts; reconcile unknown effects before retry; disable unattended entry without deleting work |
| Overnight execution spends context or retries but cannot verify the result | Fail readiness for missing capabilities; broken/fixed verifier fixture; record all attempts/usage coverage and actual reviewer burden | Stop at bounded time/attempt limits, emit explicit blocker and smallest decision; retain single-task/manual delivery where verified; do not claim an enforceable provider cap without a supported wrapper |

## Verification strategy and completion evidence

Each implementation issue names real existing regression commands and separately labels proposed new suites. During planning, the named existing verification files were checked for existence; the implementation test suites were not rerun. The seven focused suites recorded in the earlier roadmap remain historical fixture evidence, not proof of the future behavior in these issues.

Verification order is deliberately small: reproduce the relevant failing behavior; implement one slice; run its focused suites; check the paired portable verdict; run applicable integration/browser checks; then use a small opt-in real pilot at [#20](https://github.com/depie99/Agent-Trust-Ladder/issues/20). Expand testing when a changed boundary or a failure justifies it. Default CI uses no paid providers.

The new suites proposed across P1 are developer_delivery_contract_test.mjs, project_readiness_verifier_test.mjs, azure_skills_delivery_test.mjs, developer_delivery_receipt_test.mjs, portable_overnight_batch_test.mjs and azure_delivery_pilot_test.mjs under verification/. They are not present or passing merely because this plan names them. New test behavior must exercise negative cases rather than mirror implementation internals.

The release record must include final content identity, source revisions, actual commands/results, review capability and disposition, artifacts available for inspection, all attempted outcomes, interruptions/manual interventions, wall time and observed usage coverage. Where comparison is made, use the same baseline content and a comparable task cohort. A few clean tasks can establish a useful operational milestone; they cannot substantiate a population-level 99% completion/error rate.

## Execution handoff and open inputs

1. Refresh #4 and #13 ownership and current CI, because parallel repository work is active. Preserve issue state and unrelated working-tree changes.
2. Implement [#15](https://github.com/depie99/Agent-Trust-Ladder/issues/15) with one tiny executable fixture and a packaged helper, then [#16](https://github.com/depie99/Agent-Trust-Ladder/issues/16). Avoid growing the first slice into a platform project.
3. Select the pilot Azure query/items, target repository/stack, supported host and actual verifier while doing [#16](https://github.com/depie99/Agent-Trust-Ladder/issues/16)/[#17](https://github.com/depie99/Agent-Trust-Ladder/issues/17). Credential values remain outside issue bodies and logs.
4. Demonstrate one real local task and inspect its receipt at [#17](https://github.com/depie99/Agent-Trust-Ladder/issues/17)/[#18](https://github.com/depie99/Agent-Trust-Ladder/issues/18) before adding unattended batch behavior.
5. At [#19](https://github.com/depie99/Agent-Trust-Ladder/issues/19), select explicit scope and bounded run limits. Use only authorized safe repairs and supported host capabilities.
6. Close [#20](https://github.com/depie99/Agent-Trust-Ladder/issues/20) only with both real surface records and current relevant CI. Keep live access/provider budget OPEN when unavailable; do not replace it with a mock success.
7. Use the observed blockers/cost/review burden to choose [#21](https://github.com/depie99/Agent-Trust-Ladder/issues/21), then [#22](https://github.com/depie99/Agent-Trust-Ladder/issues/22). Select [#23](https://github.com/depie99/Agent-Trust-Ladder/issues/23) extensions only after its need gate.

Publishing these issues does not authorize implementation commits, remote branches/PRs, Azure mutation, installation of schedulers, provider spending or deployments. Those actions retain their ordinary scope/authority requirements when the relevant issue is executed. This plan creates no scheduled task.

## Publication verification

Published on 2026-11-04 to depie99/Agent-Trust-Ladder: one tracking issue (#14), six first-release issues (#15-#20) and three follow-up phase issues (#21-#23). All ten remote titles, bodies, labels and eight native blocked-by relationships were read back and matched against the local drafts. Existing issues #4-#13 were not edited or closed by this publication. The final readback still shows nine of those issues open and #12 closed.

The machine-readable publication record and remote body snapshots are in [the publication directory](2026-11-04-atl-first-delivery-issues/publication.json). This validation checks the planning/publication artifacts; it does not constitute runtime implementation or execution evidence.

## Source register and interpretation

- [X01: Chase, verification workflow](https://x.com/0xChaseTM/status/2117754335228551488)
- [X02: Gipp, event-driven workflow](https://x.com/gippp69/status/2115018135396905000)
- [X03: Bober, memory organization](https://x.com/Bober_smart/status/2078784709253841039)
- [X04: Plusxbt, repository collection](https://x.com/plusxbt/status/2117229536475496695)
- [X05: Shoopy, agent graphs and engineering](https://x.com/0xShoopy/status/2085383231554171098)
- [X06: Mr. Buzzoni, loop engineering](https://x.com/Mr_Buzzoni/status/2083061585858158636)
- [X07: Chase, development course](https://x.com/0xChaseTM/status/2109980695787454803)
- [X08: 0xwhrrari, harness engineering](https://x.com/0xwhrrari/status/2093685107534000560)
- [X09: 0xwhrrari, Grok Bot](https://x.com/0xwhrrari/status/2095497109524934750)
- [X10: Hanako, loops and graphs](https://x.com/hanakoxbt/status/2091515787366306154)
- [X11: Sergii, AI code reviewer survey](https://x.com/sermakarevich/status/2117599472188350701)
- [X12: Plusxbt, sourced and dated knowledge](https://x.com/plusxbt/status/2117565904951148756)

The consolidated review preserves the primary documentation/research, seven repository patterns, attachment hypotheses and access limitations for these sources. This plan reuses that completed research; it does not claim to have watched the untranscribed video, accessed paid lessons, audited every linked product, or established vendor performance. Each E01-E16 pattern has an explicit owner above; conditional extensions are intentionally deferred rather than silently dropped or made P1 prerequisites.

GitHub issue dependencies use the official issue-dependencies REST API. The published issue bodies also retain the order so execution remains understandable without a project board.
