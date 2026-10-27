# Jev smart routing in ATL

> Use Jev when the best ATL specialist is unclear. Keep deterministic routing as the default, and let ATL reject uncertain decisions.

## Choose the right route

| Situation | Use | Why |
| --- | --- | --- |
| The request clearly names the work | `atl route T-001` | No model call; local keyword and label routing is enough. |
| Two or more specialists could fit | `atl route T-001 --smart` | Ask Jev for one bounded routing opinion. |
| You are preparing Pip's task packet | `atl triage T-001 --smart` | Persist the smart route while preparing triage. |
| The task is high-risk or crosses an external boundary | Use Jev only as a suggestion | ATL and a human still own risk, authority, and evidence decisions. |

Jev is not a coding, writing, planning, or verification agent. It returns one typed route choice and confidence. ATL still performs the work and enforces the trust gates.

## Quickstart: make one smart routing decision

### Prerequisites

- ATL is installed and `atl init` has been run in the target project.
- The task already exists, for example as `T-001`.
- You have a TypeSafe API key if you want a live Jev decision.
- You are using a server-side shell; never put the key in a repository file.

### 1. Enable Jev for this project

Edit `config/jev.json`:

```json
{
  "version": 1,
  "enabled": true,
  "model": "jev-latest",
  "min_confidence": 0.75,
  "timeout_ms": 2500
}
```

Set the key in the current PowerShell session:

```powershell
$env:TYPESAFE_API_KEY = "..."
```

The checked-in default is disabled. ATL therefore makes no Jev calls until you opt in.

### 2. Write a useful ATL task

You do not write a second prompt for Jev. Write one normal ATL task with four parts:

1. the visible problem or desired outcome;
2. the affected surface;
3. constraints or compatibility requirements;
4. observable checks for completion.

Example:

```text
Improve the checkout page's loading state. Inspect the rendered UI, preserve the existing visual language, and verify the result at mobile and desktop widths.
```

ATL reduces that task to a compact state:

```json
{
  "title": "Improve the checkout page's loading state",
  "objective": "Inspect the rendered UI, preserve the existing visual language, and verify the result at mobile and desktop widths.",
  "labels": ["ui"]
}
```

ATL also sends a closed list of available routes from `config/skill-routing.json`. Jev may choose only one available skill ID; it cannot invent a skill.

### 3. Ask for the smart route

```powershell
atl route T-001 --smart
```

Or include the decision in Pip's triage packet:

```powershell
atl triage T-001 --smart
```

### 4. Read the result

Accepted decision:

```text
Route: matched (jev)
  skills: atl-ui-review
  proposed worker: rowan
  decision: jev accepted=true
  confidence: 0.91
```

Fallback decision:

```text
Route: matched (skill-routing.json)
  skills: atl-tech-docs
  decision: jev-fallback accepted=false
  confidence: 0.61
  decision reason: confidence below 0.75
```

Fallback is the expected safe behavior. It is not an error condition.

## What to write for common tasks

### Documentation and implementation overlap

```text
Update the API authentication guide because the token exchange changed. Check the current runtime configuration, update examples, and verify that the documented command still works.
```

Likely route: `atl-tech-docs`. The implementation route remains available if code changes are required.

### UI and implementation overlap

```text
The empty state is technically present but visually confusing on mobile. Inspect the rendered page, improve hierarchy and responsive behavior, then verify the mobile and desktop states.
```

Likely route: `atl-ui-review`.

### Formal verification and implementation overlap

```text
The manager can reach done without all completion evidence. Model the state transitions, add a negative control, and verify the invariant against the runtime contract.
```

Likely route: `atl-formal-verification`. Use `atl-maintain-verification` when the verification skill or its harness is the surface being changed.

### Content and SEO

```text
Rewrite the pricing page for search intent without inventing product claims. Preserve the approved facts, improve scanability, and verify metadata and internal links.
```

Likely route: `atl-content-quality`.

## How Jev saves context and tokens

Jev is deliberately not another skill stack:

- normal intake and normal routing make zero Jev calls;
- `--smart` makes one request only;
- the request contains the title, objective, labels, and route descriptions—not the repository or skill bodies;
- the request asks one typed `Choice`, not for a generated explanation;
- ATL does not retry through another model when Jev is unavailable;
- low confidence and all transport failures use the existing deterministic router;
- ATL adds no TypeSafe SDK dependency to the package.

Jev can reduce wasted routing context. It does not reduce the tokens required by the worker to understand and implement a large task.

## Trust boundary

Jev is advisory. ATL remains authoritative for:

- scope and user intent;
- skill availability;
- actor permissions;
- status transitions;
- evidence requirements;
- review, merge, deployment, and destructive actions.

A high-confidence Jev choice is routing evidence, not completion proof. The selected worker must still plan, implement, review, verify, and return the ATL Trust Verdict.

## Configuration reference

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Allows smart calls when `--smart` is present. |
| `model` | `jev-latest` | TypeSafe model name. |
| `min_confidence` | `0.75` | Minimum confidence required to accept Jev's route. |
| `timeout_ms` | `2500` | Per-request timeout before deterministic fallback. |
| `TYPESAFE_API_KEY` | unset | API key read from the environment. |

Environment overrides are `ATL_JEV_ENABLED`, `ATL_JEV_MIN_CONFIDENCE`, `ATL_JEV_TIMEOUT_MS`, and `TYPESAFE_DEFAULT_MODEL`.

## Troubleshooting

### `--smart` always falls back

Check the local configuration and environment:

```powershell
atl validate
atl route T-001
$env:TYPESAFE_API_KEY
```

Then confirm:

- `config/jev.json` contains `"enabled": true`;
- the API key exists in the current shell;
- the configured model is available to the account;
- the confidence threshold is not higher than intended;
- the candidate route exists in `config/skill-routing.json` and its skill is installed.

### The route is wrong

Improve the task title, objective, labels, or route descriptions. Do not lower the confidence threshold only to force acceptance. Compare the Jev decision with `atl route T-001`; the deterministic result is the supported fallback.

### Jev is unavailable

Continue with deterministic routing. ATL is designed to remain useful without the external service.

## Source of truth

- Runtime behavior: `runtime/lib/jev.mjs` and `runtime/lib/skill-router.mjs`.
- CLI behavior: `runtime/atl-manager.mjs`.
- Route choices: `config/skill-routing.json`.
- Jev defaults: `config/jev.json`.
- This guide: `docs/jev.md`; the GitHub Pages mirror is `docs/jev.html`.

Run the repository verification loop after changing this guide or the Jev implementation:

```powershell
python scripts\maintain_verification_skill.py
```
