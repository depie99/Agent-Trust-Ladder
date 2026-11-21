---
name: atl-plugin
description: "Set up and use the complete bundled ATL plugin: persistent tasks, provider execution, Control Plane and engineering workflows inside a supported harness, without installing ATL separately. Use for ATL plugin setup, runtime operations and dashboard requests."
---

# Full ATL in the current harness

For “Open ATL” (or `atl-open`), select the current application workspace, call
`atl_start` and open its returned URL with the harness browser capability; if no
browser capability is available, provide the clickable URL. The browser presents
the complete shared Control Plane. ZCode means Z.ai's ZCode, not Zed. Use its
native bundle when available. In ZCode Desktop versions with UI Plugin support,
open the installed **ATL Control Plane** session panel directly. It binds the
current local workspace and shows the complete Control Plane inside the app
without a model turn, `@` mention, or slash command. Older hosts can use the
browser URL. Opening either interface does not launch workers.
Plugin updates carry the matching Control Plane snapshot; `atl_info` exposes its
release fingerprint. Never repair an installed bundle by downloading a separate
runtime or editing packaged UI files: update or rebuild the full plugin instead.

Use the bundled tools (their names may have a host prefix). Call `atl_info` to discover the installed bundle, then `atl_skill` with `name: "atl"` to load the workflow router. Supporting references are read with `atl_skill(name, file)` only when needed. Native skill discovery and this tool expose the same source files; do not load both copies.

Ask for the application path only when the active workspace does not identify it. Every runtime call takes its **absolute project path**; the plugin install directory is never the application. Never initialize a project merely because this skill loaded.

For authorized setup or a dashboard request, call `atl_start` with `project`. It prepares missing project state, preserves existing state and returns the full Control Plane URL in one step. Give the user a clickable URL and open it using the host's browser capability when requested. Starting the UI does not start workers. Lower-level `atl_command` and `atl_control_plane` remain available for explicit operations and diagnostics.

For connection help, call `atl_connect` and open its returned URL. Before a harness is connected, the same assistant can be started with `runtime/atl-connect.mjs` (also `start.cmd` / `start.sh` in generated packages). This local, bilingual connection assistant provides host-specific configuration snippets, a generic MCP profile, copy/download controls and an explicit project-opening flow. It never overwrites harness settings. Use native plugin installation when supported; otherwise configure the shared stdio MCP bridge. Do not claim that a web chat or HTTP-only client supports local stdio tools.

All runtime commands are available through `atl_command`: supply individual argv strings, omit the leading `atl`, preserve argument boundaries, and use `atl_job` to observe completion. For example, `atl show` becomes `args: ["show"]`; `atl launch --dry-run` becomes `args: ["launch", "--dry-run"]`. Use `args: ["--help"]` for the installed command contract. Commands shown in role prompts use the same translation. The bridge invokes the bundled CLI directly; do not ask the user to install ATL, change PATH, or install these skills separately.

The plugin includes the runtime and skills, not provider credentials or external CLIs. An interactive DeepSeek, Cursor or other host session does not automatically register that host as an unattended ATL worker. Check provider readiness and choose a supported installed worker or configured API provider before executing tasks. Do not silently switch providers, reuse credentials from another host, or imply worker support from plugin compatibility.

Host authorization, ATL actor contracts, preview/review gates and execution budgets still apply. A plugin installation is not authorization for task execution, external writes or delivery. Never add `--confirm` without the user's execution authorization. Treat a background job handle as work in progress, not evidence of success. Provider runs can be stopped through the Control Plane; avoid terminating the harness as a stop mechanism.

The Control Plane and command job handles belong to the plugin session. Finish or stop runs before unloading. Task state, evidence and project configuration persist in the application, so a new session resumes from those records. Uninstalling the plugin does not delete project state.

## Plan and orchestrate from harness chat

When the developer asks to plan an issue in chat, use `atl_plan_context` with the explicit project and resolve the requested issue, repository and base revision from their message and current workspace. Show that target before approval. Ask once which clarification mode they want: every uncertainty, consequential questions (default), or broad defaults. Request, project, then personal preference takes precedence. Under the default, investigate facts, decide routine details, persist assumptions, and ask only unresolved consequential questions. Keep questions and answers in chat; save each meaningful revision with `atl_plan_save` so Plan Studio shows the same artifact. The current harness assistant authors the plan; do not call a separate paid planning model unless requested.

Use the existing ATL review policy and exact-revision approval. Plan approval creates canonical queue tasks but starts no workers. Present `atl_run_preview` with its exact tasks and resource limits and obtain separate approval before `atl_run_start`. For larger work, approve the overall program contract and budgets, bind reviewed plan queues to dependency-linked project milestones, then explicitly authorize the program run. The persistent local runtime owns approved work after chat closes. Check `atl_program_status` for the morning report. After an interruption, inspect the affected task/workspace and resolve every uncertain dispatch with `atl_program_reconcile`; never replay unknown effects automatically. Bootstrap an unborn repository only after explicit authorization, and do not stage developer files or choose the project stack on the developer's behalf.
