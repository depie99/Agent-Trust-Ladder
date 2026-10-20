## Why the change

ATL now routes website SEO and content-quality work through a dedicated evidence-based specialist while the digital team records explicit ownership and review boundaries for that work.

## Special things to note

- The new content skill is repository-neutral and deliberately excludes structured-data implementation and technical documentation lifecycle work.
- Mem0 graph memory is not included in this PR; the current JSON state and JSONL feed remain authoritative until a separate memory-provider contract is approved.
- The branch includes the existing working-tree team handoff improvements and the new content-quality changes together.

## Change outline

### New specialist and routing surface

```text
skills/atl-content-quality/
├── SKILL.md                 # audit, targeted copy, and content-plan modes
├── agents/openai.yaml       # discoverable UI metadata
└── references/
    ├── checklist.md         # crawl, page, trust, and findings checks
    └── copy-quality.md      # bounded factual-copy rules

skills/atl/
├── SKILL.md                 # specialist capability description
└── references/
    ├── routing.md           # SEO/content route
    └── skill-catalog.md     # specialist catalog entry
```

### Team ownership and model routing

```diff
 SEO/content task
- shared, implicit context
+ Pip      → audience, goal, queries, evidence, acceptance checks
+ Rowan    → approved content surface and fact ledger
+ Sage     → independent intent, claim, risk, and scope review
+ Beacon   → rendered result, links, metadata, and baseline recheck
```

```text
config/model-routing.json
└── content                 # SEO evidence, metadata, search intent, factual copy

runtime/lib/roles.mjs
└── SPECIALIST_SLOTS
    └── content-quality     # pip → rowan → sage → beacon
```

### Review visibility

```diff
team handoff
- changed files + evidence
+ changed files + evidence + show-me-style structural outline

beacon close-out
- completion claim
+ inspected-output summary + check-by-check evidence
```

### Documentation surface

```text
README.md
docs/skills.html
docs/team-playbook.md
runtime/prompts/{rowan,beacon}.md
```
