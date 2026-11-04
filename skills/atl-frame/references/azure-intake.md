# Azure Boards intake without the Control Plane

The bundled `scripts/azure-intake.mjs` helper reads Azure Boards work items through the same normalized candidate shape used by the Control Plane. It is read-only: it never creates, updates or closes an Azure work item.

## Live preview

Create `azure-intake.json`:

```json
{
  "org_url": "https://dev.azure.com/your-collection",
  "project": "Project name",
  "iteration_path": "Project name\\Sprint 1",
  "token_env": "AZDO_PAT",
  "repository": "owner/repository"
}
```

Set the named token only in the host environment, then run:

```sh
node scripts/azure-intake.mjs preview azure-intake.json --output azure-intake-preview.json
```

The output records the project, work-item ID, remote revision, URL, priority and objective. It never writes the token. Missing or expired authorization is a blocked source condition, not an empty result.

## Frozen export

When the host has no connector or network access, export the work-item JSON from Azure and normalize it:

```sh
node scripts/azure-intake.mjs from-export work-items.json \
  --org-url https://dev.azure.com/your-collection \
  --project "Project name" \
  --iteration-path "Project name\\Sprint 1" \
  --repository owner/repository \
  --output azure-intake-export.json
```

An export is a frozen snapshot. Its `source.frozen` flag and redacted output must remain visible; do not describe it as current live sync.

## Reconciliation

Use `source.url` and `remote_id` to match work items. An unchanged remote revision does not create a duplicate task. A changed revision is reconciled only when it is safe; an in-progress, in-review or verifying task is preserved for owner review rather than overwritten.

The helper produces task candidates and a deterministic reconciliation report. The normal framing, plan, execution and delivery contract still applies. Importing a task grants no Azure write authority and does not create a PR, merge or deployment.
