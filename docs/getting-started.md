# Getting started

Open a local ATL project and create your first reviewed task. The full plugin includes skills, workflows, task execution and the Control Plane in one package. Standalone runtime and skill installation remain available.

## Prerequisites

Use Node.js 22 or newer and Git. Provider execution additionally needs a supported installed CLI or a configured API provider. Python is used by repository policy verifiers. Browser verification uses Playwright and its installed browser.

## Use the complete plugin

Choose the bundle for your harness. Each contains the same runtime, all ATL skills and references, the full Control Plane, task queues, execution engine, and role contracts. ZCode Desktop releases with UI Plugin support expose the whole Control Plane in an **ATL Control Plane** session panel; open it directly from the installed plugin without a chat command. Other hosts can use the bundled browser route. No global ATL installation, PATH change, or separate skill installation is needed. The harness and its external prerequisites still need to be installed; DeepSeek Harness has its own Node.js requirement. Step-by-step installation for each harness, including ZCode Desktop, is in [install the plugin](plugin-install.md).

Bundles are published to the public marketplace [depie99/atl-marketplace](https://github.com/depie99/atl-marketplace) (install with `/plugin marketplace add depie99/atl-marketplace`). Maintainers produce the distribution with:

```sh
npm run plugins:build
```

This creates `dist/plugins/codex`, `claude`, `cursor`, `deepseek`, `gemini`, `zcode`, and `universal`. Use a fresh output directory when rebuilding: `npm run plugins:build -- --out dist/plugins-next`. The builder refuses existing target directories so it cannot overwrite user files. Building needs no runtime dependency installation. All targets use `runtime/lib/plugin-host.mjs`; the adapter changes the host registration rather than forking ATL.

**Start with ATL Connect.** Every generated bundle contains `start.cmd` for Windows and `start.sh` for macOS/Linux (`sh start.sh`). Run it and open the printed local URL. Alternatively, run `node runtime/atl-connect.mjs` from the bundle directory. Keep that terminal open during use. Inside an already connected harness, ask the agent to call `atl_connect` for the same assistant.

The assistant offers English/Persian, right-to-left layout, light/dark themes, searchable harness selection, configuration copy/download, a starter prompt and a project-opening flow. It uses the bundle's actual path and Node executable; no placeholder edits or separate ATL install are needed. Downloaded configurations are **snippets to merge**, not replacements for existing settings. Moving the bundle or Node executable requires regenerating the connection snippet. The assistant does not edit harness configuration files automatically.

For any harness with **local stdio MCP tools**, use the `universal` bundle and select **Other harness**. Enter the displayed command and argument in its MCP form, or merge the JSON where supported. The full runtime and all skills remain available through the same tools. This is a capability-based connection: browser-only chats and HTTP-only clients require another adapter. Harness connection support is separate from unattended worker-provider support.

| Harness | Included integration | Local installation / review |
|---|---|---|
| Codex | Agent Plugins manifest, bundled stdio MCP, native skills, onboarding skill | `codex plugin marketplace add ./dist/plugins`, then install **Agent Trust Ladder** from **ATL Local** in the desktop plugin directory |
| Claude Code | Claude plugin manifest, bundled stdio MCP, skills and commands | Start with `claude --plugin-dir ./dist/plugins/claude`; for persistent use add `dist/plugins` as a local marketplace, then install `agent-trust-ladder@atl-local` |
| Cursor | Cursor plugin manifest, bundled stdio MCP, skills and commands | The `dist/plugins/cursor` directory is the submission package for the Cursor plugin marketplace; public installation requires publication and host review |
| DeepSeek Harness | Native Cordis tools and an installable `dsh.bundle`; skills and references are available through `atl_skill` | `dsh plugin --profile atl add ./dist/plugins/deepseek`, then `dsh --profile atl web` |
| Gemini CLI | Native extension manifest, bundled stdio MCP, workflow context and complete skill tree | `gemini extensions link ./dist/plugins/gemini` for local development; use Gemini's extension installation flow for distribution |
| Other local MCP harnesses | Full runtime over the shared MCP bridge | Run ATL Connect from `universal`, select a profile or **Other harness**, merge its settings and verify ATL tool discovery |

ATL Connect includes configuration profiles for VS Code / Copilot, OpenCode v1 and v2, Zed and Continue, in addition to the native package targets. Profiles follow their documented schemas; actual tool discovery and permission behavior must be checked in the installed host version. A profile is not a verified host installation.

Use absolute paths when installing from a different working directory. For a portable DeepSeek archive, run `npm pack --ignore-scripts` inside `dist/plugins/deepseek`, then install that `.tgz` using `dsh plugin --profile atl add <archive>`. The package ships executable JavaScript and requires no build script during installation. It declares the supported DSH range in `engines.dsh`; recheck the adapter when moving to another DSH release.

After enabling the plugin, ask the agent: **“Use ATL to initialize this application and open its Control Plane.”** The agent obtains the application's absolute path and calls `atl_start`. This prepares missing project state, preserves existing state and returns the full Control Plane URL in one step. Open the returned loopback URL and check the selected project. Alternatively, use **Open a project** in ATL Connect, enter the absolute application folder and select **Open Control Plane**. Neither installation nor opening the interface starts workers.

The plugin exposes these operations inside the harness (host prefixes may differ):

| Tool | Purpose |
|---|---|
| `atl_connect` | Open the bilingual connection assistant without initializing a project |
| `atl_start` | Prepare missing application state and open/reuse the full Control Plane in one step |
| `atl_info` | Inspect the bundle version and all available skill names |
| `atl_skill` | Read a skill or a supporting file on demand; begin with `name: "atl"` |
| `atl_command` | Execute the bundled CLI with an explicit `project` and argv strings; omit the leading `atl` |
| `atl_job` | Observe command output and exit status using the returned job ID |
| `atl_control_plane` | Start or reuse the full browser interface for an initialized application |

For example, pass `args: ["show"]` to list tasks, or `args: ["compose", "--title", "Fix login", "--check", "Signed-in user reaches dashboard"]` to capture work. `args: ["launch", "--dry-run"]` previews queued execution. The installed CLI's complete command contract is available with `args: ["--help"]`. Arguments are passed directly to Node as data; shell syntax is not evaluated by the bridge. Existing CLI operations may themselves execute user-approved verifiers or providers.

Interactive workflows run in the current harness. Unattended task execution still uses ATL's configured providers: installing the DeepSeek or Cursor plugin does not register that host as a new worker backend or borrow its session credentials. Configure a supported installed CLI or API provider, preview the run and authorize execution through the existing ATL gates. The plugin does not silently switch providers or supply `--confirm`.

The MCP process is a local executable with its host account's filesystem access; tool approval and workspace policy must be configured in the harness. The bridge requires explicit application paths and refuses its own installation as the managed project. It does not turn MCP tool calls into the harness's shell sandbox.

Control Plane servers and command handles live for the plugin session. Finish or stop active work before disabling or updating the plugin; use the Control Plane's stop operation for provider runs. Project task state and evidence survive under `.trust/manager/`, with configuration in `config/`, and can be reopened from another harness. Uninstalling the plugin leaves these application records intact. Separate harnesses share that durable state, but do not share transient command job IDs.

Run `npm run plugins:test` to verify generated manifests, runtime and skill inclusion, stdio discovery, fresh-project initialization, task capture, lifecycle rejection, real Control Plane HTTP behavior and a bounded synthetic provider execution from the shipped bundles. DeepSeek's native adapter is checked against a Cordis tools contract fixture. Successful loading in the actual harness UIs and public marketplace installation remain release checks; local bridge tests do not prove those host behaviors.

Packaging contracts follow the official [OpenAI plugin documentation](https://developers.openai.com/plugins/build/plugins), [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference), [Cursor plugin reference](https://cursor.com/docs/reference/plugins), [Gemini extension reference](https://geminicli.com/docs/extensions/reference/), and [DeepSeek bundle documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md). Connection profiles follow the official [VS Code MCP reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration), [Gemini MCP reference](https://geminicli.com/docs/tools/mcp-server/), [OpenCode v1](https://opencode.ai/docs/mcp-servers/), [OpenCode v2](https://opencode.ai/v2/docs/mcp-servers), [Zed MCP](https://zed.dev/docs/ai/mcp) and [Continue MCP](https://docs.continue.dev/customize/deep-dives/mcp) documentation.

## Install the runtime

```powershell
git clone https://github.com/depie99/Agent-Trust-Ladder.git
cd Agent-Trust-Ladder
npm ci
scripts\install-atl.cmd
```

On macOS or Linux, use `sh scripts/install-atl.sh`. Open a new terminal afterward and run `atl --help`. The installer creates a per-user runtime; each managed application keeps its own state.

To develop ATL itself, use `node runtime/atl-manager.mjs --help` from the clone. Run `npm ci` for documentation and verification dependencies.

## Install the skills

```sh
npx skills add depie99/Agent-Trust-Ladder --all
```

Restart your agent session. Invoke `$atl` with the engineering problem; the router chooses the smallest applicable process. See the [skill catalog](skills.md).

## Initialize the application

```powershell
cd path\to\your-application
atl init
atl ui --port 4317
```

Open the loopback URL printed by ATL. `atl control-plane` opens the same browser interface. `atl tui` opens the terminal interface; `atl dashboard --once --plain` prints a snapshot. Check any `ATL_PROJECT` override before initializing or running commands.

Expected result: the Control Plane shows the intended project. Initialization creates `.trust/manager/` there. Opening the browser does not launch a worker.

## Create one bounded task

1. Open **Tasks** to create work, or **Issue sources** to import it.
2. Review its objective, observable checks, risk, prerequisites, and resources.
3. Use **Plan Studio** when the request needs clarification or decomposition.
4. Inspect provider readiness in **Settings**.
5. Add approved work to a queue and preview its launch and budget.
6. Confirm the bounded run, then inspect evidence and independent review.

Expected result: an explicit task packet and queue membership precede execution. A successful session still needs completion evidence.

## Recover setup problems

If `atl` is missing, open a new terminal or use the installer-created shim. If the port is occupied, choose another port. If the interface stops responding after an interrupted session, run `atl daemon stop` and reopen it — the Control Plane runs as a per-project state-owner daemon recorded in `.atl/daemon.json`. Fix provider installation/authentication before repeating preview. See [troubleshooting](troubleshooting.md) and [providers](providers.md).
