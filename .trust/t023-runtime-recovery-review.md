# T-023 runtime recovery — October 29, 2026

The installed `codex` resolved to GapCode's standalone 0.164.1 executable.
A startup-only comparison reproduced read-only mode with the old sandbox
flag, and workspace-write with the matching named permission profile. The
actual selected executable then passed a sandbox read/write/remove probe.
ATL now shares compatible Windows arguments across Ask ATL and queue workers,
checks GapCode-backed fix access before charging a model session, stops a
read-only startup immediately, and preserves an actionable failure category.
The UI's workspace check now probes the provider selected in Ask ATL.

Dependency preflight found no installed tree or matching receipt. Automatic
offline preparation was disabled; after enabling it, npm identified the exact
missing cached source-map-js@1.2.2 archive. A deliberate locked installation
with lifecycle scripts disabled populated the project cache. Runtime offline
preflight then passed and T-023 was recovered through the manager, preserving
consumed sessions and all review history. Automatic preparation stays offline.

Runtime checks passed: execution_access_test, control_assistant_test,
task_diagnostics_test, worker_test, browser_access_test, ui_review_mcp_test,
control_plane_modal_test, queue_recovery_delivery_test and ui:css:check.
The custom-provider harness keeps its own tool provisioning and acceptance
evidence; the MCP fixture explicitly tests unapproved permissions independently
of the live project's browser default. Scoped git diff --check passed.

T-023 implementation is being performed by actual ATL Rowan/Sage sessions,
not by direct source repair in this chat. Sage rejected source-only language
checks, then confirmed executable defaults, saved Persian preference, toggle
round trips and persistence. Sage subsequently rejected remaining literal
English copy assertions. The next review confirmed that the composed client
had lost verified T-022 bidi behavior. Rowan restored the client helpers,
dynamic wrappers and font/isolation styles, regenerated CSS, and reran the
server, bidi, syntax and CSS checks successfully. Session 12 independently
approved that repair and moved T-023 to verifying. One evidence submission omitted the completion check's
terminal period and was correctly rejected by exact matching; feedback asks
the reviewer to preserve the exact check text. The owner explicitly approved
one further session (total cap 13). Beacon independently passed the server,
bidi and CSS checks, submitted both exact completion checks through scoped
controls, and moved T-023 to done. Durable state confirms review approve,
both checks pass, and 13/13 sessions consumed.

Beacon also recorded an unresolved supplementary coverage limitation:
verification/control_plane_catalog_test.mjs is absent from the composed
workspace, and the parser fixtures import it and fail MODULE_NOT_FOUND.
That coverage is not claimed as passing. The synthetic browser preview is
not integrated T-024 visual acceptance. The run finished waiting for the
integrated delivery stage/browser journey; overall delivery is not ready.

The owner initially approved an exact total cap of 12 sessions. Consumed sessions were
preserved. A concurrent UI increase and additive API request were reconciled
to that exact cap and logged as session_budget_set. After independent review
approval, the owner explicitly approved cap 13 for Beacon; the exact new cap
was logged without resetting consumption. No source was committed,
pushed, merged, or deployed. Remote CI is not observed.
