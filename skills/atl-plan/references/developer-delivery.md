# Developer delivery contract

Version 1 is the shared definition of ready, completion and evidence for the Control Plane and a skills-only installation. It is a record format plus a deterministic verdict. Importing a receipt never grants authority or advances an existing manager lifecycle gate.

## Outcomes

| Verdict | Meaning |
|---|---|
| `verified-local` | Required checks and an independent review approve the current content revision; no blocking finding remains. |
| `review-required` | Checks are current, but approval for the final content revision is absent, stale or not independent. |
| `blocked` | An unresolved blocker, critical or major finding prevents verification. |
| `incomplete` | The schema, content identity, required checks or host capability is missing, malformed or stale. |

A local verdict is not a published pull request, merge, deployment or remote-system update.

## Receipt

Keep the receipt as JSON next to its evidence. At minimum it contains:

- `version`, `kind`, `task.id` and optional source identity/revision;
- a `content` manifest of safe project-relative paths, SHA-256 file digests and optional Git modes;
- required `checks` with actual `result`, `coverage`, verifier, command and the exact content revision;
- one `review` record with result, reviewer and exact content revision;
- `findings` with stable IDs, severity, status, affected requirement/path, evidence and disposition;
- `decisions` with the finding they address, the outcome, an authorized actor and a reason;
- `artifacts` with a locator, SHA-256 when available, availability and attribution to the actor that produced them;
- explicit host capabilities and usage coverage.

A Git commit alone is not content identity: admitted dirty and untracked files are part of the manifest. Any changed included file, check or policy makes affected evidence stale. Missing evidence never means pass. Unknown token usage is recorded as `unknown`.

Findings are closed only with current evidence:

- `resolved` needs a `recheck` naming a passing check and the exact content revision it observed. A resolution claim without that recheck stays blocking.
- `risk-accepted` needs a matching `decisions` entry with `outcome: "risk-accepted"`, a `reason` and an `authorized_by` actor. Acceptance without all three stays blocking.
- `open`, `blocker`, `critical` and `major` findings block the verdict until they are closed by one of the paths above.

A changed interaction (`visual_change: true`) needs both a declared visual-observation capability and a linked capture artifact of the observed behavior. A contract or statechart diagram is not runtime evidence.

Use the bundled `scripts/developer-delivery.mjs` helper:

```sh
node scripts/developer-delivery.mjs revision content-manifest.json
node scripts/developer-delivery.mjs validate delivery-receipt.json
node scripts/developer-delivery.mjs validate delivery-receipt.json --content-revision <current-sha256>
node scripts/developer-delivery.mjs render delivery-receipt.json --output evidence/delivery-receipt.md
```

The helper is pure Node.js and does not require the Control Plane, manager state, a database or network access. Its exit code is `0` only for `verified-local`; `2` means the receipt was evaluated but the delivery is not verified; `64` means invalid command usage.

## Skills-only package

Write the machine-readable receipt as JSON and its Markdown rendering next to the collected evidence, then link artifacts with project-relative paths:

```sh
node scripts/developer-delivery.mjs validate evidence/delivery-receipt.json --content-revision "$(node scripts/developer-delivery.mjs revision evidence/content-manifest.json)"
node scripts/developer-delivery.mjs render evidence/delivery-receipt.json --output evidence/delivery-receipt.md
```

The reviewer must be able to read the verdict, the current or missing checks, the changed files, the unresolved findings and decisions, and each artifact's availability without the Control Plane. The JSON and the Markdown rendering always share one evaluation; neither surface may upgrade a claimed verdict.

## Rules for both surfaces

1. Obtain an observable acceptance check before implementation.
2. Verify the final content, including relevant dirty and untracked files.
3. Require current complete evidence from the declared verifier.
4. Record independent review separately from implementation. Multiple roles in one transcript are not independent review.
5. Preserve unresolved findings as blockers or decisions; do not hide them behind a successful worker exit.
6. Record visual observation for a changed interaction when that behavior matters. A contract diagram is not runtime evidence.
7. Report limits of the host: execution, browser observation, independent review and enforceable budgets are capabilities, not assumptions.

## Runtime adaptation

The runtime derives a receipt from task state and its content-addressed workspace snapshot. It may reuse existing role and lifecycle gates, but the normalized verdict must agree with the portable helper. A caller cannot submit `verified-local` to bypass review, integration gates or required checks.

## Skills-only adaptation

The installed skill carries this reference and helper. Read and write receipts in the selected project's evidence directory. A project-local receipt describes only that workspace; it does not claim another host is locked out. If the host lacks execution or independent review, stop at the honest verdict rather than manufacture evidence.
