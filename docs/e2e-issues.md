# Full E2E issue log

The deterministic Playwright journey is `verification/full_e2e_playwright_test.mjs`.

| Issue | Cause | Fix | Status |
|---|---|---|---|
| Browser journey hung at navigation | SSE keeps the page network active, so `networkidle` never settles | Use `domcontentloaded` for Control Plane journeys | Fixed |
| Navigation selected hidden mobile buttons | Text locators matched both desktop and mobile navigation | Select the first visible `data-page` control | Fixed |
| Supervisor did not run scheduled maintenance | Backup and routine helpers existed but were not called by dispatch | Invoke scheduled backup and routine ticks from the supervisor loop | Fixed |
| Delivery could be created without current proof | Packet creation did not check matching review/check evidence | Require current packet/code revision evidence before packet creation | Fixed |

Live-provider containment remains a separate smoke test because it requires a configured provider adapter and credentials. The local journey uses the deterministic runtime and never sends external messages.
