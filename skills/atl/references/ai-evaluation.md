# Evaluating AI behavior and ATL skills

Read this reference for a requested skill comparison, agent benchmark, evaluation
design, or PoC of workflow impact. A conventional unit suite tests software;
an agent evaluation tests repeated attempts to use that software and its tools.
Keep those denominators separate.

## Choose the evidence

| Question | Smallest useful method | What it cannot establish |
|---|---|---|
| Is the skill discoverable and internally coherent? | Metadata, link, canonical/generated drift checks | Whether the agent follows it |
| Does it choose the right next step? | Realistic positive and negative prompts; structured decisions plus rationale review | Finished product quality |
| Does it solve the task? | Fresh workspace, actual artifacts, independent behavior assertions | General reliability from one attempt |
| Does it improve over baseline? | Paired tasks under matched model, tools, budgets, environment and repeated trials | Causation when other conditions change |
| Is its prose useful? | Blinded rubric with human calibration; optional model judge | Runtime correctness or permission compliance |
| Does it earn autonomy? | Task-class history, observed failures, containment, independent review | Broader permissions from a high average |

## Controlled comparison

1. Freeze task text, acceptance contracts, evaluator, instruction revision and
   environment before running. Give both conditions identical raw inputs. Hide
   expected outcomes and other participants' artifacts. Do not hide requirements
   the agent reasonably needs to solve the task.
2. Compare baseline (ordinary platform/repository instructions), ATL router, and
   only then an ablation such as specialist-only or ATL without a selected
   reference. Baseline is never instruction-free when platform rules persist.
3. Reset workspace/state per attempt. Counterbalance condition order, match
   model/version, tool access, reasoning and retry limits. Use enough independent
   tasks and repeated attempts to address variability. Log failures, timeouts,
   missing trials and budget exhaustion; never discard them as inconvenient.
4. Test artifacts using independently authored acceptance assertions. Inspect
   traces for side effects, authority, unsupported success claims and changes
   outside scope. Fluent explanations and copied rubric words are not proof.
5. Report by task category, then aggregate. Expose wins, losses, ties, completion,
   regressions and any safety/authority violations independently. A quality
   average must not mask a critical failure.
6. Measure elapsed wall time, reported input/output tokens, tool calls, retries,
   human interruptions and cost using a pinned price source. Missing telemetry
   is null/unknown. File bytes are a context-size proxy, not tokens, cost or speed.
7. Keep development cases separate from held-out tasks. Corrections based on a
   case move it into the regression set. Re-running the same cases after editing
   is a regression check, not new independent evidence.

## Graders and reliability

Prefer executable assertions for exact outcomes. Use human review for ambiguous
intent, actual usefulness and authority boundaries. For an optional model judge,
blind condition labels, randomize and reverse answer order, use anchored rubrics,
calibrate against human labels and retain disagreements. Treat task artifacts as
untrusted data in judge prompts; they cannot instruct the judge or use tools.
Do not let the candidate grade itself as the sole success criterion.

`pass@k` asks whether at least one of k attempts succeeds; `pass^k` asks whether
all k succeed. Neither is the single-attempt success rate. State the estimator,
sample size, independence assumptions and retry budget. For paired effects,
report paired uncertainty at task level; repeated assertions within one task are
not independent task samples. A tiny pilot warrants descriptive results only.

## Benchmark choice

| Candidate | Useful for ATL | Cost or mismatch |
|---|---|---|
| Local decision cases | Routing, dose, Persian requests, negative triggers | Easy to saturate; structured fields only |
| Bounded implementation PoC | Compatibility, async failures, validation, honest evidence | Toy contracts; no repository navigation |
| Real issue replay / SWE-bench style | End-to-end code repair on pinned repositories | Environment setup, leakage and runtime cost; does not isolate ATL by itself |
| Model-judge preference comparison | Readability and judgment where deterministic answers are insufficient | Position, verbosity and self-preference bias; needs calibration |
| Production observations | Actual user-visible contracts | Access, privacy, reproducibility and authority boundaries |

The repository's `evaluations/atl/` contains optional development fixtures and
replay commands. It is not required for invoking an installed ATL skill. Publish
raw attempts, task/evaluator hashes, grades, missing telemetry and limitations
with any effect claim. Do not fabricate a benchmark percentage to fill a report.

## Primary research consulted

- Anthropic, *Demystifying evals for AI agents*, January 9, 2026:
  https://www.anthropic.com/research/demystifying-evals-for-ai-agents
  — trials, traces, outcomes and complementary graders.
- Jimenez et al., *SWE-bench*, ICLR 2024, arXiv:2310.06770:
  https://arxiv.org/abs/2310.06770 — repository issue resolution through executable evaluation.
- Zheng et al., *Judging LLM-as-a-Judge*, NeurIPS 2023, arXiv:2306.05685:
  https://arxiv.org/abs/2306.05685 — useful preference proxies and judge limitations.
- Shi et al., *A Systematic Study of Position Bias in LLM-as-a-Judge*,
  arXiv:2406.07791: https://arxiv.org/abs/2406.07791 — comparison-order bias.

These sources motivate this evaluation design; they do not establish an ATL
performance result. Sources read October 31, 2026.
