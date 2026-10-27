# Installing and Using Agent Trust Ladder from GitHub

Complete guide to getting the skill running in your AI coding agent, keeping it updated, and troubleshooting. For the full workflow walkthrough (scenarios, dose control, FAQ) see [GUIDE.md](GUIDE.md). راهنمای فارسی: [README.fa.md](README.fa.md)

---

## 1. Requirements

- Any AI coding agent that supports the [Agent Skills](https://agentskills.io) convention (skills folders) — Claude Code, Codex CLI, Cursor, Copilot CLI, Gemini CLI, opencode, Windsurf, and more.
- Git (for manual install and updates).
- Node.js 18+ (only for the `npx skills` installer).

---

## 2. Install

### Option A — `npx skills` (recommended, one command)

The [skills CLI](https://github.com/vercel-labs/skills) installs into the right folder for 70+ agents and can manage multiple agents at once:

~~~bash
# interactive: asks which agents to install into
npx skills add depie99/Agent-Trust-Ladder

# non-interactive: pick agents explicitly
npx skills add depie99/Agent-Trust-Ladder --skill agent-trust-ladder -a claude-code -a codex -a cursor

# project-local instead of global (where supported)
npx skills add depie99/Agent-Trust-Ladder --skill agent-trust-ladder -g
~~~

Then restart your agent session so it discovers the new skill.

### Option B — manual install (git clone)

~~~bash
git clone https://github.com/depie99/Agent-Trust-Ladder.git
~~~

Copy `Agent-Trust-Ladder/skills/agent-trust-ladder/` — the whole folder, keeping its name — into your agent's skills directory:

| Agent | Project-local (this repo only) | Global (all projects) |
|---|---|---|
| Claude Code | `.claude/skills/agent-trust-ladder/` | `~/.claude/skills/agent-trust-ladder/` |
| Codex CLI | `.codex/skills/agent-trust-ladder/` | `~/.codex/skills/agent-trust-ladder/` |
| Cursor | `.cursor/skills/agent-trust-ladder/` | `~/.cursor/skills/agent-trust-ladder/` |
| Any AGENTS.md-compatible agent | `.agents/skills/agent-trust-ladder/` | `~/.agents/skills/agent-trust-ladder/` |

> Folder conventions evolve; if your agent documents a different skills path, that path wins. Project-local installs keep the skill out of your other repos — global installs make it available everywhere.

### Option C — pin a version with a git submodule (teams)

~~~bash
git submodule add https://github.com/depie99/Agent-Trust-Ladder .vendor/Agent-Trust-Ladder
# then copy or symlink the skill folder in your setup script:
# cp -r .vendor/Agent-Trust-Ladder/skills/agent-trust-ladder .agents/skills/
~~~

Everyone on the team gets the same skill version until you update the submodule. Combine with CI to detect drift.

### Direct mode invocation

Codex discovers the independent skills under `skills/atl-*/`. Invoke one with `$atl-specify`, `$atl-audit`, and so on. `/atl-*` is not a Codex skill syntax.

### Slash commands (optional — Claude Code and compatible agents)

The skill works with plain language on its own. Slash commands give you direct entry points:

~~~bash
# from the cloned repo, into your project (or use ~/.claude/commands/ for global)
cp Agent-Trust-Ladder/commands/*.md .claude/commands/
~~~

You now have: `/atl`, `/atl-bootstrap`, `/atl-frame`, `/atl-specify`, `/atl-plan`, `/atl-implement`, `/atl-verify`, `/atl-audit`, `/atl-trust`.

### Verify the install

1. Start a new session in your agent.
2. In Codex, confirm `agent-trust-ladder` and the installed `atl-*` skills, including `atl-ui-review`, are listed. Slash commands are not expected.
3. In Claude Code, type `/` if you installed the optional command adapters; the `/atl*` entries should appear.
4. Smoke test: invoke **`$atl-bootstrap`** in Codex (or `/atl-bootstrap` in Claude Code). It should produce `.trust/project-brief.md` and change nothing else.

---

## 2b. Install the digital team runtime (optional)

The skills are the methodology. The repo also ships the **runtime** that runs the named bot team — Mira (coordinator), Pip (triage), Rowan (builder), Sage (reviewer), Beacon (verifier/night watch) — as a persistent state machine in any project, drivable from any terminal or AI agent CLI (ZCode, Claude Code, Codex CLI, Grok CLI, Cursor, ...):

~~~bash
git clone https://github.com/depie99/Agent-Trust-Ladder.git
cd Agent-Trust-Ladder
scripts\install-atl.cmd        # Windows    (macOS/Linux: ./scripts/install-atl.sh)
~~~

Requires Node 18+. The installer copies the runtime and skills to the per-user install directory (`%USERPROFILE%\.atl` on Windows, `~/.atl` on macOS/Linux), adds an **`atl`** command to your user PATH (`--no-path` to skip), and ships paste-ready role prompts. The clone is only the installer source; do not copy it into every project. Then, in **any target project**:

~~~bash
cd your-project
atl init                 # scaffolds config + .trust/manager in THIS project
# drop tasks into .trust/manager/inbox/*.md (or wire GitHub issues / Azure Boards in config/manager.json)
atl intake               # new tasks appear, narrated by the bots
atl ui                   # browser-native ATL Control Plane (primary interface)
atl control-plane        # explicit alias for the browser-native interface
atl tui                  # terminal compatibility surface; not the primary docs path
atl launch --dry-run     # preview the queued run (provider, role, workspace, budget per task)
atl launch --confirm     # start it: sequential, bounded, per-role providers (codex/claude CLI)
atl why                  # the full "why" behind every blocked/waiting task + the exact fix command
                         # queue runs auto-retry one transient blocker; EPERM/ACL/owner gates go to the manager
atl approve <id>         # owner gate in one word: record your approval, clear the blocker, queue it
atl feed --roster        # watch the team work
atl history              # the Codex + ZCode CLI chat transcripts on this machine (providers keep usage only, never conversations)
atl codex bridge start   # create the persistent ATL Team History thread in Codex
atl codex bridge sync    # import new feed/transcript context without a model turn
~~~

To make the local team history available in the Codex app, use the dedicated
history thread as the default. ATL keeps the local feed and provider session
logs authoritative, records an idempotent checkpoint, and rolls to a new
thread if the desktop app owns the current writer. Use
`atl codex bridge link <thread-id> --mode queue` only when the exact open chat
must receive a normal visible message; that path starts a model turn and may
consume model usage. The complete transport contract and troubleshooting guide
is [Codex history bridge](docs/codex-history-bridge.html).

**Run the team on an API provider (e.g. Z.ai GLM) — one minute, no env vars:** store the provider once per machine, then select it per project. The key lives in `~/.atl/providers.json` (outside every repo, masked everywhere, injected into worker sessions only at spawn):

~~~bash
atl provider add zai --key <your-glm-api-key> --model glm-5.3 --thinking-level medium   # preset pre-fills the OpenAI-compatible endpoint
atl provider use zai            # this project's default (or: --role rowan for one role)
atl launch --dry-run            # shows: codex · glm-5.3 · auth api (user provider "zai")
~~~

In the browser control room (`atl ui`), open **Settings → Manage providers**: the manager lists ready/setup-needed profiles and **Add a provider** exposes preset, provider id, display name, adapter, wire protocol, base URL, model, API key, and thinking/effort. Presets cover OpenAI/GPT, Gemini, Z.ai GLM, Anthropic, OpenRouter, and Custom; enter any exact model id for other gateways. `u`/**Use by default** makes a provider the project default. In the terminal provider screen, highlight a provider (including Codex or Claude), press `m`, and enter the model id to pin it for this project. For a single run on a stored provider: `atl run <id> --worker zai --confirm`.

**Use your ChatGPT Codex subscription — no API key:** Codex is already a built-in provider. Sign the Codex CLI into the same ChatGPT account, then inspect the browser/CLI launch preview. Do not add `codex` to the API-provider registry.

~~~powershell
codex login
codex login status
atl providers
atl launch --dry-run
~~~

The [Web Control Plane guide](docs/control-room.html) is the complete browser walkthrough: spaces, examples, preview/confirm boundary, safe stop behavior, and CLI reference. `atl tui` remains available as a terminal compatibility interface but is intentionally not the primary documentation route while its UX is under improvement.

To put an agent behind a bot, open a session in the target project and paste the matching prompt from `~/.atl/runtime/prompts/` — the runner enforces the role contract no matter which agent is behind it. The installer auto-detects Codex CLI and Claude Code and installs the prompts as native slash commands (`/atl-mira`, `/atl-pip`, `/atl-rowan`, `/atl-sage`, `/atl-beacon`); the ATL *skills* install into Codex via `npx skills add depie99/Agent-Trust-Ladder -a codex` (Option A above). Update: re-run the installer. Uninstall: delete `~/.atl`, the wired prompt files (`~/.codex/prompts/atl-*.md`, `~/.claude/commands/atl-*.md`), and remove `~/.atl` from PATH. Full guide: [runtime/README.md](runtime/README.md).

**Overnight and token boundary:** `atl init`, `show`, `wake`, `brief`, `feed`, and `validate` are local state operations. They do not spend model tokens. A confirmed queue run writes `.trust/manager/overnight/run.json`; inspect it with `atl overnight status`. The supervisor resumes safe prerequisite preparation, handoff publication, and recovery boundaries with persisted budgets. Interrupted provider sessions require owner inspection because their side effects are unknown. The manual `atl overnight recover --confirm` entry point retains its confirmation gate. See [queue preparation and delivery](docs/queue-recovery.md) for input manifests, local dependency provisioning, recovery ownership, and integrated browser evidence. Claude subscription sessions continue to strip API credentials and never fall back to API billing. Merge, publication, credential escalation, acceptance weakening, spending, and external messages remain outside automatic recovery.

## 3. Use

### The 30-second version

~~~text
You:  $atl-bootstrap                     # first time on a project
You:  $atl-frame users lose their filters on refresh
AI:   [asks ≤5 questions with recommended defaults, writes .trust/specs/001-.../brief.md]
You:  yes / yes / change this one thing
You:  $atl-specify                       # observable behavior + acceptance examples
You:  $atl-plan                          # impact, pre-mortem, tasks with verifier commands
You:  $atl-implement                     # self-correcting loop
You:  $atl-verify                        # evidence + 5-question Trust Verdict
You:  $atl-ui-review checkout page       # inspect/fix the real rendered UI
~~~

You never have to run the whole chain — jump in anywhere (`$atl-audit` a foreign PR, `$atl-trust` after a good week, or just say *"keep it Direct"* and the skill skips ceremony for small edits).

### Entry points

| I want to… | Codex skill | Or say |
|---|---|---|
| Understand an existing project before agent work | `$atl-bootstrap` | "bootstrap this project" |
| Turn a vague idea into bounded work | `$atl-frame <idea>` | "frame this idea" |
| Pin behavior before code | `$atl-specify <what>` | "specify this first" |
| Get a plan with verifiable tasks | `$atl-plan` | "plan this properly" |
| Build it with self-correction | `$atl-implement` | "implement the plan" |
| Prove it's done | `$atl-verify` | "verify with evidence" |
| Review an existing diff/PR/agent run | `$atl-audit <PR>` | "audit this diff" |
| Inspect and repair an implemented page/UI | `$atl-ui-review <surface>` | "review this UI against its requirements and fix it" |
| Decide agent autonomy | `$atl-trust` | "can the agent do this alone now?" |
| Let the skill diagnose | `$agent-trust-ladder` | just describe your situation |

### Where artifacts land

~~~text
.trust/
  project-brief.md      # your project's real rules (constitution)
  trust-policy.md       # autonomy ceilings per task class
  ledger.md             # append-only: verdicts, failures, trust changes
  specs/NNN-slug/       # brief.md, spec.md, plan.md, evidence.md
~~~

Commit `.trust/` like code — it *is* project memory. Add `.trust/` exceptions to `.gitignore` only if your team prefers ephemeral context.

---

## 4. Update

~~~bash
# installed via npx skills: just re-run it
npx skills add depie99/Agent-Trust-Ladder --skill agent-trust-ladder

# manual install: re-pull and re-copy
cd Agent-Trust-Ladder && git pull
# then copy skills/agent-trust-ladder/ over your installed copy again

# submodule: bump and propagate
git submodule update --remote
~~~

Skill files are versioned in the repo (see `SKILL.md` header / release tags), and your project's `.trust/` artifacts are independent of skill updates — updating never touches them.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `/atl*` commands don't appear | Expected in Codex: use `$atl-*`. In Claude Code, check `.claude/commands/` (project) or `~/.claude/commands/` (global), then start a **new session** |
| Skill doesn't trigger from plain language | Use the explicit form: *"use the agent-trust-ladder skill to audit this diff"* — or install the slash commands |
| Agent runs the whole pipeline for a tiny fix | Say **"Direct dose"** or *"skip the ladder for this one"* — dose control is user-overridable by design |
| Agent invented a build/test command | This violates the skill's invariants — report it as a bug with the transcript; meanwhile point it at `.trust/project-brief.md` (invoke `$atl-bootstrap` in Codex) |
| Two process skills conflict | This skill yields to repository instructions and your constitution; if another skill fights its hard lines (no green-washing, no silent autonomy), that other skill wins on style but the hard lines hold |
| `.trust/` feels noisy in diffs | Keep committing it (it's cheap markdown), or move it via the brief if your convention differs — the skill follows the brief |

---

## 6. Uninstall

~~~bash
# npx skills
npx skills remove agent-trust-ladder        # or delete the installed skill folder

# slash commands: delete the files
rm .claude/commands/atl*.md

# project artifacts: they're plain markdown, safe to keep or delete
rm -rf .trust/
~~~

Nothing else in your repo is touched — the skill is strictly additive.

---

## 7. Compatibility notes

- **With Spec Kit / OpenSpec / BMAD:** coexists. `bootstrap` maps `.specify/` and ADRs instead of duplicating them; no other tool's hard rules are overridden.
- **With discipline skills (TDD, code-review, explainers):** complementary. They slot into `implement` and `audit` stages.
- **With AGENTS.md / CLAUDE.md files:** those stay the first source of truth; the skill reads them during discovery and never contradicts them.
- **Non-English teams:** work in any language — the agent asks, specifies, and reports in yours; the five-question verdict structure is language-neutral.

## 8. Contributing & license

Issues and PRs: [github.com/depie99/Agent-Trust-Ladder](https://github.com/depie99/Agent-Trust-Ladder) — skill content changes go through `skills/agent-trust-ladder/`; keep `SKILL.md` lean and put depth in `modes/` and `references/`. Licensed MIT.
