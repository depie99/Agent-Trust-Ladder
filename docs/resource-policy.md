# Adaptive task resources

Settings → Autonomous resources controls the project-local `resource_policy`
in `config/manager.json`. Save does not start a provider or queue. Existing
projects retain their old behavior until the policy is enabled. Policy changes
wait for an active queue to finish; restarting a server is not a way to change
the allowance of an already running session.

The default session count is editable independently of automatic estimation.
With adaptive budgets enabled, the initial estimate is 3 sessions for a small
routine task, the configured default for standard work, default + 4 for complex
work, and default + 8 for critical work. A review rejection adds room for repair.
The run allowance, overall time limit, and automatic per-task ceiling still
apply. Estimates count all lifecycle roles, including review and verification.
Unused sessions are an allowance, not work ATL must perform.

Only allocations marked `source: automatic` may grow automatically. With
automatic extension enabled, the manager can reserve the remaining lifecycle
handoffs at each session boundary, up to the ceiling. It never resets `used`.
Legacy task limits and owner increases are pinned; changing a Settings default
does not override them. An explicit run session limit can impose a lower cap.
When extension is disabled, the first automatic allocation remains fixed.

Model routing uses an owner-approved pool of exact provider/model pairs.
Each pair has an economy, standard, or advanced capability tier, an enabled
flag, and a cost order from 0 to 100. Cost order is a relative owner preference,
not a price quotation. The strongest allowed tier and enabled rows together
define the ceiling. Adding a provider connection does not automatically enroll
its models. Installed model metadata supplies input suggestions; availability
in a local catalog is not a guarantee of account entitlement or runtime success.

Before each role session, ATL estimates required capacity from the task's own
scope, files, dependencies, risk, acceptance surfaces and review results. A
planner can supply a reasoned `resource_estimate`; it cannot downgrade observed
risk, choose an unauthorized provider, or increase a ceiling. Genuine review
rejections increase required reasoning capacity; risky independent reviews use
the advanced tier. The lowest configured cost order among available models
meeting the requirement wins. This is an inspectable bounded routing rule,
not a learned price or performance predictor.

Completed and independently verified execution histories now calibrate future
session estimates and model tier requirements within the same owner bounds.
See [Execution reports](execution-reports.md) for coverage, cohort thresholds
and the distinction between runtime adaptation and model weight training.

Explicit role or run selections are preserved and validated against the same
pool, capacity requirement and ceiling. An unavailable or inadequate route
stops before starting or charging a model session and names what is missing.
No automatic fallback can cross the configured ceiling. Authentication,
workspace/browser permissions, separate review and exact evidence gates remain
independent requirements.

Quota failover is enabled by default, independently of adaptive budgeting.
When a CLI reports exhausted quota or a rate limit, ATL remembers a cooldown
in `.trust/manager/provider-quota.json`, selects another eligible configured
route, and continues the same lifecycle under the remaining session/time
allowance. A failed attempt still consumes its session and appears in reports.
An explicit role/model preference can be replaced for this quota recovery;
turn off quota failover in Settings to prevent automatic retries.

With a configured model pool, alternatives must meet the required capability
and model ceiling. Without a pool and with automatic model routing off, ATL
can use only existing configured provider defaults. It does not enroll a new
provider or guess new model ids. Fresh verified quota observations are preferred
over unknown alternatives. Unknown quota may be tried, but is never labelled
available. A provider-wide failure skips that provider across tasks; a known
model-scoped failure skips only that model. Quota cooldown defaults to thirty
minutes; recognized rate limits use sixty seconds. No permanent lockout is
inferred when a reset time is unavailable. If every eligible alternative is
unavailable, the task retains its exact blocker and cooldown time; it cannot
run through a quota, permission, model ceiling or budget boundary.

Check: `node verification/provider_quota_failover_test.mjs` exercises a real
two-task queue with an exhausted deterministic adapter and a working backup.

Plan Studio shows a resource estimate for each task card and its build, review
and verification roles. Its automatic provider option also applies the pool
to generation, regeneration and plan accuracy review; each call keeps the
existing one-session confirmation and timeout. Built-in subscription planning
uses read-only permissions. Task details and launch preview show the decision;
activity records `resource_budget`, `resource_route` and `resource_route_blocked`.

Verification: `node verification/resource_policy_test.mjs`,
`node verification/resource_policy_ui_test.mjs`, existing provider/Plan Studio
and launch regression suites, and `npm run ui:css:check`.

## Per-task provider and model

Open a task, choose **Actions → Provider / model**, and select a configured
provider and exact model. The choice is saved on that task and used for later
Rowan, Sage, and Beacon sessions. **Use project / automatic route** removes the
task choice. A provider/model explicitly selected for a particular run takes
precedence over the saved task route. Changes are refused while a queue run is
active, so an in-flight session keeps its original route. The resource policy's
approved model pool and capability ceiling still apply.
