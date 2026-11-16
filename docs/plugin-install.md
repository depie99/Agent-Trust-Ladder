# Install the plugin

Add the complete ATL plugin to your harness and verify that it loaded. One bundle carries the same runtime, every ATL skill, the task queues, the execution engine and the Control Plane; only the host adapter differs. After installing, continue with [getting started](getting-started.md) to open a project and create your first reviewed task.

The public marketplace distribution lives at [depie99/atl-marketplace](https://github.com/depie99/atl-marketplace): add `depie99/atl-marketplace` as a marketplace in ZCode Desktop or Claude Code, or run `dsh plugin add github:depie99/atl-marketplace#path:deepseek` in DeepSeek Harness. A release from the maintainers or one built from a checkout also works (see [Get a bundle](#get-a-bundle)). Installation needs Node.js 22 or newer on the PATH; provider execution additionally needs a supported installed CLI or a configured API provider (see [providers](providers.md)).

## Get a bundle

A bundle is a directory tree whose root holds a `marketplace.json` catalog and one subdirectory per harness. Maintainers produce it from a checkout:

```sh
npm run plugins:build -- --out dist/plugins-next
```

The builder refuses to overwrite an existing output directory, so pick a fresh name when rebuilding. The output contains `codex`, `claude`, `cursor`, `deepseek`, `gemini`, `zcode`, and `universal` targets plus the catalog files. Building needs no dependency installation.

Note the absolute path of the bundle directory. Harnesses that install from a different working directory need that absolute path.

## Add the plugin in ZCode Desktop

ZCode Desktop discovers a local marketplace catalog and installs from it:

1. Open **Settings → Plugin Management**, then the **Discover** tab.
2. Select the **`+`** button and point it at the bundle's `marketplace.json` file (the catalog at the root of the bundle directory). ZCode accepts a local file or directory; the marketplace registers as **atl-local**.
3. Find the **agent-trust-ladder** card (Developer Tools) and select **Get**. When it finishes, the card shows **Installed**. New plugins are enabled by default.
4. Restart ZCode Desktop, or open a new session, so discovery loads the installed components.

What you get: the `atl` MCP tools (`atl_info`, `atl_start`, `atl_skill`, `atl_command`, `atl_job`, `atl_control_plane`, `atl_connect`), the `/atl-*` commands, and an **ATL Control Plane** session panel that presents the full browser interface without a chat command.

Verify the installation before first use (see [Verify the installation](#verify-the-installation)).

## Add the plugin in other harnesses

Each target carries a native manifest for its host. All commands below assume the bundle directory is `dist/plugins`; substitute your output directory and use absolute paths when needed.

### Codex

```sh
codex plugin marketplace add ./dist/plugins
```

Then install **Agent Trust Ladder** from the **ATL Local** marketplace in the desktop plugin directory.

### Claude Code

Start with the plugin loaded for one session:

```sh
claude --plugin-dir ./dist/plugins/claude
```

For persistent use, add `dist/plugins` as a local marketplace and install `agent-trust-ladder@atl-local`.

### DeepSeek Harness

```sh
dsh plugin --profile atl add ./dist/plugins/deepseek
dsh --profile atl web
```

The adapter declares its supported DSH range in `engines.dsh`; recheck it when moving to another DSH release. For a portable archive, run `npm pack --ignore-scripts` inside `dist/plugins/deepseek` and install the resulting `.tgz`.

### Gemini CLI

```sh
gemini extensions link ./dist/plugins/gemini
```

Use Gemini's extension installation flow for distribution beyond local development.

### Cursor

`dist/plugins/cursor` is the submission package for the Cursor plugin marketplace; public installation requires publication and host review and is not yet available.

### Any harness with local stdio MCP tools

Use the `universal` bundle. Run ATL Connect and select **Other harness**:

- Windows: `start.cmd` in the bundle
- macOS/Linux: `sh start.sh` in the bundle
- Directly: `node runtime/atl-connect.mjs` from the bundle directory

The assistant prints the MCP command and a JSON snippet to merge. Snippets are merged by hand — the assistant never edits harness configuration files. Browser-only chats and HTTP-only clients cannot consume a local stdio server. ATL Connect also ships profiles for VS Code / Copilot, OpenCode v1 and v2, Zed, and Continue; a profile follows the documented schema, but tool discovery must be checked in the installed host version.

## Verify the installation

Inside the harness, ask the agent to call `atl_info`. A working installation reports the release version and a skill list that includes `atl` and `atl-plugin`.

In ZCode Desktop also check:

- **Settings → Plugin Management** lists **agent-trust-ladder** as installed and enabled.
- **Settings → Skills** lists the ATL skills; the `/` menu lists the `/atl-*` commands.
- A session exposes the **ATL Control Plane** panel.

Then run the first task: ask the agent to **“Use ATL to initialize this application and open its Control Plane.”** The agent calls `atl_start` with the application's absolute path and returns the Control Plane URL. Opening the interface never starts a worker.

## Update the plugin

Finish or stop active work first — Control Plane servers and command handles live for the plugin session, and disabling or updating removes them. Use the Control Plane's stop operation for provider runs.

1. Produce (or obtain) a bundle with the newer version. The catalog records the version, and the host detects the update from it.
2. Refresh the marketplace in the host — re-select the catalog file with the **`+`** button, or use the host's marketplace refresh.
3. On the plugin's row or detail view, choose **Update**, then restart the harness or open a new session.

Project task state and evidence live in the application under `.trust/manager/`, so an update does not lose recorded work. Moving the bundle directory or the Node executable requires reconnecting (regenerate the ATL Connect snippet).

## Remove the plugin

On the **Installed** tab, open the plugin's detail view and uninstall. Components leave the session immediately. Application records under `.trust/manager/` and `config/` are not deleted — another harness can reopen the same project later.

## Troubleshoot

- **The plugin does not appear in Discover** — the marketplace was never added. Add the catalog file with the **`+`** button first.
- **Skills are missing while the plugin shows enabled** — open **Settings → Skills** and check the session actually lists them; a disabled or stale session needs a restart.
- **Connection or clone errors when adding a marketplace** — local catalogs need no network; for remote sources set `ZCODE_HTTP_PROXY` for the host.
- **`atl` is missing after the standalone runtime install** — open a new terminal so the installer-created shim is on PATH.

More symptoms and fixes: [troubleshooting](troubleshooting.md). Provider authentication and keys: [providers](providers.md). The skill catalog: [skills](skills.md).
