# atl-manager — the runtime that keeps the team alive

Mira, Pip, Rowan, Sage, and Beacon are not prompts; they are roles over one
persistent state machine. This runner owns the state and enforces the role
contracts. When a session dies, the next one resumes from
`.trust/manager/state.json` — that is what makes the team a bot instead of a
prompt.

Policy lives in the skills (`skills/atl-team`, `config/model-routing.json`).
Runtime lives here. Both are enforced: the runner rejects any action outside
the actor's contract.

## Install once, use in each project

Requires Node 18+. Clone this repository somewhere you keep tools, not inside
the application you want ATL to manage. For example, on Windows:

```bat
mkdir D:\tools
cd D:\tools
git clone https://github.com/depie99/Agent-Trust-Ladder.git
cd Agent-Trust-Ladder
scripts\install-atl.cmd          :: Windows
./scripts/install-atl.sh         :: macOS / Linux
```

The installer copies the runtime and skills to the per-user install directory
`%USERPROFILE%\.atl` on Windows or `~/.atl` on macOS/Linux. It creates the
`atl` command there and adds that directory to your user PATH. It also copies
role prompts to `%USERPROFILE%\.codex\prompts` and/or
`%USERPROFILE%\.claude\commands` when those harness directories already exist.
Open a **new terminal** after installation so the PATH change is visible.

The clone is only the installer source. The project you manage does not need
to contain this repository, `runtime/`, `skills/`, or any third-party skill
directory. Re-run the installer from the clone to update the user install.
Use `--no-path` to manage PATH yourself, or set `ATL_HOME=<dir>` to choose a
different user install directory. Uninstall by removing that install
directory, the copied role prompt files, and its PATH entry.

The CLI manages **the project you run it in** (like git): state, config, and
workspaces live in `<project>/.trust/manager` and `<project>/config`.
Override the project with the `ATL_PROJECT` environment variable.

There are two separate things to install:

| Need | Install | Where it lives |
|---|---|---|
| ATL skills such as `$atl` in an agent | `npx skills add depie99/Agent-Trust-Ladder --all` | Your agent's skill directory, global or project-local |
| The named team runtime and `atl` command | Clone once, then run `scripts\\install-atl.cmd` or `install-atl.sh` | User install (`~/.atl`), with state created per target project |

The npm package is an additional distribution boundary, not a second project
state directory. If your registry has `@depie99/atl`, install it there and
still run `atl init` inside every target project. If the package is not
available or authenticated in your registry, use the clone installer above.

## Use with ZCode, Claude Code, Codex CLI, Grok CLI, or any agent

The bots are not bound to one harness. `atl` is a plain CLI state machine;
an agent session plays a role by adopting its contract and acting only
through the runner:

1. Open a terminal in the **target project**, not the ATL clone, and run
   `atl init`. This creates the project's `.atl/project.json`,
   `.trust/manager/`, `config/manager.json`, inbox, briefs, and workspace
   directories. Run this once per project.
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
4. Watch them work: `atl dashboard`. Check `atl feed --roster`, `atl show`,
   `atl wake`, and `atl brief --save` when you want the text owner view.

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
runtime/lib/dashboard.mjs      terminal control room: portfolio, composer, import,
                               packet review, queue, launch preview, sessions
runtime/lib/composer.mjs       deterministic compose/import → canonical tasks + drafts
runtime/lib/providers.mjs      provider discovery + per-role provider profiles
runtime/lib/queue.mjs          persistent execution queue (queue.json)
runtime/lib/launch.mjs         launch plan + the only code that starts provider processes
.trust/manager/state.json      THE state — the whole brain
.trust/manager/inbox/*.md      local bullet-file intake
.trust/manager/drafts/         immutable verbatim drafts from the composer
.trust/manager/queue.json      execution queue membership (auditable, removable)
.trust/manager/briefs/         saved manager briefs
.trust/manager/workspaces/     per-task worktrees/clones (gitignored)
config/manager.json            intake sources, budgets, providers, workspace config
```

## Quickstart

```bat
cd path\to\your-project
atl init
:: describe work in plain language (draft + new candidate, idempotent) ...
atl compose --title "Fix the login redirect" --check "signed-in user lands on /dashboard"
:: ... or drop a markdown file with "## Task title" headings into .trust\manager\inbox\ and:
atl intake
atl show                  :: find the new task id, for example T-001
atl triage T-001          :: print Pip's bounded task packet
atl wake                  :: see the next action by role
atl brief --save          :: save the owner/manager brief
atl feed --roster         :: see the team roster and event feed
atl ui                    :: open the control room: create, edit, queue, preview, run
```

(From a repo clone without installing, use `node runtime\atl-manager.mjs`
instead of `atl`.)

### The dashboard

`atl dashboard` is the human-facing view for a busy run. It reads the
authoritative state and feed, then presents the portfolio counts, lifecycle
graph, task list, selected-task contract, completion checks, blockers, next
moves, and live team narration in one screen. Press `Enter` on a task to read
its source file (the composer's draft, the inbox file, or the source URL).

In the interactive view, the focused task is highlighted and the panel header
shows its position. Controls: `↑↓`, `j/k`, or `Tab` move focus, `1..9` jump to
a task, `c` create, `e`/`v` edit/review, `x` add or remove the focused task
from the queue, `u` recover a blocked task, `l` open the launch gate,
`Enter`/`y` confirm the queued run, `r` force a refresh, `f` open the full
feed, `Q` the execution queue with live gate states, `L` the merged logs
stream, `PgUp`/`PgDn` or the mouse wheel scroll the feed, `?` help, `Esc`
back, and `q` quit. A blocked task explains its recovery route in the
selected-task panel: `u` returns it to `assigned` when a worker is known
(otherwise `triaged`), then `x` queues it and `l` previews the run.
Queued tasks carry a `⌁` badge — queue membership is a stored decision, never
just focus. Run `atl dashboard`
(or `atl ui`) for this keyboard view. Use `atl dashboard --once --plain` in
logs, CI, or a redirected terminal for a deterministic, non-interactive
snapshot; that mode does not advertise selection controls. The `ui` command
is an alias.

The room is live: state.json and feed.jsonl are re-read about every two
seconds (every second while a run is active), and the header shows the sync
age (`● LIVE · synced 3s ago`) so stale data is visible instead of silent.
Only changed frames are repainted, and open text editors are never
interrupted.

### The control room: compose, review, queue, preview, launch

Spec 014 turns the dashboard into the room where work starts — while keeping
`state.json` authoritative and requiring an explicit confirmation before a run:

- `c` **compose** — choose the intended outcome and surface, type the task in
  plain language, then inspect the generated ATL packet before committing it.
  Your verbatim wording is saved as an immutable draft under
  `.trust/manager/drafts/`, and a `new` candidate is created through the same
  canonical task model intake uses. Composing identical text twice never
  creates a second task.
- `i` **import** — read-only candidates from the file inbox, GitHub issues, or
  Azure Boards, deduplicated by source key. Nothing is ever written back to
  the source system.
- `v` **review** — inspect and edit the canonical packet: objective,
  completion checks, priority, risk, and the deterministic skill route.
  `T` approves the packet to `triaged` as a manager override; the state
  contract still refuses it without an objective and at least one check.
- `x` **queue** — the persistent execution queue (`.trust/manager/queue.json`).
  Membership is explicit, auditable, and separate from keyboard focus.
- `u` **recover blocked work** — clears an explicit blocker and returns the
  task through the audited `blocked → triaged → assigned` path when a worker
  is already known. It never launches a worker by itself. The CLI equivalent
  is `atl unblock T-001`; if no worker is known, assign one after it returns
  to triage.
- `l` **launch preview** — the exact plan for the queued tasks: role, provider,
  auth mode, workspace, budgets, containment rules, and per-task blockers.
  Press `Enter` or `y` on that screen to confirm the bounded queue run; `Esc`
  backs out without starting anything.
- `p` **providers** — your API providers from `~/.atl/providers.json` (keys
  masked, the project default marked), the built-in `codex`/`claude`
  executables, and the per-role mapping from `providers.use` /
  `providers.by_role` in `config/manager.json` (for example
  `"by_role": { "sage": "claude" }`). `a` opens the add-provider form
  (template → name → CLI → base URL → pasted key → model), `u` makes the
  highlighted provider this project's default, `d` deletes it.
  Additional CLIs and model profiles are declared in `providers.catalog`; ATL
  passes the same role prompt to their configured command and arguments.
- `s` **sessions** — the provider session logs under
  `.trust/manager/overnight/<task>/`; `Enter` opens one at the latest output
  (Home/End jump to the top/tail).
- `Q` **execution queue** — every queued task with its live gate state, role,
  provider, and model; `d` removes the highlighted task, `l` continues to the
  launch preview. The plan rebuilds itself while the screen is open.
- `L` **logs** — one chronological stream of everything the room did:
  `state.json` decisions (transitions, evidence, worker start/exit, marked ⚙)
  merged with `feed.jsonl` narration. It follows the latest entry by default
  (`End` re-follows, `F` toggles), scrolls back through history, and is
  reachable from any screen — including mid-run — with `Esc` returning to
  where you were.

The run screen intentionally does not stream the provider's raw prompt or
model transcript into your terminal. It shows the bounded run's state instead:
total elapsed time, the current task with session `n/max` and its elapsed
time, the phase, a QUEUE PROGRESS line per queued task (queued · running ·
done · at gate · blocked · failed · skipped, with exit codes and reasons),
and a short live tail of the active session log so the operator can see the
provider working without leaving the run. `L` opens the full logs stream; the
complete transcript remains available through `s` or `atl feed`.

The CLI mirrors every screen:

```bat
atl compose --title "..." "<body text>" [--check "..."] ...
atl queue add T-001 | remove T-001 | list | clear
atl launch --dry-run      :: preview the queued run, no agent starts
atl launch --confirm      :: run the queue: strictly sequential, one shared
                           :: time/session budget, per-role providers
atl providers             :: your API providers (keys masked) + built-ins + per-role mapping
atl provider templates    :: endpoint presets: zai, bigmodel, custom
atl provider add zai --key <glm-key> --model glm-4.6
atl provider use zai      :: project default (or: --role rowan for one role)
atl provider key zai --key <new-key>
atl provider remove zai
atl provider models --provider codex
atl provider set --provider codex --model gpt-5.6-luna
atl provider set --role rowan --provider claude --model glm-4.6
atl provider clear --role rowan
```

### Connect an API provider in one minute (GLM via Z.ai and friends)

The usual way to point the team at a hosted model is a tangle of environment
variables and config files. ATL replaces that with a per-machine provider
registry at `~/.atl/providers.json` — a name, the worker CLI that runs it
(`claude` for Anthropic-compatible endpoints, `codex` for OpenAI-compatible
ones), the base URL, the API key, and a default model. Keys never live in a
repository or in `.trust/` state; they are masked in every listing and
injected into the worker's environment only at spawn time.

```bat
atl provider add zai --key <your-glm-api-key> --model glm-4.6
atl provider use zai                    :: every role in this project
atl provider use zai --role rowan       :: or just one role
atl run T-004 --worker zai --confirm    :: or just one run
```

The `zai` and `bigmodel` templates prefill the Anthropic-compatible and
OpenAI-compatible endpoints; `--worker codex` switches to the coding endpoint,
and a managed `CODEX_HOME` (`~/.atl/codex/<id>/`) carries the provider config
so your real `~/.codex/config.toml` is never touched. In the control room the
same flow is a form: press `p`, then `a`, pick a template, paste the key,
enter the model, `u` to make it the project default.

Because a stored provider is api-key auth by definition, selecting it flips
the session to `auth api` automatically — the subscription environment
stripper stands down and the launch preview shows the resolved provider:

```
provider: claude   model: glm-4.6   auth: api  (user provider "zai")
```

### Connect another CLI or model (catalog)

ATL does not assume that every model has its own native adapter. A catalog
entry names the executable, optional model label, and the exact arguments that
your local tool expects. The ATL prompt is always sent on stdin; use `-` in
the argument list when the CLI uses that convention. Braced values are
expanded before launch: `{root}`, `{workspace}`, `{role}`, `{task_id}`,
`{auth}`, `{model}`, and `{prompt}`. If the CLI requires a prompt flag instead of
stdin, add `"prompt_arg": "--prompt={prompt}"`; otherwise include `"-"` in
`args` to keep the prompt on stdin.

The selected provider and model are visible in `atl providers`, `atl queue
list`, `atl launch --dry-run`, and the control-room provider/launch screens.
For Codex, a project without an explicit model reads the current non-secret
`model` value from the local Codex config (currently `gpt-5.6-luna` in this
environment). `atl provider set` pins the choice in `config/manager.json` and
the launcher passes it explicitly, so a run cannot silently switch models.
Use `--model` on `run`, `overnight`, or `launch` for a one-run override.

Provider selection is separate from ATL roles: `rowan` is still the coding
role, but you can assign it to Codex, Claude, ZCode/GLM, or another configured
CLI. `atl provider models` lists the Codex model cache when available; custom
providers should list the exact IDs accepted by their own installation.

For a GLM profile exposed through a local ZCode command, configure the syntax
that your ZCode installation actually supports:

```json
{
  "providers": {
    "default": "codex",
    "auth": "subscription",
    "by_role": { "rowan": "glm" },
    "catalog": {
      "glm": {
        "command": "zcode",
        "model": "glm-4.6",
        "args": ["exec", "--model", "{model}", "--cwd", "{workspace}", "-"]
      }
    }
  }
}
```

The `args` array is intentionally explicit because ZCode installations may
expose different non-interactive flags. Run `atl providers`, then
`atl launch --dry-run`, and inspect the command before using
`atl launch --confirm`. A missing executable or malformed custom profile is
contained as a launch blocker before any child process starts.

A confirmed launch validates every needed provider executable before
starting anything. A missing or misconfigured provider blocks that task with
an actionable fix, records the blocker, and leaves the task outside
`in_progress` — no half-started agents.

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

### Recovering a blocked task

Blocking is a safety stop, not a permanent failure. First ask why — `atl why`
prints the full, untruncated blocker text behind every active task plus the
exact command that fixes it (`atl why T-001` for one task; `atl show` also
points here whenever something is stopped at a gate):

```bat
atl why
atl why T-001
```

If the blocker is an owner gate (the blocker text names approval), the human
resolves it in one word. `atl approve` records the approval as durable
evidence, clears the blocker through the audited
`blocked → triaged → assigned` path, and queues the task:

```bat
atl approve T-005 --note "doc-only task, capped at 60 minutes and one session"
atl launch --confirm
```

For any other blocker, select the blocked task in `atl ui` and press `u`, or
use the CLI equivalent:

```bat
atl unblock T-001 --to assigned --note "Repository snapshot is available; retrying the bounded install checks."
atl queue add T-001
atl launch --confirm
```

If the blocker names a missing or stale workspace, the next launch repairs it
from the current project snapshot. ATL archives the old directory first; it
does not delete it. Approval, credentials, deployment, and other human-owned
gates still require an explicit human resolution note — `atl approve` is that
note, recorded where audits can see it.

## Roles

`node runtime\atl-manager.mjs role <name>` prints the full contract a session
adopts before acting. Summary:

- **Mira** — assigns triaged tasks, unblocks, escalates, briefs. Never codes.
- **Pip** — turns intake into objective + observable checks + priority/risk. Never assigns.
- **Rowan** — builds only inside the task workspace, records evidence, checkpoints. Never self-certifies.
- **Sage** — reviews the diff + evidence independently. Never implements.
- **Beacon** — verifies finish conditions, watches timers and stale work, preserves memory. Never builds.

**Show the work.** Handoffs and close-outs speak `show-me` and PR preparation (only when a task contract allows it) follows `visual-pr`: diff-shaped change views, shallow file trees, component or call trees — the smallest view that shows what changed, written from real inspection of the rendered output, never from the builder's description. These are optional external skills, not ATL runtime files and not directories to add to a target repository. If you install them, install them in the agent's own skill location; otherwise follow the same conventions from the prompts.

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
Resources:
- ![Current screenshot](attachments/current.png)
- [Upstream discussion](https://github.com/example/repo/issues/42)
```

A plain `- [ ] thing to do` line also becomes a task. `intake` is idempotent —
tasks are deduped by source key, so re-running never duplicates.

Resources are first-class packet references. Markdown images, Markdown links,
HTML `<img>`/`<a>` references, and explicit `Resources:` bullets are detected
from local task files, GitHub issue bodies, and Azure descriptions. A local
file or screenshot is copied into
`.trust/manager/attachments/<task-id>/`; a remote URL remains a URL and is
not downloaded implicitly. In `atl ui`, press `e` then `a` and paste a URL or
path (optionally `Label | URL-or-path`). The CLI equivalent is:

```powershell
atl resource T-001 "C:\screenshots\before.png" --label "Before screenshot"
atl resource T-001 "https://github.com/org/repo/issues/42" --label "Discussion"
```

The packet, `atl show`, review screen, and worker prompt all include these
resources. This keeps screenshots, tickets, documents, and links attached to
the task without pretending an external resource was verified or fetched.

**GitHub issues.** Enable from the CLI:
`atl intake enable github --repo owner/name` (comma-separate several, or
re-run to add more). The command probes every configured repo through the
same gh-CLI → REST path intake uses, and refuses to write the config when a
repo 404s — the usual private-repo-without-auth case — printing the fix
instead (`gh auth login` or `GITHUB_TOKEN`; `--force` skips the probe,
`--remove owner/name` drops a stale repo, `atl intake disable github` turns
the source off). `atl intake status` shows every source's enabled state and
auth readiness. Public repos work unauthenticated.

**Azure Boards (self-hosted Azure DevOps Server works).** Run
`atl intake enable azure` (it refuses until the token exists, or use
`--force`), provide a PAT with *Work Items: Read* in the
`AZDO_PAT` environment variable, and set `iteration_path` to the sprint
(e.g. `Middleware-and-Portals\Sprint 73`). The adapter queries the iteration
by WIQL and pulls title/state/type/priority/assigned-to.

## Workspaces

`workspace <task-id>` gives the task an isolated home:

- if `config/manager.json` maps the repo to a local clone path → a **git worktree** branch `atl/<task-id>`;
- else if the source is a GitHub repo → a shallow **clone**;
- else if the task came from this project's inbox and the project is a Git repo → a detached **snapshot worktree** containing the current tracked and untracked project files;
- else → a scratch directory for doc/planning tasks.

Workers never touch any active checkout. `.trust/manager/workspaces/` is
gitignored and disposable. Each managed workspace carries an ownership marker;
an old unmarked or mismatched directory is moved to
`.trust/manager/workspace-archive/` and rebuilt instead of being silently
reused. This prevents a stale README-only scratch directory from blocking a
real repository task forever.

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

## Speed, tokens, and overnight work

The runtime commands above are local and deterministic. They do not call a
language model: `init`, `intake` (for local files), `show`, `wake`, `brief`,
`feed`, and `validate` are cheap state-file operations. Jev is opt-in and
disabled by default; Mem0/graph memory is also optional and can make a network
call when configured.

The role names do not create five always-running bots. They are contracts that
an AI session adopts. The installer gives a session the role prompt; the
runner enforces the role and records the result. If no agent process is open,
no implementation work is happening. The bounded local runner can start one
or more explicit worker sessions:

```powershell
atl overnight T-001 --worker codex --confirm --max-minutes 120 --max-sessions 5
```

`overnight --all` is the autonomous queue: one press takes **every active
task** in priority order (urgent → high → normal → low, then task id) and
drives each through the full role pipeline — Pip triages, Mira assigns, Rowan
builds, Sage reviews, Beacon verifies — with real bounded sessions until a
gate or the budget stops it. One stalled or failed task is recorded as
blocked and the queue moves on; the run ends by saving the manager brief.

```powershell
atl overnight --all --dry-run                          # preview the queue, no agent starts
atl overnight --all --worker codex --confirm --max-minutes 240 --max-sessions 20
atl overnight --all --worker claude --auth subscription --confirm --max-minutes 240 --max-sessions 20
```

Budgets are global to the run (`--max-minutes`, `--max-sessions`, max 20
sessions). Without `--worker`, the run uses `providers.default` from
`config/manager.json` — the same default `atl launch --confirm` starts from
before applying its per-role overrides (`providers.by_role`). Worker
prompts still forbid merge, push, deploy, spending, policy changes, and
external messages — those stay human decisions; the morning brief
(`atl brief`) and the feed (`atl feed --roster`) are where you read
what happened.

For Claude Code, subscription-safe mode requires a Claude Pro/Max login. Open
Claude Code and run `/status` first to confirm the intended subscription:

```powershell
claude logout
claude login
atl overnight T-001 --worker claude --auth subscription --confirm --max-minutes 120 --max-sessions 5
```

ATL removes known API/provider environment variables from the Claude child in
subscription mode and does not change the parent shell. If the subscription
login is unavailable, the child fails; ATL does not retry in API mode. Use
`--auth api` only when pay-as-you-go billing is intentional. The current
Claude adapter launches local `claude -p`; it does not launch `claude --cloud`.
The separate Claude cloud mode can continue on GitHub-backed infrastructure
after the laptop is closed, but ATL does not yet synchronize that cloud
session's branch, PR, and evidence back into local manager state.

For the lowest-cost safe run, use `--dry-run` first, then one bounded worker
session in the isolated workspace, keep Jev and Mem0 off, and set a small
session/time budget. Do not run five model sessions in parallel unless the
work is genuinely separable and the extra token cost is justified.

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

`wake` is a one-shot report, not a background loop. Beacon's night-watch
contract means that a Beacon session may run `wake`, act only inside its
contract, save `brief --save`, and leave blockers honest. It does not mean
Beacon is running while every agent session is closed.

Before any unattended session, write down the objective, allowed and forbidden
actions, isolated workspace, checks, stop rule, and morning report. Never allow
an overnight session to merge, deploy, spend money, change policy, or send
external messages without a separate human decision. In the morning, run:

```bat
atl wake
atl brief --save
atl feed --task T-001
atl show T-001
```

Treat the result as conditionally trustworthy until you inspect the changed
files, observed checks, review evidence, and any skipped or unavailable
runtime checks. ATL protects lifecycle gates; it does not prove that an agent
understood the product or that an external deployment is safe.

## Reset

Delete `.trust/manager/state.json` (and workspaces if you want) and run
`init` again. Briefs and run records are history; keep or delete freely.

The manager also maintains a bounded local learning journal at `.trust/manager/learning.json`. Use `memory learn <preference|style|prompt|lesson|outcome> "..."` for explicit feedback and `memory recall "..."` to inspect matching entries. Verified task outcomes are added automatically. The journal is advisory and cannot change transition policy or evidence gates; Mem0 remains an optional graph-memory layer.
# Dynamic skill routing

## Package and project bootstrap

The supported distribution is `@depie99/atl`. Install it globally or invoke it with `npx`, then run `atl init` inside the target project. The package owns the runtime, prompts, and skills; `init` creates the project's `.atl/project.json`, `.trust/manager/` state, configuration, inbox, briefs, and workspace directories without copying skills into the project.

```powershell
npm install -g @depie99/atl --registry=https://npm.pkg.github.com
cd your-project
atl init
```

The manager reads `config/skill-routing.json` during intake and triage. Pip scores the task title, objective, labels, and source against the local skill registry, records the selected skill(s) on the task, and proposes a worker. The route is advisory: Mira still assigns the worker, Sage still reviews, and Beacon still verifies.

### Optional Jev smart routing

Jev is an explicit second opinion for ambiguous routes, not a replacement for the local router. Enable `config/jev.json`, set `TYPESAFE_API_KEY`, and use `route <task-id> --smart` or `triage <task-id> --smart`. Write a normal ATL task prompt with the outcome, affected surface, constraints, and observable checks; there is no separate Jev prompt. ATL sends a compact title/objective/labels state and a closed list of available skills, then accepts one choice only when its confidence meets `min_confidence`. The call is never made during ordinary intake, and all errors fall back without another model call. See [`docs/jev.md`](../docs/jev.md) for setup, examples, output, troubleshooting, and token boundaries.

Inspect a route with:

```powershell
node runtime\atl-manager.mjs route T-001
```

Missing skills are reported as skipped. If no specialist matches, the configured `atl-implement` fallback is selected when available.
