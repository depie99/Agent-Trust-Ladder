---
name: atl-plugin
description: "Set up and use the complete bundled ATL plugin: persistent tasks, provider execution, Control Plane and engineering workflows inside a supported harness, without installing ATL separately. Use for ATL plugin setup, runtime operations and dashboard requests."
---

# Full ATL in the current harness

Use the bundled tools (their names may have a host prefix). Call `atl_info` to discover the installed bundle, then `atl_skill` with `name: "atl"` to load the workflow router. Supporting references are read with `atl_skill(name, file)` only when needed. Native skill discovery and this tool expose the same source files; do not load both copies.

Ask for the application path only when the active workspace does not identify it. Every runtime call takes its **absolute project path**; the plugin install directory is never the application. Never initialize a project merely because this skill loaded.

For authorized setup or a dashboard request, call `atl_start` with `project`. It prepares missing project state, preserves existing state and returns the full Control Plane URL in one step. Give the user a clickable URL and open it using the host's browser capability when requested. Starting the UI does not start workers. Lower-level `atl_command` and `atl_control_plane` remain available for explicit operations and diagnostics.

For connection help, call `atl_connect` and open its returned URL. Before a harness is connected, the same assistant can be started with `runtime/atl-connect.mjs` (also `start.cmd` / `start.sh` in generated packages). This local, bilingual connection assistant provides host-specific configuration snippets, a generic MCP profile, copy/download controls and an explicit project-opening flow. It never overwrites harness settings. Use native plugin installation when supported; otherwise configure the shared stdio MCP bridge. Do not claim that a web chat or HTTP-only client supports local stdio tools.

All runtime commands are available through `atl_command`: supply individual argv strings, omit the leading `atl`, preserve argument boundaries, and use `atl_job` to observe completion. For example, `atl show` becomes `args: ["show"]`; `atl launch --dry-run` becomes `args: ["launch", "--dry-run"]`. Use `args: ["--help"]` for the installed command contract. Commands shown in role prompts use the same translation. The bridge invokes the bundled CLI directly; do not ask the user to install ATL, change PATH, or install these skills separately.

The plugin includes the runtime and skills, not provider credentials or external CLIs. An interactive DeepSeek, Cursor or other host session does not automatically register that host as an unattended ATL worker. Check provider readiness and choose a supported installed worker or configured API provider before executing tasks. Do not silently switch providers, reuse credentials from another host, or imply worker support from plugin compatibility.

Host authorization, ATL actor contracts, preview/review gates and execution budgets still apply. A plugin installation is not authorization for task execution, external writes or delivery. Never add `--confirm` without the user's execution authorization. Treat a background job handle as work in progress, not evidence of success. Provider runs can be stopped through the Control Plane; avoid terminating the harness as a stop mechanism.

The Control Plane and command job handles belong to the plugin session. Finish or stop runs before unloading. Task state, evidence and project configuration persist in the application, so a new session resumes from those records. Uninstalling the plugin does not delete project state.
