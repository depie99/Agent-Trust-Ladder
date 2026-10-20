# ATL formal verification suite

`atl_lifecycle_model.py` is a small exhaustive reference model for the route gates in the canonical ATL router. It checks that verification evidence exists before a route can reach `trusted`. It is intentionally not a proof of product correctness or of any particular agent's behavior.

Run the baseline and the negative control:

```text
python verification/atl_lifecycle_model.py
python verification/atl_lifecycle_model.py --mutation-test
```

The mutation test injects an unsafe `implemented → verified` transition without evidence and requires the invariant checker to reject it. If the lifecycle contract changes, update the model and this mapping together, then rerun both commands.
