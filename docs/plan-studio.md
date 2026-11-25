# Plan Studio

Use Plan Studio when a request describes an outcome but lacks independently executable tasks. Planning proposes work; review and owner approval decide whether it can enter an execution queue.

The Studio is a conversational workspace: the **conversation** on the left drives generation and revisions, the **plan** on the right (Overview / Tasks / Review tabs) always shows the saved artifact. Nothing queues or executes from this page.

In a connected developer harness, use the current harness assistant as the primary planning conversation. `atl_plan_context` gathers repository and issue context, `atl_plan_save` writes revisioned drafts to this same Studio, `atl_plan_answer` records decisions, and `atl_plan_review`/`atl_plan_approve` gate execution behind a reviewed draft. Ask once whether the developer prefers every uncertainty, only consequential questions (default), or broad defaults. Keep the questions and answers in harness chat; save meaningful changes as they happen. Do not invoke a separate planning provider unless the developer asks. The browser remains available to inspect and revise the identical artifact.

## Prepare the request

Open **Plan Studio** with a request or imported issue. State the outcome, constraints, project, and acceptance examples in the composer — Enter adds a line, Ctrl/Cmd+Enter sends. Distinguish observed evidence from assumptions. Attach reference files from **⚙ Settings**, and start with [issue sources](issue-sources.md) for external work.

## Generate and review

1. Inspect planning provider readiness (compact provider selector beside the composer; model, thinking effort, attachments, and skeleton mode live in **⚙ Settings**).
   For a Codex ChatGPT sign-in, the picker uses the installed Codex CLI's model list. If your configured default is unavailable, Plan Studio selects the CLI's listed default.
   For key-based providers, **Load models** refreshes suggestions from the configured endpoint. You can also enter an exact model ID directly.
2. **Generate plan** sends one bounded provider call (or a free deterministic local skeleton) and the plan appears beside the conversation.
3. Open **Questions** in the conversation whenever convenient. Numbered cards offer suggested answers and free text, show progress, and retain unfinished responses across closing, reopening, and reloading. Planning stays available while questions are open.
4. Refine conversationally: with a draft open, the composer submits **Update plan** — one bounded refinement call that proposes a full candidate plan. The proposal lands in the Tasks tab as **Proposed changes · based on rev N** with added, changed, and removed task cards. **Apply changes** writes it against its originating revision (a manual edit in between makes it stale and refused with a reload-and-retry message; applying clears review readiness). **Discard** drops it. Manual edits and failed calls never touch the saved plan.
5. Edit task cards directly (instructions, deliverables, dependencies, files, checks, skill reasons, worker) or ask about a single task from its card.
6. Request separate provider review of the current artifact (accuracy or deep review).
7. ATL checks submitted answers immediately, applies evidence-backed corrections or clearly labeled reversible assumptions, updates affected tasks, and requests an independent accuracy review. Review findings enter this same conversational correction flow. Each interaction allows one correction pass and one follow-up review; remaining concerns stay visible without stopping planning. Explicit preferences and original answers are retained. Provider failures retain the saved plan and answer and offer retry. Verify the source revision before approval.
8. Approve the reviewed artifact to create an execution queue.

The persistent next-step control (header and plan-pane bar) offers questions, proposed changes, review, conversation, or queue approval. Accuracy concerns do not lock the conversation or editing. Approval and queueing still require a fresh passing review with consequential issues resolved. Reopening a saved draft restores its conversation and answer assessments; older drafts default to empty assessment and question-progress records.

![Plan Studio in the synthetic documentation project](assets/screenshots/studio.jpg)

Expected result: an approved plan creates bounded task packets in a queue. Editing after review invalidates its binding. A stale source revision blocks approval. A description or local preview is insufficient evidence. On desktop, Plan gets slightly more space in the resizable split. Use **Focus Plan** for full-width task and review details or **Focus conversation** for a single-pane chat. Below 960 px, use the Conversation and Plan tabs.

## Publish deliberately

Inspect **Publish destination**, preview its GitHub or Azure destination, then confirm the exact publication. Local queue creation and remote issue creation are separate operations. Inspect existing publication mapping before retrying to avoid duplicates.

## Choose the review depth

Plan Studio offers two review depths before approval. **ATL accuracy review** starts with one schema-gated model call. Findings can trigger one correction call and one independent follow-up accuracy review. Submitting an answer uses one correction call and one review call. **EGM deep review** runs the Elephant–Goldfish–Model review protocol: five independent stage reviewers plus a synthesizer, each a fresh single-shot call with no shared conversation. Its findings can enter the conversational correction flow; a follow-up accuracy review does not satisfy a policy that requires a fresh deep review.

The backend is selected in `config/manager.json` under `egmReview`:

- `"backend": "glm-goldfish"` — the protocol natively through ATL's planning seam with any configured provider (for example GLM). Needs only `enabled`, `backend`, and the pinned `versionSha`.
- `"backend": "codex"` (default) — the real EGM plugin through a dedicated CODEX_HOME: `codexHome`, `model`, pinned `versionSha`, the plugin installed, and `codex login` completed for that home.

A missing or unusable configuration is refused explicitly before any spend. Every finding is bound to the reviewed artifact and evidence snapshot: a plan or evidence change invalidates the review, and a blocked or stale deep review keeps the approval gate shut — the same contract as the accuracy review. Failed, timed out, or incomplete deep reviews are recorded as failures with their raw run preserved beside the draft, never as a clean pass.

Deep reviews run with operational guardrails: a cross-process review lock per draft prevents two simultaneous reviews (a conflict answers `409` with the holding pid); a daily budget caps started reviews (default 3, `egmReview.maxReviewsPerDay`, counted in `.trust/manager/plan-review-usage.json`); stage progress is exposed while a review runs, and the owner can cancel between stages — the raw run is preserved and no review is recorded.

A policy can require a deep review before approval: set `egmReview.policy` in `config/manager.json` (`requireDeepReview`, `minComplexity`, `maxTaskProposals`, `touchGlobs`). Approval of a matching plan is refused until a fresh EGM review has passed, and the Studio surfaces **Run deep review** / **Deep review required by policy** instead of a bare approval button.

## Resolve an approval block

Read answer feedback and review recommendations in the conversation. ATL handles bounded corrections automatically; revise an answer or retry its check when needed. Consequential unresolved issues, insufficient checks, stale sources, and legacy artifacts still affect approval readiness. See the [plan contract](plan-studio-contract.md) for fields and bindings.

Source: `runtime/lib/plan-studio.mjs`, `plan-model.mjs`, `plan-publish.mjs`. Checks: `verification/plan_contract_test.mjs`, `plan_studio_refine_test.mjs`, `plan_studio_refine_api_test.mjs`, `plan_studio_journey_test.mjs`, and `plan_publish_test.mjs`.
