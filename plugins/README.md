# ATL harness distribution

## Full Control Plane release contract

Use **Open ATL** (`atl-open` where the host exposes commands), or ask the assistant
to open ATL for the current repository. The shared `atl_start` tool returns the
full browser Control Plane; the host opens the URL or presents a clickable link.
No separate ATL package installation is required. Node and provider credentials
remain prerequisites. Opening the interface never authorizes a worker run.

Every harness panel opens the same bundled Control Plane, including the shared
masked token fields and Show/Hide controls. Provider keys entered from a CLI
prompt are hidden by default; Ctrl+R temporarily reveals or masks the current
input. Keep these credential-entry behaviors aligned across hosts when updating
the runtime.

ZCode (Z.ai) packages declare a persistent `ATL Control Plane` session panel.
Opening that panel starts the bundled Control Plane for the selected local
workspace and displays its complete existing UI in the app. No `@` mention,
slash command, model turn, or separate ATL installation is needed. The same
stdio tools and browser URL remain available. Native panels require a ZCode
Desktop release with UI Plugin support; older releases can still use the tools
and browser route. Real desktop rendering must be checked on a compatible host.

Every package contains `atl-release.json`: plugin version, runtime version and a
SHA-256 manifest of the shared runtime, skills, commands, config, verification,
documentation and adapters. The builder compares each output with the source
snapshot; startup verifies installed content, and `atl_info` exposes its identity.
`npm run plugins:test` also rejects changed or missing assets. This is an integrity
and parity check, not a cryptographic signature of the publisher.

Production dependencies are copied from the lockfile into each plugin and declared
as npm bundled dependencies, so installed archives require no `npm install`.
Release manifest format 3 fingerprints these dependency files and the compiled
native panel asset separately from the shared sources. Missing or changed files
fail verification. Development
dependencies, including Playwright, remain outside the distributed package.

All Control Plane changes must ship through these shared sources. A feature must
remain reachable from the packaged UI and include an appropriate packaged-runtime
regression check. Do not maintain a separate plugin UI. Release all host bundles
from the same snapshot; updates use each host's normal plugin update process,
without independently downloading a different runtime.

Real Codex, DeepSeek and ZCode installation/discovery/browser observations remain
release requirements. Contract fixtures and local HTTP tests do not establish
those host observations.

The full plugin bundles the existing runtime and skills. `scripts/build-plugins.mjs` produces six native host packages and a universal MCP bundle from those sources; it does not install ATL, alter PATH, register a user marketplace, or launch workers. See [plugin setup](../docs/getting-started.md#use-the-complete-plugin) for installation and usage.

## Harness-native planning and programs

When a developer asks to plan work in chat, the current harness assistant authors the plan. Use `atl_plan_context` to inspect the explicit project, repository, branch, source issue and saved clarification preference. Resolve the target from the request and repository evidence, show it in chat, ask only consequential unresolved questions by default, and persist draft revisions with `atl_plan_save` as the conversation progresses. The personal clarification preference is asked once; request and project choices override it. Questions and answers remain in chat and are stored in the same revisioned Plan Studio artifact. Use `atl_plan_review` and `atl_plan_approve` for existing policy review and exact-revision approval. Approval creates queue tasks but does not start workers.

Before execution, present `atl_run_preview` including the selected queue/tasks and limits, then call `atl_run_start` only after approval of that exact preview. The persistent local project daemon owns the run, so closing the harness does not cancel approved work. `atl_run_status` and `atl_program_status` provide durable status. For multi-repository work, approve the program outcome and limits, bind each milestone only to a reviewed queue, and start through `atl_program_start`. If runtime restart leaves dispatch effects uncertain, inspect each affected project and use `atl_program_reconcile` with evidence before authorizing another run. Empty repositories require explicit `atl_project_bootstrap`; it creates only an empty base commit and does not choose a stack or stage developer files.

Execution uses the local backend. `runtime/lib/execution-backend.mjs` defines the boundary a future remote backend must implement for workspace preparation, dispatch, observation, cancellation, reconciliation and artifact retrieval. Remote worker authentication, isolated credentials, network policy, quotas and provisioning are not implemented by this release. CLI users can inspect programs with `atl program list` / `atl program show`; `atl harness <operation> request.json` exposes the shared JSON operations for terminal automation.

## Connection experience

`runtime/atl-connect.mjs` serves the local bilingual connection assistant included in every package. `atl_connect` opens it from a connected harness; generated `start.cmd` / `start.sh` entry points serve first-time setup. `runtime/lib/harness-catalog.mjs` owns connection profiles independently of worker providers. Its generic stdio profile permits other local MCP tool hosts without forking the runtime. Gemini additionally receives `gemini-extension.json` and a minimal `GEMINI.md` workflow entry point.

The assistant provides searchable selection, snippets using the actual Node/bundle paths, copy/download controls, project setup and a direct Control Plane link. It never replaces harness settings. Its only mutation endpoint calls `atl_start` for an explicit absolute application folder, requires an exact loopback Host and Origin plus a per-session token, and does not enable CORS. `atl_start` preserves initialized state and does not run workers. Unloading closes both the connection assistant and its owned Control Planes. Move the bundle or Node installation only after regenerating connection settings.

Profiles are documented schema contracts, not observed installations. Browser-only chats and HTTP-only clients cannot consume this stdio bridge directly. Do not equate generic connection support with a new worker provider or tested marketplace compatibility.

## Shared execution boundary

`runtime/lib/plugin-host.mjs` implements discovery, skill/reference reading, CLI jobs and Control Plane lifetime. `runtime/atl-plugin-mcp.mjs` exposes those operations over stdio for Codex, Claude Code and Cursor. `plugins/deepseek.mjs` registers the same operations directly through Cordis's public raw JSON Schema `ToolDefinition` contract. DeepSeek therefore needs neither an MCP adapter plugin nor another copy of dsh-tools.

Every runtime operation requires an explicit absolute application path and invokes the bundled CLI using Node and an argv array. The bridge overwrites inherited `ATL_PROJECT` for the child. It rejects its own installation directory and never initializes from the MCP process's working directory. Host permissions still own authorization; this bridge is not a filesystem sandbox.

Each Control Plane runs in its own child process because the existing execution engine has process-global run and abort controls. Sharing one imported server module between applications would share those controls. UI and CLI jobs use the same bundle and application state; no user configuration or execution engine is forked per harness. Unloading closes owned processes; state recovery and task evidence remain the existing runtime's responsibility. Stop active runs before unloading.

## Package contracts

| Contract | Expected behavior | Verifier / observation | Owner | Containment |
|---|---|---|---|---|
| Source | One runtime, skill tree and host API | Build copies source; contract test reads packaged skills | ATL | Change the shared source, not generated copies |
| Host configuration | Host-specific manifest and MCP root resolution; native DSH bundle entry | Generated entry paths are launched; native ToolDefinitions are registered in a Cordis contract fixture | Harness adapters | Keep targets separate; do not reuse another host's root token |
| Artifact | Runtime, contracts, UI assets, skills and native adapter survive packing without install scripts | `npm run plugins:test` packs and extracts the DSH archive and executes from it | Distribution builder | Refuse pre-existing output directories |
| Project boundary | Explicit application selection; state stays outside the plugin | Fresh application, inherited `ATL_PROJECT`, installation-directory rejection and second-project checks | Shared bridge | No implicit initialization; durable records stay in the application |
| Execution | Existing role/evidence gates and bounded provider engine work from the bundle | Lifecycle rejection, preview without spawn, confirmed synthetic provider execution and observed output | ATL runtime | Existing budgets, leases, review and recovery contracts |
| Consumer | Real harness loads and exposes the package under its own permission rules | Actual host installation / discovery smoke check | Harness release owner | Do not claim marketplace compatibility from a handshaking bridge alone |

The first five contracts have executable local checks. The last contract needs host-specific release observations; a generated manifest and a contract fixture are not a successful DeepSeek desktop load. CI runs the distribution verifier on Windows and Linux, but a local Windows result does not claim an observed Linux result.

## Release checks

Run `npm run plugins:test`, build into a fresh output directory, then load each target in its actual harness and verify discovery, first setup, skill references, a bounded provider run, UI restart and permission handling. The plugin does not add Cursor or DeepSeek as unattended worker backends: that requires a separately specified provider adapter. Marketplace publication is separate from building and testing local packages.

The manifest source version is `.codex-plugin/plugin.json`; generated packages expose that version through `atl_info`. Runtime package versioning remains separately owned by `package.json`. Build outputs are ignored under `dist/`; keep execution records out of public archives.
