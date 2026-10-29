# Plan Studio contract

## Apply the contract

Follow [Plan Studio](plan-studio.md) to generate, clarify, review, and approve a plan. Inspect the current artifact, source revision, and review binding before approval. If validation fails, update the artifact and obtain a fresh review rather than retrying stale evidence.

Plan Contract v2 separates requirements, constraints, observed evidence, assumptions, open questions, acceptance examples, and risks. Every task links to requirements and records instructions, deliverables, prerequisites, affected paths, completion checks, a verifier, and a reason for each selected skill.

Generated plans remain proposals. Approval requires a separate provider review with no unresolved consequential questions or major/blocker findings. The review is tied to the plan, original intent, and fingerprints of referenced files; editing a task or changing captured evidence clears its readiness. Local templates and legacy drafts remain useful for editing but cannot be approved as reviewed implementation plans.

“Passed” means the artifact met its declared structure and the configured reviewer found no blocking issue. It is not a guarantee of correctness, a claim that checks ran, or authorization to execute work.

GitHub, Jira, and Azure intake records preserve the remote identity and revision as source context when a task is sent to Plan Studio. Imported work is blocked from execution until its source task receives an approved Plan Studio accuracy review. The publish preview shows create or update actions; publishing requires a fresh review and explicit confirmation. Existing remote records are checked against their last recorded revision, and successful mappings are saved after each item so a retry does not create duplicates. GitHub publishing uses `GITHUB_TOKEN`; Azure uses the configured `intake.azure` project and its `token_env` (default `AZDO_PAT`).
