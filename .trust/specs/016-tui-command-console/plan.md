# Plan — 016 bounded interactive TUI command console

Spec: approved 2026-10-22 by the user's request · Dose: Standard

The current control room can mutate queue and recovery state, but it cannot
invoke the explanatory CLI surface (`atl why`) or display its full output
within the terminal frame. This slice makes the TUI a useful, bounded ATL
operator surface: a command console dispatches an allowlisted subset of ATL
commands through the existing runtime functions, and every result is rendered
as wrapped, scrollable TUI content.

Interaction assumptions are explicit and reversible: `:` opens the command
console, `w` runs `why` for the selected task, and Enter submits the current
command. The initial command set covers diagnosis and safe/reversible control
operations; provider execution remains behind the existing launch preview and
confirmation gate.

## Approach and key decisions

1. Add a small internal TUI command adapter with a registry and structured
   results; do not invoke `atl` as a child process and do not evaluate shell
   text.
2. Reuse `explainTasks`, `unblockTask`, `approveTask`, queue functions,
   `buildLaunchPlan`, feedback functions, and existing renderers so state
   authority and audit behavior remain unchanged.
3. Add a command-console screen with single-line editing, history, basic
   completion/help, and a bounded output buffer.
4. Wrap and clip every output row to the current panel width, then page it with
   arrows, Page Up/Down, Home, and End; long `atl why` evidence never escapes
   the TUI frame.
5. Route `launch --confirm` to the existing launch screen rather than starting
   a provider session from the command line; Enter/y remains the final gate.
6. Preserve human-owned capability and authority blockers: the console can
   explain them and surface the manager action, but cannot manufacture access,
   credentials, or owner approval.
7. Keep the CLI contract stable while adding parity tests for the shared
   underlying operations and the new TUI-only presentation layer.

### Key decisions

| Decision | Rationale | Alternatives considered |
|---|---|---|
| Internal allowlisted dispatcher | Prevents quoting/shell-injection problems, avoids recursive `atl ui` processes, and keeps TUI mutations on the same state modules. | Spawn the CLI as a subprocess; rejected because output parsing and failure ownership would be brittle and unsafe. |
| `:` command console plus `w` quick action | Supports both power users and the immediate blocked-task recovery question without adding a crowded permanent toolbar. | Add one key per CLI command; rejected because it does not scale and worsens the current space problem. |
| Structured result lines with viewport scrolling | Makes diagnostics readable on narrow terminals and testable without relying on terminal scrollback. | Print raw stdout into the terminal; rejected because it is the reported failure mode. |
| Launch commands stop at preview | Retains the existing explicit spend/provider/workspace confirmation boundary. | Let console text execute `--confirm`; rejected as an unsafe bypass of the current control-room contract. |

## Impact

- **User experience:** blocked tasks can be diagnosed in place; the selected
  task's full `why` report, fix command, and blocker classification stay inside
  the frame and can be scrolled/copied.
- **Runtime:** a new command adapter and a new TUI screen are added. Existing
  `state.json`, `queue.json`, feed, recovery, and launch contracts remain the
  authorities; no new persistence format is required.
- **Safety:** only registered commands are accepted. Unknown commands and bad
  arguments become visible in the console. `unblock` and `approve` retain their
  existing authority requirements, and launch remains explicitly confirmed.
- **Compatibility:** `atl why` and all current CLI commands remain available.
  The TUI adds a second presentation path over existing operations rather than
  changing command-line output.
- **Files likely touched:** `runtime/lib/command-console.mjs` (new),
  `runtime/lib/dashboard.mjs`, `verification/tui_command_console_test.mjs`
  (new), `verification/dashboard_test.mjs`,
  `verification/control_room_ui_test.mjs`, `runtime/README.md`, and `USAGE.md`.

## Pre-mortem

| Failure mode | Earliest warning sign | Mitigation |
|---|---|---|
| TUI and CLI behavior diverge | `why` or queue results differ depending on entry point | Dispatch through the existing runtime functions and assert state/evidence/queue results in temp-root tests. |
| Free text accidentally becomes shell execution | A command path accepts arbitrary executable names or shell metacharacters | Use a fixed command registry, token parser, argument validation, and no `exec`/subprocess call in the dispatcher. |
| Long diagnostics still overflow or disappear | A narrow-width test contains lines wider than the panel or loses the blocker tail | Normalize output to plain logical lines, wrap at render time, clip to height, and test width/scroll invariants at 60 and 120 columns. |
| A command bypasses an irreversible gate | `launch --confirm` starts a worker while the console is active | Return a launch-screen effect from the dispatcher; only the existing launch screen's Enter/y handler may call `runQueuedLaunch`. |
| Dirty project state contaminates verification | Tests depend on the current `.trust/manager` portfolio or mutate the working tree | Build command-console tests in isolated temporary project roots, preserve unrelated dirty files, and run the existing regression suite unchanged. |

## Constitution compliance

- **State authority:** compliant. Console mutations use the existing state,
  queue, recovery, feedback, transition, feed, and launch modules; no direct
  ad-hoc JSON mutation is introduced.
- **Evidence and auditability:** compliant. Existing manager events and feed
  narration remain the record for mutations; read-only commands do not invent
  state changes.
- **Containment:** compliant. The console never starts a provider process and
  cannot bypass launch confirmation, workspace checks, budgets, or human gates.
- **Secrets and inputs:** compliant. Provider keys are not accepted by the
  console command grammar, and command text is parsed as data rather than shell
  syntax.
- **UI contract:** compliant. All output is width/height bounded, scrollable,
  and available in plain rendering for deterministic tests.
- **Recorded exception:** none.

## Tasks

- [ ] T1 Define the allowlisted TUI command contract and structured dispatcher — files: `runtime/lib/command-console.mjs` (new), `runtime/lib/recovery.mjs`, `runtime/lib/queue.mjs`, `runtime/lib/feedback.mjs`, `runtime/lib/launch.mjs` — verify: `node verification/tui_command_console_test.mjs` — done when: `why [task-id]`, `show [task-id]`, `wake`, `brief`, `feed`, `queue list|add|remove|clear`, `unblock`, `approve`, `feedback add`, and `launch --dry-run` have validated internal handlers returning structured success/error/effect results, unknown commands are rejected, and no handler invokes a shell command.
- [ ] T2 Add the bounded command-console UI and input state — files: `runtime/lib/dashboard.mjs` — verify: `node verification/control_room_ui_test.mjs` — done when: `:` opens a single-line command editor, Enter submits, Up/Down recall history, Tab or `?` exposes registered command help/completion, errors remain in the console, and output is rendered within the current width/height with keyboard scrolling and mouse-selection compatibility.
- [ ] T3 Make blocked-task diagnosis first-class inside the dashboard — files: `runtime/lib/dashboard.mjs`, `runtime/lib/recovery.mjs` — verify: `node verification/dashboard_test.mjs` — done when: the dashboard advertises `w why`/`:`, the selected blocked task can open `why <id>` directly, the full blocker/fix text is wrapped and scrollable, and capability/authority blockers still show the manager action without offering unsafe automatic unblocking.
- [ ] T4 Connect command effects to existing TUI screens and refresh behavior — files: `runtime/lib/dashboard.mjs`, `runtime/lib/command-console.mjs` — verify: `node verification/tui_command_console_test.mjs` — done when: successful mutations refresh the snapshot and notices/feed consistently, `queue` and recovery actions remain idempotent, `launch --dry-run` opens or renders the existing preview, and `launch --confirm` can only transition to the existing confirmation/run path rather than spawning directly.
- [ ] T5 Add regression coverage for command parity, layout safety, and negative gates — files: `verification/tui_command_console_test.mjs` (new), `verification/dashboard_test.mjs`, `verification/control_room_ui_test.mjs` — verify: `node verification/tui_command_console_test.mjs` — done when: isolated temp-root tests cover read-only output, queue/recovery mutations, unknown-command rejection, human-action blockers, narrow-width wrapping, output scrolling, and the no-provider-spawn/no-confirmation-bypass invariant.
- [ ] T6 Document the in-TUI command surface and recovery workflow — files: `runtime/README.md`, `USAGE.md` — verify: `rg -n "command console|w why|atl why|launch --confirm|human" runtime/README.md USAGE.md` — done when: users can discover `:`, `w`, supported command examples, scrolling/copy behavior, and the distinction between team-recoverable blockers and manager-owned access/authority gates.
- [ ] T7 Run the complete verification gate and record evidence — files: `verification/tui_command_console_test.mjs`, all existing `verification/*.mjs` and `verification/*.py` — verify: `Get-ChildItem verification -Filter *.mjs | ForEach-Object { node $_.FullName }` and `Get-ChildItem verification -Filter *.py | ForEach-Object { python $_.FullName }` — done when: the new tests and all existing lifecycle, control-room, recovery, feedback, worker, install, and model checks pass without modifying unrelated worktree changes.

## Verification plan

1. **Command contract:** use an isolated temporary ATL project to execute each
   registered command through the adapter, assert structured output and state
   effects, and prove unknown input cannot reach a subprocess.
2. **Why overflow regression:** create a blocker containing the long EPERM / Git
   checkout evidence seen in the queue screenshot; render at narrow and normal
   widths; assert every visible row is bounded, the complete reason and fix are
   reachable by scrolling, and no raw terminal escape sequence is required in
   plain mode.
3. **Interactive flow:** exercise `:` submission, command history, `w` quick
   action, error display, queue mutation, and return-to-dashboard refresh using
   the existing UI test seams.
4. **Safety gates:** assert `launch --dry-run` only previews and
   `launch --confirm` from the console only opens the existing confirmation
   screen; assert capability/authority blockers remain classified as
   human-action and still require the manager.
5. **Regression:** run the complete JavaScript and Python verification suites,
   then inspect `git diff --check` and the final worktree status so this slice
   does not overwrite the user's unrelated changes.

Suggested next mode: `implement`.
