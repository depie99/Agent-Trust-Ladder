# Lazy Mode: method and configuration

Lazy Mode adapts the independent divergence, critic, clustering and focus stages described by [ADHD](https://adhdstack.github.io/#impl) to executable engineering plans. Each frame gets only the request, supplied context, and its own perspective. A separate critic scores every idea on fit, feasibility and verifiability, flags traps, and another call clusters the candidates. The highest-scoring non-traps are deepened in fresh calls, then another fresh call synthesizes a compact plan. Independent calls reduce cross-branch anchoring; they do not prove correctness or model independence. The critic is model-generated, not human approval.

## Run

Install and authenticate Codex CLI; Python 3.9+ is required. In the target repository, prepare a UTF-8 context file with the actual requirements, scope, acceptance examples, repository paths, known verifier commands and approval status. Then run:

```sh
python <skill-directory>/scripts/lazy.py "Plan the requested change" --context path/to/context.md
```

The result prints to stdout; the caller reviews it and saves it at the appropriate project location. Add `--json` to inspect the candidates, scores, clusters, selected proposals and call count. No plan or project file is written by the orchestration script. Child sessions use the target directory with Codex's read-only sandbox and ephemeral sessions. Do not include secrets in context: it is sent to the configured model provider. Host policy and provider settings still apply.

Use `--config path/to/config.json` to override any fields in [config.example.json](config.example.json). `frames` selects 1–5 unique names from `minimal`, `contracts`, `failure`, `developer`, `inversion`; `ideas` is 1–6 per frame; `top` is 1–5 and at most the total candidates; `concurrency` is 1–4; `timeout` is 10–600 seconds per call; `model` and `critic_model` are optional Codex model names. The critic model defaults to `model`, and a null model uses the user's Codex default. Unknown or invalid settings fail before calls begin.

Maximum calls = frame count + 2 (score and cluster) + top + 1 (synthesis). Defaults use up to 10 calls, so parallel ideation generally costs more tokens than a single-pass plan; compact final output is not a promise of lower total cost. Reduce frames and top for tighter budgets, but parallel diversity requires at least two frames. A failed, timed-out, malformed, incomplete, or all-traps result stops the run; partial branches are not treated as an approved plan. No automatic retries or provider failover occur.

The final proposal is model-generated and may include unsupported file names or checks. Inspect the actual repository and correct or mark such items OPEN before treating the plan as executable. Applicable project policies and explicit Critical approval remain in force. The workflow does not execute tasks, approve a plan, merge, deploy, or publish.

The original ADHD evaluation is not an evaluation of Lazy Mode. No claims about Lazy Mode's quality, token savings, or comparative performance are implied; meaningful evaluation would require a separate benchmark and measured usage.
