---
intake_key: composer:e3b7e783adb4
source: manual
created_at: 2026-10-27T04:40:39.948Z
---
Complete Persian Control Plane localization and RTL queue workflow
Repair the Persian localization so every Control Plane page uses natural fa-IR copy, RTL layout is structurally correct, mixed English and Persian task data remains readable, Persian system fonts are applied, and the live Queue visibly carries this work through implementation, review, and verification.
Checks:
- All primary Control Plane pages render translated Persian headings and controls with lang fa-IR and dir rtl
- Mixed-direction task titles, logs, paths, and code remain readable with bidi isolation
- The live Queue and Task portfolio show this task lifecycle and final evidence
- node verification/control_plane_fa_queue_test.mjs and the relevant control plane suites pass
