# ATL Control Plane documentation brief

## Decision

Create a web-first documentation family for the browser-native **ATL Control
Plane**. Update the public GitHub Pages navigation, repository README, package
README content, and operator guides to call `atl ui` / `atl control-plane` the
browser-native interface. Reserve `atl tui` for the terminal compatibility
surface and do not document its interaction model in this change.

## Reader contract

| Item | Decision |
| --- | --- |
| Primary audience | An ATL project owner who wants to use the browser interface safely. |
| Primary goal | Start the local web Control Plane, understand its spaces, create/review work, configure a provider, preview a run, and explicitly start or stop it. |
| Prerequisites | Node 22+, ATL installed, and an initialized project. A provider is needed only to execute a run. |
| Expected result | The reader can operate the web interface without confusing a preview with execution or a built-in Codex subscription with an API-key provider. |
| In scope | `atl ui`, browser spaces, command palette, task and queue workflow, Plan Studio, local provider status, Codex subscription sign-in, safe previews, and CLI equivalents. |
| Out of scope | Terminal-TUI UX, keyboard maps for `atl tui`, undocumented provider integrations, deployment of the localhost web server, and guarantees about a provider's quota. |

## Technical truth observed

- `atl ui` and `atl control-plane` start a browser-native server on `127.0.0.1`.
- `atl tui` / `atl dashboard` remain terminal compatibility commands.
- Browser API routes provide snapshots, task commands, launch preview/confirm,
  safe stop, provider management, navigation, Plan Studio, and optional usage
  refresh.
- Queue execution requires a preview and explicit `confirm: true`; a second run
  is rejected while a run is active.
- `codex` is a built-in provider. It uses ChatGPT subscription login; it is not
  added through the API-provider registry. `codex login` and `codex login
  status` are the supported CLI checks.
- User-managed API providers are stored outside the repository in
  `~/.atl/providers.json`; their keys must be masked in documentation and UI
  examples.

## Documentation architecture

```text
GitHub Pages
  Overview ──► Web Control Plane (new entry page)
                  ├── Get started in the browser
                  ├── Spaces: Overview, Tasks, Plan, Queues, Team, Activity,
                  │   Usage, Settings
                  ├── Create → review → queue → preview → confirm workflow
                  ├── Providers and Codex subscription sign-in
                  ├── Run safety, stop behavior, and recovery
                  └── CLI equivalence reference
  Existing terminal Control Room ──► short compatibility notice only

Repository / package
  README ──► web-first quickstart + GitHub Pages guide link
  USAGE / runtime README ──► exact CLI commands and recovery paths
```

## Planned public pages and artifacts

| Artifact | Reader question it answers | Source of truth |
| --- | --- | --- |
| `docs/web-control-plane.html` | “How do I use ATL in the browser?” | `runtime/atl-manager.mjs`, `runtime/lib/control-plane-server.mjs`, `runtime/control-plane-client.js` |
| `docs/diagrams/atl-web-control-plane.svg` | “Which browser spaces and safety gates lead to a run?” | same sources plus `runtime/lib/control-plane.mjs` |
| `docs/diagrams/atl-web-control-plane-preview.svg` | “What will I see before execution?” | rendered local Control Plane, labeled as a local example rather than live data |
| `docs/control-room.html` | “Where did the terminal guide go?” | Short compatibility pointer to the web guide and CLI reference |
| `README.md`, `USAGE.md`, `runtime/README.md` | “What command opens the supported interface?” | CLI usage in `runtime/atl-manager.mjs` |
| `docs/sync.yml` | “What documentation revision covers the web Control Plane?” | verified docs diff and checks |

## Visual contract

The web guide will use two accessible visuals, not decorative screenshots:

1. A left-to-right workflow SVG: **draft → review → queue → preview → explicit
   confirmation → bounded run → evidence/recovery**. It distinguishes
   information views from authority-changing actions.
2. A responsive browser-surface preview annotated with the eight current
   spaces and the localhost/private-data boundary. It will be created only
   after a local Control Plane render is observed.

Each visual will include a title, description, visible labels, a nearby text
equivalent, and an update trigger: changes to browser navigation, API routes,
or execution gates.

## Examples to verify before publication

```powershell
# Start the browser-native Control Plane from an initialized project.
atl ui

# Equivalent explicit name; choose a fixed local port when useful.
atl control-plane --port 4187

# Inspect execution without starting it.
atl launch --dry-run

# Codex subscription setup — no API key or `atl provider add` required.
codex login
codex login status
```

The final documents will use the Windows-safe `atl.cmd` fallback where a
PowerShell execution policy blocks `atl.ps1`.

## Publication and verification plan

- Update every shared docs sidebar and search index with the new web guide.
- Run the repository docs checker and link/anchor checks.
- Parse and visually inspect each new SVG at desktop and narrow viewport.
- Start the actual browser Control Plane against a disposable initialized
  project; verify navigation, provider status, preview, confirmation gate, and
  stop control without launching a provider session.
- Run the focused Control Plane and provider tests already present in
  `verification/`.
- Advance `docs/sync.yml` only after the checks succeed.

The visual companion set now includes `docs/diagrams/atl-web-control-plane-preview.svg`, a sanitized representative browser surface derived from the standalone Control Plane client. It is documentation art, not a live screenshot; review it when navigation, major layout, API routes, or execution gates change.

## Open owner choice

The public documentation must show either a **sanitized representative Control
Plane preview** or a **neutral annotated schematic only**. A real local render
is preferable, but it can expose project/task names unless sanitized.
