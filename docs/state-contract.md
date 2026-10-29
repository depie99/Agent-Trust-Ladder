# Lifecycle reference

Generated from `config/manager-state-contract.json`, consumed directly by `runtime/lib/state.mjs`. These are literal runtime values, separate from the conceptual diagrams.

## How to use the contract

Inspect a task with `atl show T-001` and explain its gate with `atl why T-001`. Use supported runtime operations rather than editing state JSON. Actor authorization alone does not satisfy the listed evidence requirements; inspect their implementation in `state.mjs`.

## Status values

`new`, `triaged`, `assigned`, `in_progress`, `in_review`, `verifying`, `done`, `blocked`, `rejected`, `escalated`, `archived`.

## Transitions

| Transition | Allowed actors | Required gates |
|---|---|---|
| `new->triaged` | `pip` | `objective`, `completion_checks` |
| `new->rejected` | `pip` | No additional requirement in this row |
| `new->archived` | `manager` | No additional requirement in this row |
| `new->blocked` | `pip` | `blocker` |
| `triaged->assigned` | `mira` | `assigned_worker` |
| `triaged->rejected` | `mira` | No additional requirement in this row |
| `triaged->archived` | `manager` | No additional requirement in this row |
| `triaged->blocked` | `mira` | `blocker` |
| `assigned->in_progress` | `rowan`, `pip`, `sage`, `beacon` | No additional requirement in this row |
| `assigned->blocked` | `rowan`, `mira` | `blocker` |
| `assigned->archived` | `manager` | No additional requirement in this row |
| `in_progress->in_review` | `rowan`, `pip`, `sage`, `beacon` | `workspace`, `evidence` |
| `in_progress->blocked` | `rowan` | `blocker` |
| `in_review->verifying` | `sage` | `review_approved` |
| `in_review->in_progress` | `sage` | `review_changes_requested` |
| `in_review->blocked` | `sage` | `blocker` |
| `verifying->done` | `beacon` | `all_checks_pass` |
| `verifying->in_progress` | `beacon` | No additional requirement in this row |
| `verifying->escalated` | `beacon` | `blocker` |
| `blocked->triaged` | `mira`, `pip` | No additional requirement in this row |
| `blocked->archived` | `manager` | No additional requirement in this row |
| `rejected->archived` | `manager` | No additional requirement in this row |
| `escalated->triaged` | `mira` | No additional requirement in this row |
| `escalated->archived` | `manager` | No additional requirement in this row |
| `done->archived` | `manager` | No additional requirement in this row |
| `archived->new` | `manager` | No additional requirement in this row |

The manager's privileged behavior and additional runtime validation must be inspected in the implementation; the table is the serialized transition contract. See [verification](../verification/README.md) for the bounded lifecycle model and its negative control.
