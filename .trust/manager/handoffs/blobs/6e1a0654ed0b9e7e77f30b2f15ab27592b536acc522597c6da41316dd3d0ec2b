# ATL team: install it, start it, trust it carefully

This is the owner guide for the ATL team runtime. It answers what to install,
where it goes, what to run in a target project, and what really happens
overnight.

## The two ATL layers

| Layer | What it gives you | Where it lives |
|---|---|---|
| **ATL skills** | `$atl`, `$atl-plan`, `$atl-verify`, and agent workflow instructions | Your agent's skill directory, global or project-local |
| **ATL team runtime** | The `atl` CLI, role contracts, task state, evidence gates, feed, and briefs | Runtime in your user install; state in each target project |

The runtime is not copied into every application. A target project gets its own
manager state only after you run `atl init` there.

## Recommended Windows install

### 1. Install the skills into your agent

```powershell
npx skills add depie99/Agent-Trust-Ladder --all
```

Restart the agent session afterward. This installs skill folders into the
agent's own location. It does not add `humanlayer`, `visual-pr`, or any
other third-party directory to your ATL repository.

### 2. Install the team runtime once per user/machine

Keep the clone in a tools directory, separate from the application that ATL
will manage:

```powershell
mkdir D:\tools
cd D:\tools
git clone https://github.com/depie99/Agent-Trust-Ladder.git
cd Agent-Trust-Ladder
scripts\install-atl.cmd
```

The installer copies the runnable files to:

```text
C:\Users\<you>\.atl\
  atl.cmd                 # command shim
  runtime\                # copied CLI and runtime libraries
  runtime\prompts\       # paste-ready role prompts
  skills\                 # packaged ATL skills
```

If Codex or Claude Code already has its user prompt directory, the installer
also wires these prompts:

```text
C:\Users\<you>\.codex\prompts\atl-*.md
C:\Users\<you>\.claude\commands\atl-*.md
```

Open a **new terminal** after installation and verify it:

```powershell
atl --help
```

If `atl` is not recognized, open a new terminal, rerun the installer without
`--no-path`, or use the direct path temporarily:

```powershell
& "$env:USERPROFILE\.atl\atl.cmd" --help
```

### 3. Initialize each target project

Leave the ATL clone and enter the application you want to manage:

```powershell
cd D:\Projects\YourProject
atl init
atl validate
```

`atl init` creates project-local files:

```text
.atl\project.json
.trust\manager\state.json
.trust\manager\inbox\
.trust\manager\briefs\
.trust\manager\workspaces\
config\manager.json
```

It does not copy the ATL repository, runtime, skills, or third-party skill
directories into the project. Run `atl init` once in every project that needs
its own task queue.

## Your first task

Create a file in the target project's inbox:

```markdown
## Fix the checkout loading state
@priority: normal
@risk: normal

Checks:
- the loading state is visible before the response arrives
- the empty and error states still render correctly
```

Then run:

```powershell
atl intake
atl show                  # find the task id, for example T-001
atl triage T-001          # print Pip's task packet
atl route T-001           # inspect the local skill route
atl wake                  # see the next action by role
atl feed --roster         # see the team feed
```

The normal sequence is:

```text
you describe the outcome
  → Pip bounds the task
  → Mira assigns a worker
  → Rowan changes code in an isolated workspace
  → Sage reviews the diff and evidence
  → Beacon checks every completion condition
  → you decide whether to merge or deploy
```

The names are role contracts, not five hidden personalities. A role becomes
active only when an AI session adopts its prompt or when you record a command
with the matching `--actor`.

## Connect an AI session to a role

Open an agent session **in the target project**, not in the ATL installer
clone:

- Codex or Claude Code: use `/atl-pip`, `/atl-rowan`, `/atl-sage`, or
  `/atl-beacon` if the installer wired it.
- Any other agent: paste the matching file from
  `C:\Users\<you>\.atl\runtime\prompts\`.
- Manual operation: use the CLI and pass `--actor pip`, `--actor mira`,
  `--actor rowan`, `--actor sage`, or `--actor beacon`.

The runner remains the authority. It rejects actions outside a role's contract
and records the result in `.trust\manager\state.json` and the feed.

## The control room: compose, review, queue, preview

Before any agent runs, work passes through the control room — `atl ui` in the
terminal, or the same steps as plain CLI commands:

```powershell
atl compose --title "Fix the checkout loading state" --check "loading state is visible before the response arrives"
atl queue add T-001            # persistent execution queue (queue.json), separate from UI focus
atl queue list                 # the launch plan: role, provider, workspace, budget per task
atl providers                  # which provider CLIs were found on PATH, per-role mapping
atl unblock T-001              # clear a resolved blocker and restore the task to its valid gate
atl resource T-001 "C:\screenshots\before.png" --label "Before screenshot"
atl launch --dry-run           # preview the queued run — no agent starts
atl launch --confirm           # run the queue: sequential, bounded, per-role providers
```

`compose` saves your verbatim wording as an immutable draft under
`.trust/manager/drafts/` and creates a `new` candidate; the same text never
creates a second task. Pressing `v` on a task in `atl ui` opens the packet
review where you can edit the objective, completion checks, priority, risk,
and route before queueing. From the launch preview, press `Enter` or `y` to
confirm the bounded run inside the control room, or use the equivalent CLI
command. Execution is one task at a time, with per-role providers from
`providers.default` / `providers.by_role` in `config/manager.json`. If a
provider executable is missing, the launch is blocked with the exact fix
instead of starting an agent.

### Recovering blocked work

Blocked is an explicit pause, not a dead end. In `atl ui`, select the blocked
task and press `u`. When its worker is known, ATL clears the blocker and moves
it through `triaged` back to `assigned`; press `x` to queue it, then `l` and
`Enter` to confirm the bounded run. If no worker is known, `u` returns the task
to `triaged`; assign it before queueing:

```powershell
atl unblock T-001
atl assign T-001 --to rowan --actor mira
atl queue add T-001
atl launch --confirm
```

The action is logged and narrated. It does not start an agent or erase the
original blocker evidence.

### Attachments and links

Screenshots and supporting material are part of the canonical task packet.
Write them under a `Resources:` section in an inbox/compose draft, use Markdown
images or links in a GitHub/Azure description, or press `e` then `a` in the
control room. Local files are copied to
`.trust/manager/attachments/<task-id>/`; external URLs are retained as
references and never silently downloaded. The worker prompt receives the
resource list, while the packet and `atl show` keep the same references visible.

## Actual overnight execution

The runtime has an explicit bounded local worker command for driving one task
through its role pipeline. It can launch an installed Codex CLI or Claude Code
process, pass it the current ATL role contract, and continue through the next
state gate. It is not a hidden daemon: you start it explicitly and set the
limits. (`atl launch --confirm` uses the same engine for the whole queue.)

Preview the next role without spending model tokens:

```powershell
atl overnight T-001 --worker codex --dry-run
```

Start a real bounded run with Claude Code using a subscription login:

```powershell
claude logout
claude login                 # choose the Claude Pro/Max subscription login
atl overnight T-001 --worker claude --auth subscription --confirm --max-minutes 120 --max-sessions 5
```

Before starting ATL, open Claude Code and run `/status` to confirm that the
authenticated account is the intended Claude subscription. ATL removes known
API/provider environment variables from the child process in subscription
mode. It does not change the parent shell. If the subscription login is not
available, the child fails and ATL does not retry with API billing.

If you intentionally want pay-as-you-go billing, make that choice explicit:

```powershell
atl overnight T-001 --worker claude --auth api --confirm --max-minutes 120 --max-sessions 5
```

`--worker claude` currently launches a local process shaped like:

```text
claude -p --add-dir <project> --add-dir <workspace> \
  --permission-mode acceptEdits --permission-prompts none \
  --no-session-persistence --output-format text
```

The ATL role contract and task prompt travel on the process's standard input,
not on the command line — command lines stay short and Windows-safe.

This is local execution: the laptop and process must remain available. It is
not the Claude cloud-session command.

### True Claude cloud sessions

Claude also has a separate cloud mode, started with `claude --cloud`, that
clones a GitHub repository into an isolated cloud environment and can continue
after you leave the laptop. ATL does **not** dispatch or synchronize that mode
yet. A future cloud adapter must connect the GitHub task/PR back to ATL's local
state and evidence; without that bridge, a cloud PR must be audited manually.

The runner starts the role that matches the task status (`pip`, `mira`,
`rowan`, `sage`, or `beacon`), stops when the worker fails or does not
advance state, and stops at `done`, `blocked`, `escalated`, or the
time/session budget. Each session is logged under:

```text
.trust\manager\overnight\<task-id>\session-<n>-<role>.log
```

The task workspace is isolated before Rowan runs. The worker prompt forbids
merge, deploy, push, spending, policy changes, and external messages. Those
boundaries are instructions plus ATL state gates; they are not a guarantee
that a model is semantically correct.

### Make the team history available in Codex

ATL keeps the durable team feed and provider transcripts locally, then projects
new material into a persistent Codex history thread. Create the thread once and
sync it when you want to inspect the latest evidence in the Codex app:

```powershell
atl codex bridge start
atl codex bridge status
atl codex bridge sync
atl history --source codex --n 10
```

The default `dedicated` mode uses Codex app-server `thread/inject_items`, so it
does not start a model turn. A per-thread checkpoint prevents duplicate
imports. If the desktop app owns the target writer, ATL creates a new history
thread and updates the configured target instead of writing the rollout store
directly. To put a normal visible message into one exact open conversation,
link it explicitly with `--mode queue`; this starts a model turn and should not
be enabled as a silent background transport. See the full
[Codex history bridge guide](codex-history-bridge.html).

## Speed, token cost, and trust

The local commands `init`, `show`, `wake`, `brief`, `feed`, `validate`,
and the `--dry-run` preview do not spend model tokens. The worker sessions
do. Running five sessions in parallel is not automatically faster: it can
increase token cost, contention, and integration risk. Start with one task,
one worker, and a small session/time budget.

Jev is disabled unless explicitly enabled. Mem0/graph memory is optional and
may add network/model cost. Keep both off for the cheapest overnight run.

This is conditional trust, not “leave it and assume it is safe.” Never allow
an unattended run to merge or deploy. In the morning, inspect the evidence:

```powershell
atl wake
atl brief --save
atl feed --task T-001
atl show T-001
atl validate
```

Then inspect changed files, actual verifier output, the independent review,
and skipped or unavailable checks. A laptop being open is not itself an
execution guarantee; the explicit `atl overnight` process must be running.

## Update and uninstall

```powershell
cd D:\tools\Agent-Trust-Ladder
git pull
scripts\install-atl.cmd
```

To uninstall the runtime, remove `%USERPROFILE%\.atl`, wired role prompt
files, and its PATH entry. Project `.trust\manager` files are ordinary
project artifacts; keep or remove them according to your project policy.

## Source of truth

- Runtime behavior: [`runtime/README.md`](../runtime/README.md)
- Skill installation: [`USAGE.md`](../USAGE.md)
- Role policy: [`skills/atl-team/SKILL.md`](../skills/atl-team/SKILL.md)
- CLI implementation: [`runtime/atl-manager.mjs`](../runtime/atl-manager.mjs)
