# Plan — 008 low-token Jev routing

Spec: approved 2026-10-21 · Dose: Standard

Tasks:

- [ ] T1 Verify compact payload and optional config — files: `runtime/lib/jev.mjs`, `config/jev.json` — verify: `node verification/jev_router_test.mjs` — done when payload and disabled paths are observed.
- [ ] T2 Verify deterministic fallback and manager integration — files: `runtime/lib/skill-router.mjs`, `runtime/atl-manager.mjs` — verify: `node runtime/atl-manager.mjs route T-003 --smart` — done when fallback is explicit.
- [ ] T3 Verify user guidance and token boundary — files: `docs/jev.md`, `docs/jev.html`, `README.md` — verify: `rg -n "--smart|TYPESAFE_API_KEY|fallback|token" ...` — done when the default remains no-model.
