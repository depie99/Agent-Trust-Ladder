# Repository working agreement

For every ATL change, inspect and update each shipped surface affected by the behavior: browser Control Plane, terminal dashboard and CLI, bundled plugin and harness entry points, and user documentation. Shared runtime code may cover several surfaces, but confirm that each package actually consumes it. Keep generated docs and plugin artifacts aligned with their sources when the change affects them.

For credential entry, provide a masked default and a deliberate reveal control in graphical and terminal prompts. Prefer interactive hidden CLI prompts or environment-variable references over secrets in command arguments. Keep secrets out of logs, persisted connection metadata, browser storage, and screenshots. Record which surfaces were covered in the change handoff.
