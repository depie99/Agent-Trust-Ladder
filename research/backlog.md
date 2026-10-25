# ATL Improvement Backlog — research-backed tickets

Proposed by the intelligence pipeline (`research/records/`), owned by the
team. Research proposes; the owner promotes (`atl research promote <id>`);
Pip triages; the runtime enforces the rest. This file is the human-readable
map of where each ticket stands — state.json stays the machine truth.

## P0 — Architectural

- [x] **Shared evidence store with source provenance** — `research/` records
  + `index.json` dedup keys + decision logs + provenance (url, evidence
  level, captured/published dates). Landed 2026-10-22.
- [x] **Per-agent persistent state and crash recovery** — already existed:
  `state.json` is the resumable brain, `recovery.mjs` unblocks/approves,
  tasks carry `last_checkpoint`, `auto_recovery_count`; launch lease
  (`run-lock.json`) in flight from the control-plane wave.
- [x] **Formal verification of task lifecycle invariants** — already
  existed: `verification/atl_manager_lifecycle_model.py` (contract-enforced
  transitions, `--mutation-test`); extended 2026-10-22 with the dependency
  readiness model (`verification/dependencies_model.py`).
- [~] **Dependency-aware multiqueue scheduler** — landed as the read-only
  layer: `runtime/lib/dependencies.mjs` (`depends_on`, readiness, cycle +
  transitive-stuck detection, priority ordering) surfaced via `atl ready`
  and honored by research promotion. Wiring into the launch queue order is
  deferred until the parallel multiqueue wave (queue book v2 + run lease)
  lands, to avoid touching in-flight files.

## P1 — Engineering

- [x] **Transcript ingestion + timestamped source indexing** —
  `atl research transcript <url>`: caption-track fetch, `[mm:ss]` anchored
  markdown + raw cue JSON, linked into the research record. Best-effort by
  design; failures are explicit gaps, never fabricated transcripts.
- [~] **Research inbox + approval queue in the TUI** — CLI inbox now
  (`atl research list --status pending`, `promote`/`reject`); control-room
  screen deferred until the parallel TUI wave (specs 015–017) lands.
- [~] **Automatic retrospectives that generate testable improvements** —
  `atl research retro` scans state history (repeat attempts, blockers,
  escalations) and files pending improvement records with proposed checks.
  Model-driven retrospective synthesis (reading briefs + feed, drafting
  proposals) is a later step.

## P2 — Inspiration

- [~] **Interactive knowledge graph / architecture explorer** — `graph.json`
  export exists (`atl research graph`: records ↔ people ↔ repos ↔ concepts ↔
  tasks). Interactive explorer not started.

## Ground rule

Research creates proposed tickets; it never rewrites ATL skills or code by
itself. Every change passes review, SDD/TDD validation, and explicit
manager approval — that is what `promote` → triage → implementation is for.
