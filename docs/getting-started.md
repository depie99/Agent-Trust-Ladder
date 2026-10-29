# Getting started

Open a local ATL project and create your first reviewed task. Skills provide engineering instructions; the runtime stores and coordinates work. Install them separately as needed.

## Prerequisites

Use Node.js 22 or newer and Git. Provider execution additionally needs a supported installed CLI or a configured API provider. Python is used by repository policy verifiers. Browser verification uses Playwright and its installed browser.

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

If `atl` is missing, open a new terminal or use the installer-created shim. If the port is occupied, choose another port. Fix provider installation/authentication before repeating preview. See [troubleshooting](troubleshooting.md) and [providers](providers.md).
