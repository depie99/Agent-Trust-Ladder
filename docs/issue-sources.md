# Issue sources

Save named connections, preview issues from a selected connection, then import requests for planning. Import does not create executable queue work; the request needs a reviewed plan first.

## Add a connection

Open **Issue sources** and choose **Add source**. Select GitHub, Jira, or Azure Boards, enter a connection name and location, then save. Each GitHub connection represents one repository. You may save several connections for the same provider. New forms start empty; saved names and locations appear only in **Connected sources** and the explicit editor.

| Provider | Location | Authentication |
|---|---|---|
| GitHub | One repository URL or `owner/repository` | Authenticated `gh` CLI, `GITHUB_TOKEN`, or public read access |
| Jira | HTTPS site URL and project keys | Server environment variable, default `JIRA_TOKEN` |
| Azure Boards | HTTPS collection URL and project; optional iteration | Server environment variable, default `AZDO_PAT`, or **Connect PAT** on its saved card |

For a work item URL under `https://devops.example.invalid:32678/Collection/Project/`, enter `https://devops.example.invalid:32678/Collection` as the collection and `Project` as the project. Enter the iteration separately, for example `Project\Sprint 74`.

Saving closes the dialog and shows a notice above **Connected sources**. A failed save keeps the form and values with an inline error. Use **Check access** to verify a connection. **Pause connection** prevents previews while keeping its settings. An Azure PAT saved with **Remember securely** is protected by Windows DPAPI; a session PAT expires when the server stops. PAT values are never returned by the connection API.

Existing provider settings in `config/manager.json` appear as named connections after migration. The registry lives in `.trust/manager/issue-connections.json`; it stores locations and credential references, never tokens. Legacy CLI and My Tasks settings remain in `config/manager.json`. Removing a default connection requires pausing it or having a replacement.

## Preview and import

1. Choose **Browse issues** on a card, or select a connection in **Browse issues**.
2. For Azure Boards, optionally choose a sprint or enter a work item number or link.
3. Choose **Preview issues**. Preview creates no tasks.
4. Select the intended issues and affected repositories, then import them.
5. Open **Imported requests** to inspect source details and create a plan for each affected repository.

Imports keep the connection ID and name, remote issue identity, and revision. Deduplication uses the original remote issue identity, so finding the same issue through another connection does not create another request.

## Troubleshooting

Check the card's access status, enabled state, URL, project/repository, token availability, and network access. Reconnect a session Azure PAT after server restart. Jira intake does not imply Jira writeback; plan publishing currently targets GitHub and Azure.

Implementation: `runtime/lib/issue-connections.mjs`, `intake.mjs`, `composer.mjs`, and source routes in `control-plane-server.mjs`. Run `node verification/issue_connections_test.mjs` and `node verification/issue_source_ui_journey_test.mjs` from the clone.
