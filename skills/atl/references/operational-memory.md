# Operational memory without a manager

`scripts/operational-memory.mjs` keeps project-local memory in `.atl/memory/`. The Control Plane imports the same module, so a skills-only host and the UI reach the same decisions from the same files.

## Recurring failures become one scoped preventer

```js
import { recordFailure, proposePrevention, authorizePrevention, rollbackPrevention, preventionStatus } from "./scripts/operational-memory.mjs";

recordFailure(root, { blocker: "stale-plan-review", reason: "approved plan became stale at revision 4", task_id: "T-042" });
recordFailure(root, { blocker: "stale-plan-review", reason: "approved plan became stale at revision 6", task_id: "T-043" });
const candidate = proposePrevention(root, { signature_id: failureSignature(...).signature_id, preventer: "fingerprint only declared evidence", rollback: "revert planFingerprint" });
authorizePrevention(root, candidate.candidate_id, { actor: "owner", evidence: { command: "node verification/task_dependency_contract_test.mjs", result: "passed" } });
preventionStatus(root);
```

Rules the helper enforces:

- one recorded failure is an anecdote; a proposal needs at least two occurrences of the same signature;
- a preventer is `proposed` until an acting authority supplies a passing regression command, so a proposal never becomes policy by existing;
- `preventionStatus` reports `before_occurrences` and `after_occurrences` after authorization instead of claiming savings;
- `rollbackPrevention` keeps the history and marks the candidate `rolled-back`.

## Bounded context with provenance

`selectContext(root, { query, budgetChars })` ranks project sources by query overlap (English and Persian, ZWNJ-insensitive), spends a fixed character budget, and returns each item with `source_id`, `revision`, `observed_at`, `valid_until`, `status`, `selected_because`, `truncated` and a `score`. Coverage reports `considered`, `selected`, `omitted`, `stale` and `duplicate_sources`; a query with no match returns `status: "no-evidence"` and `missing_evidence: true` rather than a guess. Expired and not-yet-valid sources are excluded and counted as `stale`.

## Claim state

`claimStates(claims)` returns honest `active`, `conflicted`, `unknown`, `expired` and `superseded` states. Two different values for the same subject **and** predicate from independent sources are `conflicted`; copies of one source corroborate instead of contradicting, and a different predicate on the same subject is not a contradiction. A claim without a source revision stays `unknown`.

## Interrupted writes

Every store update goes through `writeJournaled`, which records `intent`, rewrites the target atomically and records `committed`. `recoverMemory(root)` reports `inconsistent` with the specific interrupted writes, leftover temporary files and corrupt stores, and returns `verified: false`. `selectContext` serves no context from a corrupt store. Partial state never becomes verified knowledge.

## Known limits

Retrieval ranks by term overlap; it is not a semantic embedding model. Verifying a claim still needs the run's own evidence. The helper never treats imported text as instructions and never promotes a proposed lesson on its own.
