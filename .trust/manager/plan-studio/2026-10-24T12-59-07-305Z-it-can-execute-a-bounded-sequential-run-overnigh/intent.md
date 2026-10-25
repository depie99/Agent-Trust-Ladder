It can execute a bounded sequential run overnight if the host process and provider CLI stay alive. It has useful safeguards: explicit confirmation, shared time/session budgets, one global slot, persisted logs/results, and blocker skipping.
But it is not yet a resilient overnight service:
- No scheduler, daemon, or automatic restart after laptop/process/network failure.
- No durable resume/checkpoint mechanism that restarts an interrupted run.
- The documented constraint says an AI session must remain open; an open laptop alone is insufficient. [USAGE.md (line 136)](D:\Projects\Agentic\Agent-Trust-Ladder\USAGE.md:136)
- Default “overnight” budget is only 120 minutes / 5 sessions, not a whole night. [atl-manager.mjs (line 415)](D:\Projects\Agentic\Agent-Trust-Ladder\runtime\atl-manager.mjs:415)
- It has unit/API tests, but no real unattended soak test against an actual provider.
