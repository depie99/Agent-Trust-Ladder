# ATL Enhancement Review

Date: 2026-11-04

Follow-up: the [Azure-first developer overnight roadmap](2026-11-04-atl-developer-overnight-roadmap.md) supersedes this document's implementation order and records fresh local checks. It also corrects the earlier no-progress gap: bounded settled-task exclusion already exists; continuous hosting and richer recovery remain separate work.

Status: Consolidated research and engineering recommendations. This document combines both research batches and the supplied attachment material. It does not authorize implementation, provider spending, installation, scheduled execution, or a change in agent autonomy.

## Executive recommendation

ATL should first complete the loop from an observable defect to a verified repair: **reusable project verifier -> structured finding -> bounded repair -> independent verification of the final revision -> traceable receipt -> preventive control when justified**.

The reviewed sources do not justify replacing ATL's architecture, adding another graph engine, creating a parallel memory system, or copying a fixed team of agents. The inspected checkout already contains state transitions, role contracts, revision-bound handoffs, review gates, knowledge sources and claims, navigation, scheduling, skill governance, recovery limits, and execution telemetry. Most opportunities concern the reliability of the connections between these components.

The next priorities are better knowledge retrieval and temporal provenance, recoverable knowledge writes, a reliable event-to-executor bridge, atomic tool budgets, stopping when attempts make no progress, and evaluation based on accepted outcomes. Harness adapters and Markdown exports are conditional extensions after a concrete need is demonstrated.

No percentage improvement, financial saving, or superiority over another workflow has been established for ATL by this research.

## Scope and evidence boundaries

The research covered twelve supplied X links across two batches, plus the attachment material about HarnessRouter/UHP, model routing, and overnight evaluation. Chase's second link points to a course already reached through the first batch; those links are not independent corroboration.

During the underlying research:

- Accessible article text and displayed examples were read in Chrome. The long reviewer-market survey, including its catalog and references, was read; its 63 products, prices, and vendor claims were not independently audited.
- All seven repositories in the first Plusxbt collection were read at README level. Selected provenance, transaction, and skill contracts were examined more deeply. This was not a complete code audit of those repositories.
- Decision-relevant claims were compared with official documentation and original research listed below.
- The public Hanako course sales page was opened. The paid lessons were inaccessible and were not reviewed. The article's claim of twenty lessons was not independently confirmed.
- Chase's 38-minute video was not watched or transcribed. Some Bober images were not independently examined. Conclusions rely on the text and primary material actually read.
- ATL code and documentation were inspected statically. No new product tests, live-provider benchmarks, paid calls, installations, or automations were executed for these reviews.

The ATL baseline describes the files observed on 2026-11-04. The recorded HEAD was **6b1d6968533b8ce60c2cdb2b4ebe11b67f52fd1b**, with multiple local modifications. A commit identifier alone therefore does not reproduce the complete inspected checkout. These observations are not guarantees about a remote branch, released version, or every deployment.

This consolidation reorganizes the completed research; it does not claim a new round of external verification.

## What each source contributes

| Source | Useful contribution | ATL implication and qualification |
|---|---|---|
| X01: Chase, verification workflow | Treat verification as a maintained project capability; convert recurring mistakes into stronger controls. | Build on existing verification skills. A repeatable verifier must exercise real behavior and preserve evidence, rather than merely instructing an agent to test. |
| X02: Gipp, event-driven workers | Wake workers on meaningful changes; connect scouting, decisions, execution, and reporting. | Complete event delivery and execution semantics. The article's CSV counter and printed STOP message are not an atomic budget controller. |
| X03: Bober, compact memory | Small topical files, meaningful names, an entry map, and reading on demand. | Improve retrieval in the existing brain. A memory layout cannot guarantee the elimination of hallucinations. |
| X04: Plusxbt, seven repositories | Provenance, curated learning, transactional writes, indexing, and readable knowledge projections. | Extract individual patterns. Installing all seven frameworks would add overlapping authority and maintenance. |
| X05: Shoopy, graphs and constraints | Explicit state, bounded handoffs, deterministic checks, routing, and attention to comprehension debt. | Derive diagrams and change explanations from existing contracts. Self-reported confidence and multiple roles in one conversation are not independent verification. |
| X06: Mr. Buzzoni, loop engineering | Separate trigger, work, gate, persistent state, stop conditions, and outcome economics. | Add no-progress detection and review-capacity feedback. Claude's goal evaluator reads the transcript; it does not independently run the missing tests [P07]. |
| X07: Chase, development course | Shared baseline, dependency ordering, separate workspaces, common review revision, and recoverable checkpoints. | Extend existing handoff and recovery contracts. Worktrees are not account, network, or operating-system security boundaries. A prompt requesting remote recovery does not implement durable storage. |
| X08: 0xwhrrari, harness engineering | Selective context, explicit tool errors, external authorization, sensors, traces, and change receipts. | Compose a receipt from existing evidence. Evaluate optional scaffolding by removing as well as adding it; the cited Anthropic work discusses simplification as models improve [P10]. |
| X09: 0xwhrrari, Grok Bot | Prepare authorized work up to the action boundary; turn demonstrated work into a maintained routine. | Extract reviewable routine candidates and monitor health. Separate bot names do not isolate shared credentials. Five clean runs are an example threshold, not statistical proof [P04, P05]. |
| X10: Hanako, loops and graphs | Parallelize independent work, use code for exact transformations, and return failures to the responsible unit. | Repair the affected dependency closure. Data flow is only one dependency: authority, shared resources, rate limits, and side-effect ordering also matter. Three failed retries do not prove that the plan is the root cause. |
| X11: Sergii, reviewer-market survey | Evaluate what a reviewer reads, how it validates findings, what it can do, how it learns, and how it is billed. | Build a local review dataset before choosing a vendor. Same-vendor status is a weak proxy for correlated errors; an accepted finding is not automatically a real bug or a prevented incident. |
| X12: Plusxbt, evidence and dated decisions | Trace sources, retain decision history, distinguish active knowledge, and admit missing evidence. | Add temporal relations and improve retrieval. A checked-at timestamp is not proof of continuing validity; a manually invoked skill is not a scheduler [P09]. |

The attachment adds three hypotheses rather than demonstrated ATL benefits:

1. **HarnessRouter/UHP:** normalize integration with different harnesses. Protocol compatibility and model selection are different concerns; reported savings require a local comparison.
2. **Model routing:** use cheaper models for bounded tasks and an advisor for harder decisions. ATL already has resource-policy and model-tier concepts; additional routing should be justified by repair reduction and total outcome cost.
3. **Overnight evaluation:** use unattended regression work within an explicitly authorized budget. The supplied personal or sponsored evaluation story is inspiration, not reproducible evidence of ATL improvement.

Several generalizations should remain outside policy. One successful retry does not prove flakiness. A numerical confidence estimate is not calibrated evidence. A reviewer without execution access cannot claim reproduction. Every deterministic graph node does not require an agent. The Anthropic multi-agent research result cited in the sources concerns its particular research evaluation and model combination, with substantially higher token use; it is not an ATL coding benchmark [P11].

## Existing ATL foundations and the remaining gaps

| Area | Observed foundation | Remaining opportunity |
|---|---|---|
| Verification | atl-verify, verification maintenance, a manager-lifecycle verifier, and a feature/module/test map in the guides. | A repeatable project-specific journey from clean state, with readiness checks, appropriate readback, isolated data, owned-process cleanup, and durable evidence. |
| Task review | Role-constrained evidence with result, detail, revision, command, artifact, and coverage fields. Plan Studio already has structured plan findings. | A finding lifecycle for code tasks, with independent status and repair history. Existing plan findings should not be mistaken for this complete task-review capability. |
| Handoffs and approval | Source snapshots include dirty and untracked content, revision identities, input revisions, immutable artifacts, scoped paths, and integration gates. Plan review uses evidence fingerprints. | More complete instruction and verifier provenance, and explicit semantic reasons for invalidating downstream checks. A revision may be a content digest rather than a Git SHA. |
| Brain | Archived raw sources, digests, source revisions, and VERIFIED/PARTIAL/UNKNOWN/CONFLICTED/SUPERSEDED claim states. | buildContextPack matches the complete query as a substring and takes the first bounded results. Full task titles and objectives can miss relevant claims. Explicit predicate and supersession relations are also needed. |
| Navigation and learning | Navigation has ranking and an estimated token budget. Learning has bounded lesson storage and English/Persian token overlap. | Brain retrieval should gain its own measured ranking and coverage. Navigation tokenization is predominantly ASCII; do not describe all ATL retrieval as equally bilingual or equally limited. |
| Governance | Stale-claim scans, skill promotion checks, approved skill versions, initially disabled routines, and bounded retries. | Verification dates do not encode claim-specific validity. A retrospective draft is not an installed preventive control. |
| Routines | Time/event triggers, deduplication, and bounded retries. | The inspected path creates preview/queued records with external delivery disabled. No consumer completing the queue-to-task-executor path was observed in the searched code. This is a bounded static observation, not proof about every deployment. |
| Event identity | Fingerprinting exists. | Without a stable caller-supplied identity, the default fingerprint can vary by minute, allowing a redelivery in a later minute to appear new. |
| Dispatch and recovery | Bounded concurrency, project fairness, dependency checks, session/time limits, settled-task exclusion within a supervisor invocation, remaining-time propagation, and containment after interruption. | Review-specific admission control and richer failure-signature-based re-entry remain extensions. The supervisor currently exits when idle. Unknown side effects must remain unresolved until reconciled. |
| Resource policy | Model tiers, owner pools, relative cost ordering, and provider failover. | Relative model cost is not a currency-denominated bill or an atomic tool/API quota. |
| Reporting | Session-ledger deduplication, coverage, unknown-usage handling, and conservative calibration from comparable verified work. | A joined outcome receipt, human-review delay, and complete cost per accepted outcome. Missing usage must remain unknown. |
| Change review and notifications | Revision-aware evidence views and notification deduplication. | An actionable decision inbox and digest should extend these stores. Existing previews and artifact references are not runtime proof or authorization. |
| Evaluation | Replay structures, an independent grader, mutations, and a small pilot. | Fresh review-specific and live-provider evaluation. The current pilot explicitly reports no observed ATL advantage; it is not evidence of equivalence or a production A/B result. |

The existing worker context includes role contracts, previous review text, resources, neighboring tasks, and knowledge evidence. Scope-aware manager IPC is useful, but it is not an operating-system sandbox. Context selection should be refined by role rather than duplicating the same broad bundle for every worker.

## Consolidated enhancement catalog

Priority labels express sequencing, not measured return on investment. Each item is a proposal; existing authorization and governance continue to apply.

### E01. Reusable project-verifier lifecycle

**Priority: first.** Extend bootstrap and planning to detect whether a usable project verifier exists and define one when necessary. Register the feature, behavior contract, prerequisites, command, observation surface, expected evidence, cleanup, and maintenance owner. Add a doctor/readiness step, isolated test data, and a path through the real user journey.

Verification should read results from the relevant surface: persisted data needs independent readback; a UI journey needs its final state, not just an opening screenshot. Maintenance should follow behavior and route changes. Updating a verifier and changing a product to satisfy it are different review decisions.

**Acceptance:** the journey runs from a clean state; a deliberately broken version fails; the fixed version passes; evidence survives cleanup; cleanup does not terminate a user's unrelated instance; commands and results identify the tested revision.

### E02. Structured task-review findings

**Priority: first.** Add stable finding IDs, requirement references, affected paths and revision, failure scenarios, evidence type, confirmation status, repair links, and independent recheck results. A possible lifecycle is:

candidate -> confirmed / disproved / unverified -> repair -> independently rechecked -> resolved

Distinguish code inspection, analyzer output, executed tests, and runtime observation. Preserve reasoned static findings when execution is inappropriate or unavailable; not every architectural defect needs an executable reproducer.

**Acceptance:** unsupported findings do not automatically become confirmed; repairing one finding does not resolve the others; approval from an old revision is not borrowed; timeout or skipped coverage produces partial/unknown status. Zero findings is not a clean review when coverage is unknown.

### E03. Review-policy provenance and a joined execution receipt

**Priority: high.** Record versions or hashes of the role instructions, project rules, policy, contract, verifier, selected context, inputs, outputs, and evidence. Distinguish baseline rules from proposed changes to those rules. If a task changes a policy or verifier, make that change explicit in its contract and review.

Compose this receipt from the current evidence and execution ledger rather than storing another complete prompt or secret archive. Record environment and CLI versions only when observed. The review did not demonstrate an exploit in ATL; this is a provenance and completeness recommendation. Official managed-review documentation provides a useful baseline-branch pattern [P12].

**Acceptance:** a candidate cannot pass merely by removing its governing criterion; policy/verifier changes stale the relevant approvals; a hash does not make a missing artifact available; replaying a report is distinguishable from executing a new check.

### E04. Impact-aware repair and invalidation

**Priority: high.** Build repair packets around finding IDs, faulty outputs, input revisions, authorized scope, affected checks, and the reasons for reopening dependencies. Give edges explicit meaning: data, control/authority, shared resource, or side-effect ordering.

Preserve healthy outputs whose inputs and contracts remain valid. Revalidate consumers when a shared interface changes. Keep the existing ability to repair integration within authorized scope; a blind one-file-only rule would be counterproductive. Retaining an artifact does not automatically preserve all approvals attached to it.

**Acceptance:** failure in one independent unit does not rewrite three healthy units; a shared API change invalidates the relevant consumers; unknown impact cannot silently preserve approval; integration verification still runs against the final assembled revision.

### E05. Convert recurring corrections into scoped preventive controls

**Priority: high.** Extend retrospective drafts into a controlled sequence:

occurrence -> root cause -> proposed enforcer -> negative control -> verified prevention

Choose the strongest appropriate layer: architecture, types, lint, tests, tool constraints, or finally instructions. Store failure class, scope, owner, evidence, review condition, and rollback. A complaint or negative rating alone should neither install a universal rule nor disable an existing control. Fixing the generator or tool is preferable to merely suppressing a reviewer finding.

**Acceptance:** the original failure triggers the new control; the repaired case passes; unrelated valid behavior remains allowed; a promoted rule has a reviewable scope and a way back. The Pstack correction workflow is a useful pattern, not a replacement for ATL governance [P02].

### E06. Ranked, bounded, bilingual brain retrieval

**Priority: high.** Replace whole-query substring matching with a measured two-stage path: select topics/pages from a small index, then rank relevant claims using lexical matches, source quality, claim state, freshness, and task relevance. Include selection reasons, retrieval coverage, and an explicit no-evidence fallback. Select context by role and keep a bounded budget.

Start with correct lexical retrieval; embeddings are optional. Reuse navigation and learning concepts where appropriate without treating their separate indexes as the brain's current behavior.

**Acceptance:** a versioned English/Persian query set retrieves expected claims and sources with better recall at a fixed context budget; superseded and contradictory claims are recognizable; insufficient evidence yields unknown instead of a confident answer.

### E07. Temporal claims, decision history, and source independence

**Priority: high.** Give claims and decisions a predicate/type, scope, observation time, review time, validity or revisit condition, and explicit supersedes links. Keep historical decisions while separating them from active ones. Freshness should depend on the claim: a price and a stable architectural constraint should not share an arbitrary universal TTL.

Avoid treating every differing sentence about one subject as a contradiction. Track canonical source identity and independence so ten reposts are not ten independent confirmations. Do not impose two external sources on direct local execution evidence; evidence type matters.

**Acceptance:** independent facts about one subject do not falsely conflict; incompatible decisions remain visible; current and historical decision queries produce appropriately different answers; missing support stays unknown. A quotation or imported page cannot promote itself into governing policy.

### E08. Recoverable knowledge transactions

**Priority: medium, before concurrent knowledge writers.** Apply source/claim/index updates through a native, recoverable plan/apply path: hash preconditions, one authorized writer per transaction, a journal, atomic publication where supported, and recovery after interruption. Preserve concurrent human changes rather than overwriting them.

Revision checks are useful but are not automatically a multi-file transaction or interprocess lock. The reviewed Agrici transaction implementation depends on POSIX facilities and is not a drop-in native Windows dependency; borrow the contract and implement an appropriate local mechanism [R02].

**Acceptance:** interruption at each write boundary leaves recoverable state; two writers cannot silently lose an update; a human edit invalidates a stale plan; source, claim, and index publication is consistent after recovery.

### E09. Durable event ingress and an executor bridge

**Priority: medium, prerequisite for reliable unattended execution.** Connect authenticated, validated events to the existing executor using stable source event IDs, a durable inbox/outbox or equivalent journal, bounded queues, debounce/batching, and backpressure. Treat event input as data, not authorization for an external action.

Use receiver idempotency and reconciliation for effects. Do not promise network-wide exactly-once delivery without the necessary receiver contract. Where webhooks are unreliable, use lightweight reconciliation rather than model polling when nothing changed. Official rate-limit behavior also matters: excess events are not necessarily retried automatically [P06].

**Acceptance:** a redelivery in a later minute remains the same logical event; replay does not repeat the effect; a crash after the effect but before acknowledgment is reconciled; missing credentials or approval block the action explicitly.

### E10. Atomic tool and API budgets

**Priority: medium, alongside E09.** Add reserve/settle semantics for tool and API usage, with global and role limits, explicit time windows, durable accounting, and a policy for unknown settlement after crashes. Retry and provider failover must not reset the remaining allowance.

This extends current model-tier policies; it is not a CSV report that prints STOP after work has already occurred. Distinguish relative cost ordering, reported tokens, estimated currency, and observed billing.

**Acceptance:** concurrent workers cannot each reserve the same remaining quota; an exhausted quota blocks the call before execution; failure and restart do not erase consumption; unresolved usage cannot silently become zero.

### E11. No-progress stopping and routine health

**Priority: medium.** Extend existing bounded no-progress prevention, rather than rebuilding it. The supervisor already excludes settled tasks within an invocation and passes the remaining time allowance. Compare attempts using input/code revision, failure signature, new evidence, and actual environment changes to support justified re-entry. Distinguish transient failure, missing prerequisite, denied authority, useful repair, and owner decision. Changing only prompt wording is not evidence of progress.

For routines, monitor expected runs, credential validity, skill version, verifier drift, and consumption. No incoming event is different from a missed expected run. Any automatic pause or degradation must stay within an existing approved policy.

**Acceptance:** repeated identical permission denial stops consuming retries; resolving the prerequisite allows resumption; an interrupted unknown side effect is not labeled success or retried blindly; health alerts distinguish inactivity from failure.

### E12. Review capacity, actionable decisions, and accepted-outcome economics

**Priority: medium.** Extend current dispatch and notifications with review WIP, waiting time, repair demand, human intervention, and admission control. Preserve capacity to finish review and verification when the queue is full; avoid a policy that fills every slot with new implementation and stalls completion.

Generate a concise change digest and decision inbox from existing state: changed behavior, affected invariants, evidence revision, unverified areas, rollback, owner, requested action, and decision expiry. Avoid another notification store or another lifecycle authority.

Measure cost per accepted outcome across failed attempts, review, repair, and verification. Report actual currency only with reliable billing; otherwise report tokens and coverage. Keep useful findings, repaired findings, and independently supported bugs distinct.

**Acceptance:** ledger replay does not double-count sessions; unknown usage remains unknown; rejected or rescoped work is not hidden from cohort accounting; decisions remain actionable and revision-bound; review backpressure preserves fairness and completion capacity.

### E13. Local review evaluation, harness ablation, and evidence-based model routing

**Priority: high before vendor or architecture selection.** Extend the existing evaluation framework with held-out healthy changes and real defects: cross-file failures, specification mismatch, misleading issue text, policy changes inside a diff, incomplete context, and an environment where tests were never run. Keep the grader outside candidate control and record model/provider, budget, instruction/verifier hashes, timing, and coverage.

Separate three evidence levels: replay, fresh deterministic execution, and explicitly budgeted live-provider canaries. Measure known-defect recall, independently sampled precision, severity, false-positive burden, human time, scope violations, cost, and escaped defects over a defined window. Calibrate automated judges with human-reviewed samples [P15]. No incident or revert alone proves the absence of bugs.

Then add/remove optional critics, specialist fan-out, larger context bundles, or advisor calls under comparable budgets. Required gates and owner authority stay in force. Different models are an experimental condition, not proof of independent errors. Routing should improve total accepted-outcome cost or quality, rather than merely reducing the main model's tokens.

**Acceptance:** a silent no-op reviewer fails on defects; an indiscriminate reviewer loses precision on healthy changes; candidate-edited rules cannot game the score; replay is not reported as a fresh provider run; optional stages survive only when evidence supports them.

### E14. Demonstration-to-routine promotion

**Priority: later, after E01 and E09.** Turn an authorized successful trace into a candidate skill with parameters, inputs, outputs, side effects, approval boundaries, verifier, maintenance conditions, and rollback. Remove credentials, private data, and run-specific assumptions.

Review frontmatter, tool grants, hooks, and dynamic execution as well as the visible instructions. Tool declarations can affect authority; an innocent-looking body is not a complete review [P09]. Use the current governance and initially disabled routine path. A successful demonstration is not unattended-execution permission.

**Acceptance:** fresh-input and failure fixtures pass the intended checks; UI/tool drift cannot produce silent success; promotion preserves action boundaries; extraction alone creates neither a schedule nor new authority.

### E15. Optional HarnessRouter/UHP adapter

**Priority: conditional.** Prototype behind a feature flag only when a second harness is actually needed. Pin the protocol version and negotiate capabilities. Normalize lifecycle, cancellation, errors, partial output, disconnects, and result identities while ATL remains the owner of state, gates, and authorization.

Standardizing an envelope does not make all harness semantics equivalent. Do not treat the attachment's version or claimed savings as a current standard or an established ATL result.

**Acceptance:** contract fixtures cover disconnect, cancellation, duplicate callbacks, unsupported capabilities, and partial completion; failover does not declare success or repeat effects without reconciliation; comparable workloads establish parity and accepted-outcome cost before adoption.

### E16. Readable knowledge projections and selective imports

**Priority: conditional.** Export Markdown with stable source IDs, claim states, backlinks, and revisions; use Obsidian as an optional viewer. Keep manager state and policy authoritative. A projection edit must not silently rewrite authority.

Permit narrowly scoped, opt-in chat imports where useful. Imported conversation is untrusted source material rather than proof of its factual claims. Curate lessons before promotion, keep credentials out, and demote low-value knowledge without silently deleting decision history.

**Acceptance:** projections can be regenerated; source links resolve; stale views are labeled; unauthorized edits cannot change governing state; private material is excluded by the import contract.

## The seven repository patterns

These are pattern assessments, not endorsements of every implementation or a recommendation to install the collection.

| Repository | Pattern worth extracting | Boundary |
|---|---|---|
| R01: kepano/obsidian-skills | Markdown/Canvas formats and Obsidian interaction. | Optional adapter or export, not a replacement memory engine. |
| R02: AgriciDaniel/claude-obsidian | Canonical provenance, source independence, read-only drafts, single writer, plan/apply, and journaled recovery. | Adapt contracts to the host. Its POSIX-dependent transaction implementation is unsuitable as a native Windows drop-in. |
| R03: eugeniughelbur/obsidian-second-brain | Cross-engine lessons, selective retention, and stale-index awareness. | Do not import background permission bypasses. |
| R04: Astro-Han/karpathy-llm-wiki | Immutable raw inputs, derived wiki, ingest/query/lint separation. | Literal quote or number checks are not semantic entailment checks. Integrate with the existing brain and research layers. |
| R05: undefined-ui/second-brain-os | A broad catalog of workflow and tooling ideas. | Extract individual patterns after demand; the entire framework exceeds the demonstrated need. |
| R06: charlie947/ai-second-brain | Selective conversion of conversation history into reusable material. | Imported conversation does not become verified truth. |
| R07: MehmetGoekce/llm-wiki | Small indexes, two-stage retrieval, access logs, lint, and demotion. | Do not store secrets or assume that decisions can never become stale. |

## Enhancement traceability

These links identify the inspiration for each proposal. They do not establish that the proposed ATL capability has already been implemented or measured.

| Enhancement | Principal inputs |
|---|---|
| E01: Project verifier | X01, X07; P01; existing ATL verification skills |
| E02: Task findings | X11; current task evidence and Plan Studio findings |
| E03: Policy provenance and receipt | X07, X08, X11; P12, P17; current handoff and execution ledger |
| E04: Targeted repair | X05, X07, X10; current dependency and integration contracts |
| E05: Correction to prevention | X01, X10; P02; existing retrospective and governance paths |
| E06: Retrieval | X03, X04, X12; R07; current brain, navigation, and learning implementations |
| E07: Temporal provenance | X04, X12; R02; current claim and stale-scan behavior |
| E08: Knowledge transactions | X04; R02; current source/claim/index storage |
| E09: Event bridge | X02, X09; P03, P06; current routine queue and executor boundaries |
| E10: Tool budgets | X02; current resource-policy limits and the attachment's cost claims |
| E11: Progress and routine health | X06, X09, X10; current supervisor and routine limits |
| E12: Review capacity and economics | X05, X06, X08, X11; existing notifications and execution reports |
| E13: Evaluation and ablation | X08, X11; P10, P13-P16; model-routing/evaluation attachments; current evaluation pilot |
| E14: Routine extraction | X09; P09; current skill promotion and routine governance |
| E15: Harness adapter | HarnessRouter/UHP attachment; P22; current ATL lifecycle and authority contracts |
| E16: Knowledge projection | X03, X04, X12; R01, R03-R07; existing brain as the authoritative knowledge store |

## Recommended delivery sequence

| Phase | Scope | Concrete evidence required |
|---|---|---|
| 1 | E01 + E02, with a minimal E03 receipt | One genuine defect is reproduced, tracked, repaired, and independently rechecked on the final revision. |
| 2 | E03 + E04 + a scoped E05 example | Review criteria remain traceable, healthy artifacts survive targeted repair, affected checks reopen, and one recurring failure gains a tested preventer. |
| 3 | E06 + E07; E08 before concurrent writes | Source tracing, active/historical decisions, and no-evidence responses pass; bilingual retrieval improves under a fixed budget; interrupted writes recover. |
| 4 | E09 + E10 + E11 | Stable event replay, quota contention, crash recovery, and stopping without progress are demonstrated. |
| 5 | E12 + E13 | Comparable task cohorts expose quality, review burden, delay, coverage, and complete outcome cost. E13 fixtures should already guide earlier phases. |
| 6 | E14, E15, and E16 only where needed | A routine, second harness, or projection satisfies its contract without introducing a second source of authority. |

The first implementation should be a narrow vertical slice, not the entire catalog. Choose one real defect with an observable failure, make its verifier repeatable, capture its finding and repair, independently recheck the final source identity, and produce the receipt. Add a preventive control only if the failure class and appropriate scope are understood.

Before and after that slice, record verifier coverage, finding disposition, repair attempts, elapsed review time, available usage data, and remaining unknowns. Do not set an improvement percentage before collecting comparable evidence.

## Evaluation and interpretation cautions

The original research supports local measurement rather than a universal reviewer ranking. SWE-PRBench reports limitations and degradation for its tested context configurations; this does not mean all useful context should be removed [P13]. AACR-Bench shows that effects vary by model and retrieval method, including precision/recall trade-offs [P14]. c-CRAB offers a held-out-test approach for review evaluation [P16]. ReviewBench's methodology distinguishes its evaluation constructions and uses calibrated judging; it is not a reason to outsource ground truth entirely [P15].

Similarly, source stars, personal revenue, a large run count, a vendor's accepted-finding metric, and marketing savings are not ATL outcome evidence. Repeated clean runs are useful observations with a stated sample and environment, not a blanket trust promotion. More autonomy should follow task-class evidence under the existing trust policy.

## Source register

### User-supplied X links

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

Other supplied inputs were the two pasted-text attachments accompanying the first batch. The [Hanako course sales page](https://agent-layers.vercel.app/) was accessible; the paid course content was not.

### Primary documentation and research consulted in the underlying reviews

- [P01: Pstack, create verification skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md)
- [P02: Pstack, correct](https://github.com/cursor/plugins/blob/main/pstack/skills/correct/SKILL.md)
- [P03: xAI, skills, routines, and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [P04: xAI, approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- [P05: Cursor, secrets and Vault](https://cursor.com/help/grok-bot/secrets)
- [P06: Cursor, routines](https://cursor.com/help/grok-bot/routines)
- [P07: Claude Code, goal](https://code.claude.com/docs/en/goal)
- [P08: Claude Code, subagents](https://code.claude.com/docs/en/sub-agents)
- [P09: Claude Code, skills](https://code.claude.com/docs/en/skills)
- [P10: Anthropic, harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [P11: Anthropic, multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system)
- [P12: Claude Code, customize code review](https://code.claude.com/docs/en/code-review-customize) and [code review](https://code.claude.com/docs/en/code-review)
- [P13: SWE-PRBench](https://arxiv.org/abs/2603.26130)
- [P14: AACR-Bench](https://arxiv.org/abs/2601.19494)
- [P15: ReviewBench methodology](https://github.com/review-bench/ReviewBench/blob/main/docs/METHODOLOGY.md)
- [P16: c-CRAB](https://arxiv.org/abs/2603.23448)
- [P17: Codex, custom code review rules](https://developers.openai.com/blog/custom-code-review-rules-for-codex)
- [P18: Claude Code, scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)
- [P19: Claude Code, memory](https://code.claude.com/docs/en/memory)
- [P20: Cursor, Bugbot](https://cursor.com/docs/bugbot)
- [P21: karpathy/autoresearch](https://github.com/karpathy/autoresearch)
- [P22: HarnessRouter](https://github.com/HarnessRouter/harnessrouter)

### Repository collection

- [R01: kepano/obsidian-skills](https://github.com/kepano/obsidian-skills)
- [R02: AgriciDaniel/claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian), including selected provenance and operation-transaction contracts.
- [R03: eugeniughelbur/obsidian-second-brain](https://github.com/eugeniughelbur/obsidian-second-brain)
- [R04: Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki)
- [R05: undefined-ui/second-brain-os](https://github.com/undefined-ui/second-brain-os)
- [R06: charlie947/ai-second-brain](https://github.com/charlie947/ai-second-brain)
- [R07: MehmetGoekce/llm-wiki](https://github.com/MehmetGoekce/llm-wiki)

### Local evidence map

Paths below identify the files and symbols inspected during the underlying research; their presence is not a claim that a new runtime check was executed.

| Concern | Local inspection points |
|---|---|
| Evidence and task review | runtime/lib/state.mjs:addEvidence; runtime/lib/worker.mjs:promptFor; runtime/lib/task-changes.mjs:evidenceFor; docs/task-change-review.md |
| Revision and integration | runtime/lib/handoffs.mjs; runtime/lib/plan-studio.mjs:reviewPlanArtifact/planReviewSnapshotCurrent; runtime/lib/task-statechart.mjs |
| Knowledge and retrieval | runtime/lib/brain.mjs:addClaim/buildContextPack; runtime/lib/navigation.mjs; runtime/lib/launch.mjs; runtime/lib/learning.mjs |
| Learning and promotion | runtime/lib/research.mjs:scanRetros; runtime/lib/feedback.mjs; runtime/lib/governance.mjs |
| Execution and authority | runtime/lib/dispatcher.mjs; runtime/lib/routines.mjs; runtime/lib/supervisor-runner.mjs; runtime/lib/worker-channel.mjs; runtime/lib/execution-access.mjs |
| Cost and decisions | runtime/lib/execution-report.mjs; runtime/lib/resource-policy.mjs; runtime/lib/notifications.mjs; docs/execution-reports.md |
| Verification capability | skills/atl-verify; skills/atl-maintain-verification; skills/verify-atl-manager-lifecycle; docs/guides.md |
| Evaluation baseline | evaluations/atl/README.md; evaluations/atl/SUMMARY.fa.md |

This is the consolidated recommendation document. It preserves the distinction between observed code, external patterns, unverified claims, and proposed work; it creates no implementation or autonomy approval.
