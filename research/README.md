# ATL Research — the engineering-intelligence store

This directory is ATL's cumulative second brain for agent-engineering
research: what we watched, what we found, what we trust, and what it means
for ATL. It is a durable, searchable evidence store — not a news feed.
Everything here is committed, so the evidence index survives across
sessions, machines, and reorganizations.

## Layout

| Path | Purpose |
|---|---|
| `sources.json` | The watchlist: every source the daily brief checks, its type, and its last health result |
| `index.json` | The cumulative evidence index — one entry per record, with dedup keys; rebuilt from `records/` whenever missing |
| `records/R-NNNN.md` | One research record per finding (JSON frontmatter + prose). The files are the truth; the index is a projection |
| `transcripts/` | Downloaded video transcripts (`yt-<id>.md` readable with `[mm:ss]` anchors, `.json` raw cues) |
| `briefs/` | Daily briefs (`YYYY-MM-DD.md`) written by `scripts/intel-brief.mjs` |
| `graph.json` | Light knowledge graph (records ↔ people ↔ repos ↔ concepts ↔ tasks), exported by `atl research graph` |
| `backlog.md` | The research-backed improvement backlog the team is working from |

## Research streams

1. **Lauren Tan** — Benny, Grok Bot, Dune, pstack, agent supervision, high-throughput engineering → team orchestration, autonomous execution, delegation
2. **Matt Pocock** — agent skills, spec-driven workflows, code review, retrospectives, interviews → ATL skills, SDD/TDD, quality gates
3. **Related practitioners** — e.g. @shirosignal and anyone cited by the two above → transferable architecture patterns
4. **YouTube + GitHub** — new videos, transcripts, repositories, releases, skills → technical evidence and implementation references
5. **Second-brain systems** — persistent memory, context retrieval, provenance, learning loops → ATL long-term project knowledge and agent memory

## Record schema (frontmatter)

```json
{
  "id": "R-0001",
  "title": "...",
  "kind": "post | video | interview | release | repo | changelog | announcement | note | retro",
  "priority": "P0 | P1 | P2",
  "status": "pending | approved | promoted | rejected",
  "evidence": "verified | second-hand | speculation",
  "published": "YYYY-MM-DD or null",
  "captured": "ISO timestamp",
  "people": ["poteto", "mattpocock"],
  "concepts": ["formal-verification", "..."],
  "sources": ["canonical url first"],
  "repos": [],
  "atl_impact": "one-line ATL consequence",
  "objective": "what a promoted task would do",
  "checks": ["proposed completion check"],
  "tickets": ["T-005 — filled on promotion"],
  "transcript": "research/transcripts/yt-*.md or null",
  "decisions": [{"at": "...", "actor": "manager", "action": "captured|set|approved|promoted|rejected|transcript", "note": ""}],
  "dedup": ["url:<sha>", "title:<sha>"]
}
```

## Priority rules

- **P0 — Architectural**: delegation, manager/team coordination, queueing,
  recovery, autonomy, persistent memory.
- **P1 — Engineering**: skills, SDD/TDD, review processes, testing,
  observability, context management.
- **P2 — Inspiration**: TUI/UX concepts, experiments, ideas not yet ready
  to implement.

## Honesty rules (evidence levels)

- `verified` — we read the primary source ourselves (official post, release, repo).
- `second-hand` — a trustworthy intermediary (transcript-derived notes, an
  archive mirror) described the primary source; the reference is recorded.
- `speculation` — claim without a checkable source; kept only to know what
  to verify next. Never promote speculation directly.

The pipeline never silently invents content: a source that could not be
fetched is reported as failed in the brief, and transcripts that could not
be downloaded are recorded as gaps instead of approximations.

## The pipeline

1. **Capture** — `scripts/intel-brief.mjs` (daily schedule) checks every
   enabled source, dedupes against `index.json` (canonical URL + title
   keys, tracking params stripped), and files genuinely new items as
   `pending` records.
2. **Assess** — a human (or an agent session acting for one) reads the
   record and sets the evidence level, priority, and ATL impact:
   `atl research set R-0007 --set priority=P0 --set evidence=verified --set atl_impact="..."`
3. **Gate** — research proposes, the owner disposes:
   `atl research promote R-0007` files a real task (idempotent via the
   `research:R-0007` intake key) and announces it on the team feed.
   `atl research reject R-0007 --reason "..."` closes the loop.
   Nothing in this directory edits skills or code by itself.
4. **Index** — every action appends to the record's decision log and the
   cumulative index; briefs accumulate in `briefs/` as a running history.

## CLI

    atl research                       # list (newest first, P0 on top)
    atl research list --status pending # the review inbox
    atl research show R-0001
    atl research add <url> --title "..." --priority P1 --set kind=post --set people=poteto
    atl research set <id> --set priority=P0 --set atl_impact="..."
    atl research approve <id>          # optional lighter gate before promote
    atl research promote <id>          # file the task (the human gate)
    atl research reject <id> --reason "..."
    atl research transcript <youtube-url> [--record R-0003]
    atl research retro                 # scan team history for improvement proposals
    atl research graph                 # rebuild graph.json
    atl research status                # counts + watchlist health
    atl research brief --offline       # re-render today's brief from the index

## Known gaps

- **X (Twitter)**: no authenticated access as @sanazbaghban — monitoring
  uses public mirrors/archives only (marked `second-hand`); bookmarks,
  follows, and DMs are out of reach. Filling this gap needs an authenticated
  X connection the owner has not configured yet.
- **YouTube transcripts**: ingestion is best-effort (caption tracks move,
  some videos have none). Failures are explicit; we never ship a fabricated
  transcript.
- **TUI inbox**: the research review queue is CLI-only right now; a control
  room screen lands with the parallel TUI wave (specs 015–017).
