# Plan — 007 bounded memory and learning

Spec: approved 2026-10-21 · Dose: Standard

Tasks:

- [ ] T1 Inspect local learning storage, recall, dedupe, bounds, and forget — files: `runtime/lib/learning.mjs`, `runtime/atl-manager.mjs`, `verification/learning_test.mjs` — verify: `node verification/learning_test.mjs` — done when local behavior is observed.
- [ ] T2 Inspect optional Mem0 graph adapter and failure fallback — files: `runtime/lib/memory.mjs`, `config/manager.json`, `config/jev.json` — verify: `node runtime/atl-manager.mjs memory status` — done when disabled and unavailable-provider paths are honest.
- [ ] T3 Verify docs and privacy boundary — files: `README.md`, `USAGE.md`, `docs/jev.md`, `docs/jev.html` — verify: `rg -n "local|Mem0|graph|advisory|optional" ...` — done when users know what is stored and what is not.
