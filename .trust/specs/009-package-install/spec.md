# Spec — 009 installable ATL package

Status: approved by explicit implementation request · 2026-10-21

## Behavior

1. A user can install the package/CLI into a user-level location and run
   `atl init` in any target project.
2. `atl init` creates only project state/config and does not vendor third-party
   skills or create `.humanlayer` directories.
3. The package preview contains the CLI, runtime, native skills, config, and
   verification assets needed by the installer.
4. GitHub Packages publication is explicit, permissioned, and verifiable; no
   publish occurs during local tests.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| a clean target project | user runs `atl init` | project-local `.trust/manager` and config are created |
| an ATL install | user runs `atl show` from another project | the installed CLI manages that project's state |
| package workflow | a tag/release is published | package checks run before `npm publish` |
| target repo | install completes | no `.humanlayer` or third-party skill directory is added |
