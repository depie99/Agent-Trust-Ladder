# Spec — 007 bounded memory and learning

Status: approved by explicit implementation request · 2026-10-21

## Behavior

1. Local learning is always available, deterministic, bounded, inspectable,
   and advisory.
2. Explicit preferences, style, prompt, lesson, and verified outcome entries
   can be stored, recalled, deduplicated, and forgotten.
3. Mem0 graph memory is opt-in. Missing package, credentials, network, or graph
   configuration never blocks the deterministic ATL route.
4. Memory is scoped to the project and agent/run metadata; it cannot change
   policy, authority, lifecycle state, or evidence requirements.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| Mem0 is disabled | ATL routes a task | no network/model memory call occurs |
| A local style lesson exists | triage recalls matching context | it is shown as advisory context |
| Mem0 is enabled but unavailable | recall/remember runs | ATL continues with local behavior and reports the provider error |
| Duplicate lesson is recorded | remember runs again | occurrence count increases instead of unbounded duplication |

## Out of scope

Automatic inference of sensitive personal data, policy mutation from memory,
and unbounded conversation replay.
