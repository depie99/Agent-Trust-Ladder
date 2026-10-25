## Scratch lifecycle proof

Prove the ATL lifecycle and rejection gates in this isolated scratch project.

Checks:
  - atl init and atl intake complete successfully
  - task reaches done with every completion check passing
  - feed contains Pip, Mira, Rowan, Sage, and Beacon cards in order
  - invalid role actions are rejected
  - a changes-requested loop returns the same task to in_progress and then done
