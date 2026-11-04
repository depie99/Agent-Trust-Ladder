# Sprint 74 intake record — Middleware-and-Portals

Read on 2026-11-04 from the live Azure DevOps taskboard for
`Solico-Group/Middleware-and-Portals`, iteration `Middleware-and-Portals\Sprint 74`.
The read covered the sprint backlog grid and each of the 26 work item pages.
Nothing was written back to Azure.

## What this record is, and what it is not

This is a **frozen snapshot**, not a revision-bound sync. Every item is stored with
`System.Rev = null` because the browser session could not call the Azure REST
endpoints: the automation bridge blocks `_apis/*` requests
(`ERR_BLOCKED_BY_CLIENT`), and the page context has no `fetch` or `XMLHttpRequest`.
Only the rendered work item pages were readable.

That distinction matters for ATL. A snapshot can seed an intake preview and a
pilot, but it cannot prove that a work item is unchanged since the read, and it
cannot be used for the revision guard that blocks publishing over a remote edit.
To get revisions, set `AZDO_PAT` (Work Items: Read) and run the live check; the
command is at the end of this record.

## Sprint contents

26 items: 25 in `New`, 1 in `Done` (6294). Types: 21 Task, 2 Bug, 2 Feature,
1 Product Backlog Item. 11 items have an assignee; 15 are unassigned.

| Id | Type | State | Assignee | Child | Description | Title |
| --- | --- | --- | --- | --- | --- | --- |
| 6352 | Task | New | - | - | 5006 chars | Admin Panel: Sales Tours Report |
| 6348 | Task | New | - | - | 5769 chars | Visit Dependency, Multiple Edits, Empty Drafts, ATP Check, and Draft UI Presentation |
| 6346 | Task | New | Sanaz Baghban | 6347 To Do | **none** | TTac improvements |
| 6345 | Task | New | - | - | 3859 chars | Visit List Validation, Draft Cart Inventory Concurrency, and Order Edit Restrictions |
| 6339 | Task | New | - | - | 4635 chars | Tour & Draft Improvement and Draft |
| 6338 | Task | New | - | - | 4653 chars | Inventory Management & Order Validation Failures |
| 6337 | Product Backlog Item | New | - | 6351 In Progress | 6555 chars | Add Initial Credit Filters to Blocked Sales Documents |
| 6336 | Bug | New | Shahriyar Tavakoli | - | 1350 chars | Table scrolling breaks with Infinite Scroll and Load More pagination |
| 6342 | Feature | New | - | - | **none** | S2H - Features |
| 6311 | Bug | New | - | 6353 In Progress | 1047 chars | City Detection Bug in Customer Self-Registration |
| 6340 | Feature | New | - | - | 44 chars | S2H - Bugs |
| 6294 | Task | Done | Shahriyar Tavakoli | 6313 Resolved | 167 chars | S2H - Add link to Banner |
| 6257 | Task | New | - | - | 1543 chars | Enhance Customer Registration Feature |
| 6256 | Task | New | - | - | 1114 chars | Fix Industry Order Priority & Sales Area Persian Description in Customer Registration |
| 6146 | Task | New | - | - | 1039 chars | Enable Access to "Articles" and "Announcements" Features for All Personnel |
| 6061 | Task | New | - | - | 1866 chars | Promote Shared Bonnychow Admin Capabilities to RSK Core |
| 6295 | Task | New | Shahriyar Tavakoli | 6317 To Do | 236 chars | S2H - Add product request |
| 6296 | Task | New | Shahriyar Tavakoli | 6318 To Do | 442 chars | S2H - Support Cash Weight Products |
| 6297 | Task | New | - | 6319 To Do | 104 chars | S2H - Number per pack UX |
| 6298 | Task | New | Shahriyar Tavakoli | 6320 To Do | 226 chars | S2H - Edit Order Seller with History Tracking |
| 6299 | Task | New | Shahriyar Tavakoli | 6321 Resolved | 188 chars | S2H – View Customer Active and Abandoned Carts |
| 6316 | Task | New | - | 6322 To Do | 44 chars | S2H - Investigate Cart Item Price Discrepancies |
| 6301 | Task | New | Shahriyar Tavakoli | 6323 To Do | 242 chars | S2H – Order Status Notifications |
| 6303 | Task | New | Shahriyar Tavakoli | 6324 To Do | 213 chars | S2H – Customer Wishlist |
| 6304 | Task | New | Shahriyar Tavakoli | 6325 Resolved | 223 chars | S2H – Reorder Previous Orders |
| 6306 | Task | New | Shahriyar Tavakoli | 6333 To Do | **none** | S2H - Design desktop size |

The raw capture, the normalized intake contract, and the generated table live in
`.atl-evidence/live-azure-sprint74/`:

| File | Contents |
| --- | --- |
| `pages-raw.json` | Page text for each work item, as rendered in the browser |
| `sprint-74-snapshot.json` | Azure-shaped work item export, 26 items, `System.Rev = null` |
| `intake-preview.json` | Output of `azureTasksFromExport`, i.e. what ATL would queue |
| `sprint-74.md` | Human-readable table plus one full normalized contract |

Regenerate them with `node .atl-evidence/live-azure-sprint74-build.mjs`.

## Clusters

The sprint is not 26 independent items. Five clusters share code, owners, or
acceptance surfaces, and ATL should treat each cluster as one intake unit when
sequencing work.

**Tour, visit, and draft (5 items).** 6348, 6345, 6339, 6338, and 6352 all touch
the Seller Portal visit and draft-cart flow. 6348 and 6345 both describe
multiple distinct bugs per item, so neither can pass a single acceptance check
without splitting into sub-work. 6352 is a new admin report with header/detail
data and its own filter surface.

**S2H storefront (13 items).** 6342 and 6340 are Feature containers with no
description; the 11 Task items under them carry the actual requirements and each
already has a child work item in `To Do` or `Resolved`. 6294 is already `Done`
with child 6313 `Resolved`, and two other children (6321, 6325) are `Resolved`
while their parents still read `New`, so part of this cluster is already
delivered and the parent states are stale.

**Customer registration (4 items).** 6311 is a data-mapping bug between the map
service and the SAP city service. 6257 lists seven registration improvements,
6256 covers two of them, and 6146 is a permission change. 6311 and 6337 both
have a child already `In Progress`, so ATL must not start them.

**Credit filters (1 item).** 6337 is the most completely specified item in the
sprint: a user story, requirements, and 12 acceptance scenarios, plus a JIRA
reference (IS-5170). Its child 6351 is `In Progress`, so the work has an owner
already.

**Admin capability promotion (1 item).** 6061 is an English-language,
architecture-shaped item about moving Bonnychow admin components into RSK core.
It needs a design decision before it can be planned as implementation.

## Intake gaps ATL cannot close on its own

Five items carry no usable description: 6346, 6342, 6340, 6316, and 6306. ATL
cannot frame, plan, or verify these from the sprint alone; each needs an owner to
supply the requirement text first.

Two items have a child already in progress: 6337 (child 6351) and 6311 (child
6353). Starting either one through ATL would duplicate work that is happening in
parallel, so both stay out of the pilot set until the child closes.

Several items bundle multiple bugs under one work item (6348, 6345, 6338, 6257).
ATL's acceptance checks are per task, so each needs splitting before it can
produce a trustworthy verdict.

## Recommended first pilot: 6336

6336 is the only item in the sprint that is self-contained, unclaimed by an
in-flight child, written as one observable defect, and assigned to a named
engineer. It states the broken behavior, the expected behavior for both
Infinite Scroll and Load More, five acceptance criteria, and a reference page
(`/en/showcase/example/invoices`).

That makes it a fair test of ATL rather than a test of ATL's ability to guess:

- The defect is visible in a rendered page, so the UI review surface can produce
  before/after evidence instead of a code-only claim.
- The acceptance criteria are checkable one by one, so the verify step has
  something concrete to run.
- The scope is one table container, so a plan can name the files it touches.
- The work is not duplicated by another in-flight item.

Suggested route: `atl-frame` to bound the defect, `atl-plan` for the container
and scroll behavior change, `atl-implement`, `atl-verify` for the five criteria,
then `atl-ui-review` for the rendered evidence. 6337 is the natural second pilot
once child 6351 closes, because its 12 scenarios are the best acceptance material
in the sprint.

## Making this a revision-bound intake

The snapshot path proves the intake contract and the triage. It does not prove
live state. To upgrade it:

```powershell
$env:AZDO_PAT = "<work items read token>"
node scripts/atl-azure-live-check.mjs --item 6336
```

Then set `intake.azure.enabled = true` in `config/manager.json` and run the
Azure preview, which returns real `System.Rev` values and lets ATL's revision
guard work:

```powershell
node skills/atl/scripts/azure-intake.mjs preview config/azure-intake.json --output .atl-evidence/live-azure-sprint74/live-preview.json
```

Until that runs, every claim about this sprint is a claim about the snapshot
captured at 2026-11-04T13:40:00Z.
