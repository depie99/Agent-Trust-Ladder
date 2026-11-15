# Plan — 023 dsh panel persistence + recovery
Spec: approved 2026-11-15 — owner instruction: "write the fix spec via atl-plan, then implement → release 0.6.12 → reinstall → re-run the audit scenarios to prove the reset is gone." Codifies audit repair-tasks.md RT-1/RT-2/RT-6 (+ frame copy) from `.atl-evidence\dsh-plugin-audit\`. Dose: Standard.

## Approach (≤10 lines)
dsh unmounts the keyed `main` slot on tab switch; ATL's panel kept everything in component `useState` → cold form every return. Fix: module-level `livePanel` (survives remounts, dies with page load) + `localStorage['atl-dsh-workspace']` (survives reloads). On mount: attach `livePanel` instantly, then validate/heal in the background through the idempotent `POST /api/atl/open`. Server death recovery: plugin-host keeps a monotonically increasing `serverGeneration` (bumped on every fresh control-plane spawn); `/api/atl/open` drops gateways whose generation is stale and issues a new panel id against the newly spawned server. Plus: humanized ENOENT in `projectPath`, and the frame's dead-end copy now says to reopen the project. Automatic workspace opening = the mount-time auto-restore; it only re-attaches UI, never starts workers (embedded-UI contract intact).

## Key decisions
- **Decision**: heal-through-server (always re-POST `/api/atl/open` on mount) instead of blind id attach. **Rationale**: one idempotent code path heals dead generations automatically; local roundtrip is ~50 ms when alive. **Alternatives**: blind attach (fast but flashes a dead frame when server died); panel-liveness probe API (new route, more surface).
- **Decision**: `localStorage` wrapped in try/catch with module-memory fallback. **Rationale**: storage may be unavailable; in-session persistence alone still fixes the owner-reported bug. **Alternative**: cordis service store — unnecessary, module scope already survives remounts.
- **Decision**: generation counter in plugin-host vs probing gateway health per reuse. **Rationale**: counter is one integer, zero network. **Alternative**: health probe — extra request on every open, races.

## Impact
- Change: `plugins/deepseek-client.mjs`, `plugins/deepseek-panel.mjs`, `plugins/deepseek-frame.mjs` (copy), `runtime/lib/plugin-host.mjs` (counter + ENOENT), `verification/deepseek_panel_test.mjs` (remount scenario), `verification/deepseek_recovery_test.mjs` (new), `.codex-plugin/plugin.json` (0.6.12).
- Breakage risk: `runtime/lib/plugin-host.mjs` is shared by all harness bundles — the counter is additive (panel-entry/MCP path untouched). `/api/atl/open` response shape unchanged. These files carry the parallel session's uncommitted 0.6.11 work — edits are layered on top, nothing reverted.
- Data/migrations: none; new localStorage key only; records stay directory-backed; nothing moved or merged.
- Rollout: build 0.6.12 → sync marketplace clone `deepseek/` → tag `deepseek-v0.6.12` → push → reinstall audit + owner profiles → restart harnesses. Rollback: reinstall previous tag / revert the five source files.

## Pre-mortem
1. localStorage throws (restricted context) → detection: audit S2 re-run + panel test; behavior degrades to module memory → rollback: revert client file.
2. Generation check breaks the alive-server dedupe (open spawns unnecessarily) → detection: `deepseek_panel_test.mjs` open flow + recovery test both exercise open; server count observable via children. Rollback: revert two files.
3. Marketplace sync drift (stale hashed files) → detection: `verifyPluginRelease` inside the build + release json hashes vs synced bytes. Rollback: re-sync from dist dir.

## Constitution compliance
Discovery done from working tree (in-flight 0.6.11 files preserved, layered on top). No hidden failures: remount test is red before the fix (observed). Evidence commands are the repo's own verifiers. Owner approval recorded above; no irreversible action without the stated release step.

## Tasks
- [ ] T1 Remount scenario in panel test (RED first) — files: `verification/deepseek_panel_test.mjs` — verify: `node verification/deepseek_panel_test.mjs ../atl-marketplace/deepseek` — done when: existing assertions still pass and the new remount assertion FAILS on the 0.6.11 bundle (form reappears).
- [ ] T2 Client persistence (RT-1) — files: `plugins/deepseek-client.mjs` — verify: same command after rebuild — done when: remount shows the same panel without the form; fresh page auto-opens the remembered workspace.
- [ ] T3 Recovery test (RED) + generation fix (RT-2) — files: `verification/deepseek_recovery_test.mjs` (new), `runtime/lib/plugin-host.mjs`, `plugins/deepseek-panel.mjs` — verify: `node verification/deepseek_recovery_test.mjs ../atl-marketplace/deepseek` — done when: kill child server → remount → new panel id, tasks visible, no harness restart.
- [ ] T4 ENOENT humanize + frame copy — files: `runtime/lib/plugin-host.mjs`, `plugins/deepseek-frame.mjs` — verify: panel test invalid-dir assertion shows "Directory not found:" — done when: alert text matches.
- [ ] T5 Build 0.6.12 — files: `.codex-plugin/plugin.json` — verify: `npm run plugins:build` with fresh `--out` (verifyPluginRelease runs in-build) — done when: all 7 targets verified at 0.6.12.
- [ ] T6 Verification set green against the new build — verify: `node verification/deepseek_panel_test.mjs <dist>/deepseek && node verification/deepseek_recovery_test.mjs <dist>/deepseek && node verification/plan_repository_scoping_test.mjs && node verification/control_plane_plugin_ui_test.mjs` — done when: all exit 0.
- [ ] T7 Marketplace release — files: `${PROJECTS}\atl-marketplace` (deepseek/, README) — verify: hash-compare dist deepseek vs clone; `git tag deepseek-v0.6.12` — done when: pushed commit + tag.
- [ ] T8 Reinstall + prove — audit profile reinstall, harness restart, re-run audit s2/s4/s8 — done when: S2 shows NO form on tab return; S8 recovers without restart.
- [ ] T9 Owner profile reinstall + restart + fresh URL handed over.

## Verification plan
Smallest credible set: extended panel test (remount + auto-open), new recovery test, repo-scoping + plugin-UI suites (regression), then the audit scripts S2/S4/S8 against the installed 0.6.12 on the real host.
