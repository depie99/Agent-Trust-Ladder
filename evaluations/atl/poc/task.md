# Implementation PoC contract

Implement three independent dependency-free ES modules. This is a development
fixture, not a real application or an external benchmark. Each participant gets
the same contract and writes in its own directory. Do not read another run or
the evaluator. No network or external service is needed.

1. `selection.mjs` exports async `resolveSelection(input, stores, persist)`.
   Input has exactly one nonempty string `sellerId` or `storeId`; supplying both
   is ambiguous and rejects. `stores` is an array of `{id, sellerId}`. Resolve
   new seller IDs and legacy store IDs to a unique store. Missing, malformed,
   duplicate matches reject. Call async `persist(store.id)` once after validation,
   await it, and return `{storeId: store.id, sellerId: store.sellerId}` only on
   success. Propagate persistence failure. Preserve all caller inputs. Ignore
   unrelated input fields. Malformed input includes null, arrays, and nonobjects;
   present-but-invalid ID fields reject even when the other field is valid.
2. `pagination.mjs` exports `paginate(items, {page, pageSize})`. Items must be an
   array; page and pageSize are required positive safe integers (no coercion).
   Return `{items, page, pageSize, total, totalPages}` with a fresh sliced array,
   ceil(total/pageSize) pages, zero pages for empty input, and an empty slice for
   out-of-range page. Do not mutate the array/options. Reject unsafe computed
   offsets so arithmetic cannot silently lose precision.
3. `evidence.mjs` exports `summarizeChecks(checks)`. Checks is an array of
   `{name, required, status}`; name is a nonempty string, required is boolean,
   status is `passed|failed|skipped|unknown`. Reject malformed checks and duplicate
   names. Return `{verdict, skipped, unknown}`, with skipped/unknown name arrays
   preserving order. Verdict `failed` if any check failed, including optional;
   otherwise `complete` only if at least one check is required and every required
   check passed; otherwise `conditional`. Optional skipped/unknown checks remain
   visible but do not prevent complete when required checks all passed.

Participants may run their own meaningful checks. Report exactly what ran;
do not claim evaluator results. Keep changes to your assigned run directory.
