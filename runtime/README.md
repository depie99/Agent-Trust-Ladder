# atl-manager — the runtime that keeps the team alive

Mira, Pip, Rowan, Sage, and Beacon are not prompts; they are roles over one
persistent state machine. This runner owns the state and enforces the role
contracts. When a session dies, the next one resumes from
`.trust/manager/state.json` — that is what makes the team a bot instead of a
prompt.

Policy lives in the skills (`skills/atl-team`, `config/model-routing.json`).
Runtime lives here. Both are enforced: the runner rejects any action outside
the actor's contract.

## Install anywhere (any terminal, any agent CLI)

Requires Node 18+. From a clone of this repo:

```bat
scripts\install-atl.cmd          :: Windows
./scripts/install-atl.sh         :: macOS / Linux
```

This copies the runtime to `~/.atl`, puts an **`atl`** command on your PATH
(`--no-path` to skip, `ATL_HOME=<dir>` to relocate), and ships paste-ready
role prompts to `~/.atl/prompts`. Re-run the same command to update.
Uninstall: delete `~/.atl` and drop it from your PATH.

The CLI manages **the project you run it in** (like git): state, config, and
workspaces live in `<project>/.trust/manager` and `<project>/config`.
Override the project with the `ATL_PROJECT` environment variable.

## Use with ZCode, Claude Code, Codex CLI, Grok CLI, or any agent

The bots are not bound to one harness. `atl` is a plain CLI state machine;
an agent session plays a role by adopting its contract and acting only
through the runner:

1. In your project: `atl init`, then feed intake (inbox files, or wire
   GitHub/Azure in `config/manager.json`).
2. Open one or more agent sessions in the project (same terminal tools you
   already use) and paste the matching prompt from `~/.atl/prompts`:
   `mira.md` coordinates, `pip.md` triages, `rowan.md` builds, `sage.md`
   reviews, `beacon.md` verifies. The installer also wires these as native
   slash commands where the harness supports it — **Codex CLI**
   (`~/.codex/prompts` → `/atl-mira`, `/atl-pip`, ...) and **Claude Code**
   (`~/.claude/commands` → `/atl-mira`, ...) are auto-detected.
3. Each session loads its contract with `atl role <name>` and records every
   action with `--actor <name>`. The runner enforces the contract regardless
   of which agent is behind it — a Grok session and a Claude session that
   adopt the same role are interchangeable.
4. Watch them work: `atl feed --roster`.

Tip: add one line to your `AGENTS.md` / `CLAUDE.md` —
"This project uses the ATL team: run `atl wake` and follow the role prompts."
You can also run the team yourself with no agent at all; every command takes
`--actor` and tells you who is allowed to do what.

## Layout

```
runtime/atl-manager.mjs        CLI entry (Node 22+, zero dependencies)
runtime/lib/state.mjs          state store + transition table (who may do what)
runtime/lib/roles.mjs          role contracts (mission / may / must-not / handoff)
runtime/lib/intake.mjs         adapters: file inbox, GitHub issues, Azure Boards
runtime/lib/workspace.mjs      isolated worktree/clone per task
runtime/lib/render.mjs         manager brief, task views, wake actions
.trust/manager/state.json      THE state — the whole brain
.trust/manager/inbox/*.md      local bullet-file intake
.trust/manager/briefs/         saved manager briefs
.trust/manager/workspaces/     per-task worktrees/clones (gitignored)
config/manager.json            intake sources, budgets, workspace config
```

## Quickstart

```bat
atl init
:: drop a markdown file with "## Task title" headings into .trust\manager\inbox\
atl intake
atl triage T-001          :: what Pip reads
atl wake                  :: what Mira does next
atl brief --save          :: the manager brief
atl feed --roster         :: the team chat
```

(From a repo clone without installing, use `node runtime\atl-manager.mjs`
instead of `atl`.)

## The lifecycle

```
new -> triaged -> assigned -> in_progress -> in_review -> verifying -> done
                \-> rejected                    \-> in_progress (changes)
   blocked / escalated hang off every active state and return to triaged
```

Who may move what (enforced; the human `--actor manager` may always override):

| transition | actor | requires |
|---|---|---|
| new -> triaged | pip | objective + at least one completion check |
| triaged -> assigned | mira | a worker (`--to`) |
| assigned -> in_progress | the worker | — (increments attempt budget) |
| in_progress -> in_review | the worker | workspace + at least one observed check |
| in_review -> verifying | sage | an approved review in evidence |
| in_review -> in_progress | sage | changes-requested review |
| verifying -> done | beacon | every completion check has passing evidence |
| verifying -> in_progress | beacon | honest verification failure |
| any -> blocked / escalated | any with `--reason` | a reason; optional `--wake-in 8h` retry timer |

## Roles

`node runtime\atl-manager.mjs role <name>` prints the full contract a session
adopts before acting. Summary:

- **Mira** — assigns triaged tasks, unblocks, escalates, briefs. Never codes.
- **Pip** — turns intake into objective + observable checks + priority/risk. Never assigns.
- **Rowan** — builds only inside the task workspace, records evidence, checkpoints. Never self-certifies.
- **Sage** — reviews the diff + evidence independently. Never implements.
- **Beacon** — verifies finish conditions, watches timers and stale work, preserves memory. Never builds.

**Show the work.** Handoffs and close-outs speak `show-me` (humanlayer/skills): diff-shaped change views, shallow file trees, component or call trees — the smallest view that shows what changed, written from real inspection of the rendered output, never from the builder's description. PR preparation (only when a task contract allows it) follows `visual-pr`, with manager approval before anything is published. Both skills install via `npx skills add humanlayer/skills --skill show-me visual-pr`; without them, follow the same conventions from the prompts.

## Intake sources

**Local bullet files (default, works offline).** Markdown files in
`.trust/manager/inbox/`:

```markdown
## Fix login redirect loop
@source: <issue or ticket url>
@priority: high
@risk: risky
Checks:
- observable check one
- observable check two
```

A plain `- [ ] thing to do` line also becomes a task. `intake` is idempotent —
tasks are deduped by source key, so re-running never duplicates.

**GitHub issues.** In `config/manager.json` set `intake.github.enabled: true`
and list repos (`owner/name`). Public repos work unauthenticated; private
repos need `gh auth login` or `GITHUB_TOKEN`.

**Azure Boards (self-hosted Azure DevOps Server works).** Set
`intake.azure.enabled: true`, provide a PAT with *Work Items: Read* in the
`AZDO_PAT` environment variable, and set `iteration_path` to the sprint
(e.g. `Middleware-and-Portals\Sprint 73`). The adapter queries the iteration
by WIQL and pulls title/state/type/priority/assigned-to.

## Workspaces

`workspace <task-id>` gives the task an isolated home:

- if `config/manager.json` maps the repo to a local clone path → a **git worktree** branch `atl/<task-id>`;
- else if the source is a GitHub repo → a shallow **clone**;
- else → a scratch directory for doc/planning tasks.

Workers never touch any active checkout. `.trust/manager/workspaces/` is
gitignored and disposable.

## The team feed (the group chat)

Every runner command posts a message to the feed in the acting bot's name:
Pip announces grabs and triage verdicts, Mira announces routing ("kicking
rowan"), Rowan claims with a **Running** card, Sage posts review verdicts,
Beacon closes with a **Done** card. Cards carry the task id, status, and
workspace path. `state.json` is the machine's memory; `feed.jsonl` is the
team's voice.

```bat
node runtime\atl-manager.mjs feed --roster      :: roster + full transcript
node runtime\atl-manager.mjs feed --task T-004  :: one task's thread
```

## Routines (declared routing policy)

Routines are Mira's routing decisions declared in advance. They apply at
intake, so incoming work routes itself the same way every time:

```json
"routines": [
  { "name": "bugs-to-rowan",
    "when": { "source": "github", "label": "bug" },
    "then": { "priority": "high", "assign_to": "rowan" } }
]
```

`when` supports `source`, `keyword` (title/body match), `label`, and `type`
(Azure work item type). `then` supports `priority`, `risk` (risky implies
review), and `assign_to`. A routine with `assign_to` pre-routes the task:
the moment Pip completes triage, the runner kicks the worker as Mira.
`node runtime\atl-manager.mjs routines` lists what is configured.

## Wake loop and night watch

`wake` is the tick. It reads state and tells Mira what to do next: untriaged
arrivals, unassigned triaged work, missing workspaces, stale checkpoints
(`budgets.stale_after_hours`), exhausted attempt budgets, blocked tasks whose
retry timer is due, and escalations that need the human.

For an unattended run, write the contract before it starts (from
`skills/atl-team`):

```text
Objective:
Complete when:
Allowed actions:
Forbidden actions:
Workspace / branch:
Checks and evidence:
Wake / revisit condition:
Stop and escalate when:
Morning report location:
```

Beacon's night shift is: run `wake`, act only inside its contract, save
`brief --save`, and leave blockers honest. The runtime does not need to run
all night — it needs to resume truthfully whenever it wakes.

## Reset

Delete `.trust/manager/state.json` (and workspaces if you want) and run
`init` again. Briefs and run records are history; keep or delete freely.
