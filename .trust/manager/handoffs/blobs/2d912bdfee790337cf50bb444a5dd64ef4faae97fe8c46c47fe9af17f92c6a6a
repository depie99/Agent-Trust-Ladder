# ATL case studies

These examples calibrate ATL's evidence gates. They are not repository-specific implementation instructions.

## Deployment and authentication boundary

The retrospective sequence aligned base-path and SSO callback routing, added deployed SSO contract verification, changed production build mode and real authentication, then changed pipeline packaging to flatten `dist` before that packaging change was merged and reverted. The final repository state retained real production authentication and the earlier packaging contract, but history did not prove end-to-end validation of the deployed runtime.

The reusable lesson is that a passing typecheck or build was insufficient because three contracts crossed the boundary: bundled configuration, artifact layout, and deployed SSO routing. The evidence ledger should require:

- `bun run build` and the deployment-verification script to prove bundle-level contracts;
- pipeline inspection to prove how artifacts are copied;
- the deployment consumer to prove whether nested or flattened `dist` is correct;
- a real deployed SSO callback to prove runtime validity.

Without the last two observations, the verdict is conditionally valid, not complete. A revert records unresolved disagreement between the packaging contract and its consumer; it does not by itself establish which layout is correct.

## Active-seller cross-layer boundary

Earlier map and address-book fixes addressed UI state and map-center behavior. The frontend eventually sent `seller_id`, while the backend route still expected `seller_stock_location_link_id`; the existing workflow therefore could not persist the selection and the UI reverted to the previous store. The final fix traced the complete contract, resolved `seller_id` through the query graph, preserved the old payload format, and reused the existing workflow. It was merged, but validation was limited to a TypeScript check, leaving the seller-ID path and missing-link failure without regression-test evidence.

ATL should require a come-and-go timeline, a producer-to-user-visible-result trace, and a compatibility matrix: `seller_id` resolves to the canonical seller-location link; existing `seller_stock_location_link_id` callers continue to work; unknown sellers return not-found; missing or malformed identifiers fail validation; successful selection updates persisted active-seller state; and the frontend remains on the selected store. A static check supports implementation confidence but does not prove behavioral correctness.
