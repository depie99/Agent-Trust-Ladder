# Project verifier

A project-local verifier manifest turns readiness into a repeatable check. Keep it at `.atl-verifier.json` unless the task names another path. It must exercise the product's observable behavior, not restate an implementation detail.

## Manifest

```json
{
  "version": 1,
  "id": "checkout-regression",
  "owner": "rowan",
  "requiresLockfile": true,
  "auth": { "environment": ["CHECKOUT_FIXTURE_TOKEN"] },
  "capabilities": { "execution": true, "visual_observation": false },
  "prerequisites": [
    { "files": ["package.json", "src/checkout.js"], "command": ["node", "--check", "src/checkout.js"] }
  ],
  "baseline": {
    "commands": [["node", "verification/health.mjs"]]
  },
  "checks": [
    {
      "id": "discount is applied once",
      "command": ["node", "verification/discount.mjs"],
      "expected": { "exit_code": 0, "stdout_includes": "discount=10" },
      "readback": {
        "command": ["node", "verification/discount-readback.mjs"],
        "expected": { "exit_code": 0, "stdout_includes": "persisted=10" }
      },
      "artifacts": ["build/discount-result.json"]
    }
  ],
  "content": ["src/checkout.js", "verification/discount.mjs"],
  "evidence": ".atl-evidence/checkout-regression.json"
}
```

Commands are executable argument arrays. Do not put a shell pipeline, redirect or credential in a manifest. Missing environment variables are reported by name only.

## Semantics

- `prerequisites` checks required files and runs cheap setup/health commands.
- `baseline.commands` must pass before dispatch. A failing health command is a baseline failure, separate from the task's expected red acceptance check.
- Each acceptance check needs an observable command. An optional `readback` observes persisted state through a separate surface. Artifacts must exist after the command.
- `content` names files that define the tested revision. Their SHA-256 digests are recorded with the evidence.
- Evidence records exact commands, exit codes, bounded output, tested content and verifier version. It does not claim a browser or independent reviewer ran.

Run it with the bundled helper:

```sh
node scripts/project-verifier.mjs check .atl-verifier.json
node scripts/project-verifier.mjs run .atl-verifier.json
```

`run` writes `.atl-evidence/project-verifier.json`. Exit code `0` means every acceptance check passed; `2` means readiness or verification failed; `64` is invalid invocation.

## Broken/fixed discipline

1. Run the acceptance check on the genuine broken fixture; it must fail for the intended behavior.
2. Apply the product repair.
3. Rerun the same verifier and the readback.
4. Treat a change to the assertion as a separate review decision from a change to the product.

For a UI behavior, observe the final state, interaction and relevant viewport. An opening screenshot, DOM presence alone or a contract diagram does not prove the interaction worked. Record unavailable browser observation as an explicit limitation.

## Runtime and skills-only

The Control Plane uses the same manifest during task readiness and reports the first actionable cause. It may use already authorized local preparation but must not invent credentials, install tools or continue past a failed baseline.

The skills-only path runs the bundled helper in the selected project. Discover and run an existing project verifier before creating another one. Cleanup must target paths created by this verifier run and leave unrelated files, processes and user instances alone.
