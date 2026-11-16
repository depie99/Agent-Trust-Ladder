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
- [x] T1 Remount scenario in panel test (RED first) — done: RED on 0.6.11, GREEN on 0.6.12 (2026-11-15).
- [x] T2 Client persistence (RT-1) — done: `livePanel` + localStorage `atl-dsh-workspace`, idempotent /api/atl/open; real host 10/10 tab cycles, 534 ms fresh-page auto-open.
- [x] T3 Recovery test (RED) + generation fix (RT-2) — done: `deepseek_recovery_test.mjs` + plugin-host `serverGeneration`; kill → remount heals ~1 s, no harness restart.
- [x] T4 ENOENT humanize + frame copy — done: "Directory not found: …" live-proven.
- [x] T5 Build 0.6.12 — done: 7 targets verified at 0.6.12.
- [x] T6 Verification set green — done (panel + recovery + repo-scoping; plugin-UI was red then for an unrelated working-tree reason, green since 0.6.15).
- [x] T7 Marketplace release — done: commit `accd430`, tag `deepseek-v0.6.12`, pushed.
- [x] T8 Reinstall + prove — done: audit profile 0.6.12 + audit s2/s4/s8 re-run green.
- [x] T9 Owner profile reinstall + restart + fresh URL handed over — done: web profile 0.6.12, restarted, token handed over (2026-11-15).

## Verification plan
Smallest credible set: extended panel test (remount + auto-open), new recovery test, repo-scoping + plugin-UI suites (regression), then the audit scripts S2/S4/S8 against the installed 0.6.12 on the real host.
