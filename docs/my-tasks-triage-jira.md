# My Tasks: urgency and Jira Cloud

My Tasks combines assigned Azure Boards and Jira Cloud work. Source workflow
categories determine To Do, In Progress and Done; custom state names remain visible.
Request reviews explain the requested change, expected outcome, next investigation
or development step, and supporting code evidence. They are not implementation approval.

## Urgency settings

Open **My Tasks → Settings → Analysis & Jira**. Select a GLM Flash model listed by
an existing ready ATL provider, enable background analysis and save. No new model
service is registered and there is no automatic fallback to another model. The
existing code-review provider/model stays unchanged.

Urgency is an estimated score out of 100, not a probability. Known factors are
weighted as impact 40%, timing 30%, blocking 20%, source priority 10%; missing
factors are omitted and remaining weights normalized. The result rounds to five.
Source priority alone cannot establish urgency. Evidence must quote supplied task
data; neither task age nor being In Progress establishes urgency.

Urgent = 80–100; high = 60–79; normal = 30–59; low = 0–29. Completed tasks have no
active score. Click a score for reasons, evidence, confidence, missing information
and generation time. Sorting puts valid scores first, followed by source priority
and last change. More filters contains source, priority, urgency and sorting.

The durable, serial queue uses 60-second attempts, one retry for temporary errors,
ATL capacity/quota checks and 250 attempts per UTC day by default. Settings permit
1–10000 attempts per day. Task inputs, model/provider and scoring version define
the cache; Persian and English explanations share the same numeric result. Known
deadlines are recalculated when read without another model call. Task content or
model changes retain the previous result while reanalysis is queued. Reading or
opening a task never starts an agent. Repository code is not included in triage.

## Jira Cloud connection

Use **Connect / reconnect**, then follow **Continue Jira sign-in**. The official
Atlassian MCP endpoint is `https://mcp.atlassian.com/v2/mcp?tools=all`. ATL uses the
official bundled MCP client, OAuth discovery, dynamic client registration, PKCE
and an expiring single-use state. Select an accessible site, load projects or enter
their keys, choose a sync interval and save. Jira pagination includes Done items.
Azure and Jira refresh independently; a source failure retains its last good data.

Tokens and client registration live outside repositories under ATL's connection
directory. Windows uses DPAPI; other platforms use a mode-0600 file. Disconnect
deletes the local credential and disables the connection; it does not revoke
authorization at Atlassian. Revoke the app in Atlassian to invalidate remote grants.

MCP availability depends on the Atlassian account, scopes and administrator policy.
The same Jira connection supplies `atl_jira_search`, `atl_jira_issue`,
`atl_jira_comments`, `atl_jira_transitions` and `atl_jira_preview` to ATL agents.
Arguments use JSON strings and the selected site is enforced. The plugin forwards
through the runtime so agents do not manage separate OAuth sessions.

`atl_jira_preview` supports comments, selected field edits and workflow transitions.
It never writes Jira. Review pending actions in the browser and approve or cancel
the exact preview. Previews expire after ten minutes, check the remote revision
before sending and cannot be reused. An ambiguous response becomes
`needs_reconciliation`; inspect Jira before preparing any new action. No automatic
write retry occurs. Agent MCP tools have no approval/commit operation.

## HTTP interfaces

- `GET/POST /api/my-tasks/triage/settings`; GET also returns queue status.
- `GET /api/my-tasks/triage/status` and `GET /api/my-tasks/triage?key=…&locale=…`.
- `POST /api/my-tasks/triage/retry` with `{key}`.
- `GET /api/my-tasks/jira/status`, `/sites`, `/projects?site=…`.
- `POST /api/my-tasks/jira/authorize`, `/settings`, `/sync`, `/disconnect`.
- `GET /api/my-tasks/jira/oauth/callback` handles the state-bound OAuth redirect.
- `POST /api/my-tasks/jira/read` and `/preview` support the agent tools.
- `POST /api/my-tasks/jira/commit` requires browser origin plus owner session/CSRF.

List responses include `source`, `source_priority` and a small `triage` summary.
Full reasoning is fetched separately. Local stores under
`.trust/manager/my-tasks` remain git-ignored. Existing Azure keys stay compatible;
Jira keys include source, site and remote issue ID. Repository mappings use the
same explicit project/area/item binding mechanism for both sources.

## Verification

Run `task_triage_test.mjs`, `jira_mcp_test.mjs`, `jira_oauth_test.mjs` and
`my_tasks_triage_jira_ui_test.mjs` under `verification/`. The OAuth test exercises
the actual official SDK against a local OAuth/MCP fixture. It does not prove a
particular Atlassian tenant permits the requested tools. Browser coverage uses
206 mixed tasks at 390, 820, 1024, 1280 and 1920 pixels, Persian and alternate theme.

Rebuild the shipped SDK with `node scripts/build-jira-mcp-sdk.mjs` after dependency
updates. Its source license and generated legal notices ship alongside the asset.
