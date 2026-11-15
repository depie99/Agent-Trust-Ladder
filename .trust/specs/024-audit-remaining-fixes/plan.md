# Plan — 024 audit remaining fixes (RTL verify, snapshot delta, providers home, themed errors, draft survival, workspace chips)
Spec: approved 2026-11-15 — owner instruction: "fix every findings, and continue phases and plan non stop." Covers audit findings ISSUE-03/04/05/08/09/11/12 + the draft residual from the 0.6.12 release. Dose: Standard.

## Approach and key decisions
- **RT-5 snapshot delta (ISSUE-03)** — server-side only: build the snapshot once per tick (was: once per stream per tick), cache the serialized frame, and push to streams only when the JSON actually changed. `/api/events` reconnects carrying `cursor > 0` get a tiny `event: unchanged` block instead of a full snapshot; fresh clients and content-drift cases get the full frame. Client already sends `cursor=` and ignores unknown named events — zero client change. Decision: full-string compare per tick (one build + one compare per 2 s, no wire bytes when idle). Alternatives: ETag headers (needs client rework), delta feed (large surface).
- **RT-4 fa RTL (ISSUE-05)** — audit follow-up: the source already sets `documentElement.dir` + `atl-rtl` class; the audit seeded the wrong locale value (`fa` instead of `fa-IR`). Action: re-verify with the exact value; fix only if genuinely broken.
- **RT-7 providers home (ISSUE-09)** — `userProviders.registryPath()` joins `os.homedir()/.atl` unconditionally; use `ATL_HOME` first, mirroring `supervisor.mjs`.
- **RT-8 themed failure frame (ISSUE-11)** — deepseek-frame catch renders a padded, theme-aware message instead of a bare dark body.
- **Draft survival (residual)** — new-task modal persists its fields to `sessionStorage['atl-task-draft']` on input and restores them when the form reopens; cleared on successful save.
- **RT-3 chips (ISSUE-04 remainder)** — the project form lists remembered workspaces (max 5, most recent first); one click opens.
- **ISSUE-08/ISSUE-12** — re-verify only (toggle write exists at client:2251; keyboard order is dsh-shell scope).

## Impact
`runtime/lib/control-plane-server.mjs` (timer + events handler), `runtime/lib/userProviders.mjs` (registry path), `plugins/deepseek-frame.mjs` (themed catch), `plugins/deepseek-client.mjs` (chips), `runtime/control-plane-client.js` (taskForm draft + save clears it). New verifiers: `verification/snapshot_delta_test.mjs`, `verification/providers_home_test.mjs`. Breakage risk: every SSE consumer (desktop browser, plugin shim) — covered by reload/plugin-UI suites plus a new delta test. No data migration; new sessionStorage/localStorage keys only.

## Pre-mortem
1. Reconnecting client stuck on `unchanged` after a change that did not grow the log → detection: delta test mutates state without asserting log growth → mitigation: `forceFullNextConnect` flag on any content change → rollback: revert handler block.
2. Registry path change surprises existing installs whose providers live in `~/.atl` → `ATL_HOME` is unset on normal machines → identical path → rollback: revert one function.
3. Draft restore overwrites an edit-in-progress → restore only runs on form open for NEW tasks, never after → rollback: revert taskForm block.

## Constitution compliance
Same evidence rules as 023; owner pre-authorized the non-stop chain; verifiers are the repo's own plus two new standalone node tests.

## Tasks
- [ ] T1 snapshot delta (server) — files: `runtime/lib/control-plane-server.mjs` — verify: `node verification/snapshot_delta_test.mjs` — done when: idle reconnect poll < 5 KB, change poll returns full snapshot.
- [ ] T2 providers home parity — files: `runtime/lib/userProviders.mjs` — verify: `node verification/providers_home_test.mjs` — done when: pinned ATL_HOME registry is separate from ~/.atl.
- [ ] T3 themed failure frame — files: `plugins/deepseek-frame.mjs` — verify: panel suite still green (visual via failure shot).
- [ ] T4 draft survival — files: `runtime/control-plane-client.js` — verify: extended `deepseek_panel_test.mjs` draft scenario — done when: draft text survives remount + reopen.
- [ ] T5 workspace chips — files: `plugins/deepseek-client.mjs` — verify: extended panel test chip scenario — done when: chip click opens the remembered workspace.
- [ ] T6 fa RTL re-verify with exact `fa-IR` seed — verify: audit v2 script RTL check — done when: `dir=rtl` in the embedded frame (or a genuine bug filed if broken).
- [ ] T7 build 0.6.13 + full verification set + release + reinstall + audit v2.

## Verification plan
New delta + providers tests, extended panel test (draft + chips), existing 6-suite set, then audit v2 on the real host (RTL, perf bytes on the 1000-task fixture, keyboard count, lang toggle, chips, draft, recovery).
