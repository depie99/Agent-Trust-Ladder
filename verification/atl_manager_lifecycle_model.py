"""Bounded exhaustive model of runtime/lib/state.mjs manager gates.

The model is intentionally small and dependency-free. It maps the manager's
observable states and gate fields to a finite reference model. It is evidence
for the modeled transition contract, not a proof of the whole Node runtime.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, replace
import argparse
import json
from pathlib import Path


CONTRACT_PATH = Path(__file__).resolve().parents[1] / "config" / "manager-state-contract.json"

EXPECTED_STATUSES = (
    "new", "triaged", "assigned", "in_progress", "in_review",
    "verifying", "done", "blocked", "rejected", "escalated",
)

EXPECTED_TRANSITIONS = {
    "new->triaged": {"actors": ["pip"], "requires": ["objective", "completion_checks"]},
    "new->rejected": {"actors": ["pip"], "requires": []},
    "new->blocked": {"actors": ["pip"], "requires": ["blocker"]},
    "triaged->assigned": {"actors": ["mira"], "requires": ["assigned_worker"]},
    "triaged->rejected": {"actors": ["mira"], "requires": []},
    "triaged->blocked": {"actors": ["mira"], "requires": ["blocker"]},
    "assigned->in_progress": {"actors": ["rowan", "pip", "sage", "beacon"], "requires": []},
    "assigned->blocked": {"actors": ["rowan", "mira"], "requires": ["blocker"]},
    "in_progress->in_review": {"actors": ["rowan", "pip", "sage", "beacon"], "requires": ["workspace", "evidence"]},
    "in_progress->blocked": {"actors": ["rowan"], "requires": ["blocker"]},
    "in_review->verifying": {"actors": ["sage"], "requires": ["review_approved"]},
    "in_review->in_progress": {"actors": ["sage"], "requires": ["review_changes_requested"]},
    "in_review->blocked": {"actors": ["sage"], "requires": ["blocker"]},
    "verifying->done": {"actors": ["beacon"], "requires": ["all_checks_pass"]},
    "verifying->in_progress": {"actors": ["beacon"], "requires": []},
    "verifying->escalated": {"actors": ["beacon"], "requires": ["blocker"]},
    "blocked->triaged": {"actors": ["mira", "pip"], "requires": []},
    "escalated->triaged": {"actors": ["mira"], "requires": []},
}


def validate_contract() -> None:
    """Fail loudly if the model's assumptions no longer match the runtime contract."""
    try:
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot load runtime state contract: {exc}") from exc
    if tuple(contract.get("statuses", ())) != EXPECTED_STATUSES:
        raise RuntimeError("CONTRACT DRIFT: status list differs from the model")
    if contract.get("transitions") != EXPECTED_TRANSITIONS:
        raise RuntimeError("CONTRACT DRIFT: transition actors or evidence requirements differ from the model")


@dataclass(frozen=True)
class State:
    status: str = "new"
    objective: bool = False
    completion_checks: bool = False
    assigned_worker: bool = False
    workspace: bool = False
    observed_check: bool = False
    review: str = "none"  # none | approve | changes-requested
    all_checks_pass: bool = False
    review_required: bool = False


def invariant(state: State) -> bool:
    """The gates mirrored from fail() in runtime/lib/state.mjs."""
    if state.status in {"in_review", "verifying", "done"}:
        if not state.workspace or not state.observed_check:
            return False
    if state.status in {"verifying", "done"} and state.review != "approve":
        return False
    if state.status == "done" and not state.all_checks_pass:
        return False
    return True


def transitions(state: State, mutated: bool = False) -> list[tuple[str, State]]:
    """Return code-shaped transitions plus one deliberate unsafe mutation."""
    out: list[tuple[str, State]] = []
    if state.status == "new":
        out.append(("pip shapes objective/checks", replace(state, status="triaged", objective=True, completion_checks=True)))
    elif state.status == "triaged" and state.assigned_worker:
        out.append(("mira assigns worker", replace(state, status="assigned")))
    elif state.status == "triaged":
        out.append(("mira assigns worker", replace(state, status="assigned", assigned_worker=True)))
    elif state.status == "assigned":
        out.append(("rowan starts", replace(state, status="in_progress")))
    elif state.status == "in_progress":
        out.append(("rowan creates workspace and records check", replace(state, workspace=True, observed_check=True, status="in_review")))
        if mutated:
            out.append(("MUTATION: submit review without workspace/evidence", replace(state, status="in_review")))
    elif state.status == "in_review":
        out.append(("sage approves", replace(state, status="verifying", review="approve")))
        out.append(("sage requests changes", replace(state, status="in_progress", review="changes-requested")))
    elif state.status == "verifying":
        out.append(("beacon observes all checks passing", replace(state, status="done", all_checks_pass=True)))
        if mutated:
            out.append(("MUTATION: finish without passing checks", replace(state, status="done", all_checks_pass=False)))
    return out


def check(mutated: bool = False) -> tuple[bool, str]:
    validate_contract()
    start = State()
    queue = deque([(start, [])])
    seen = {start}
    while queue:
        state, path = queue.popleft()
        if not invariant(state):
            return False, "counterexample: " + " -> ".join(path + [state.status])
        for action, candidate in transitions(state, mutated=mutated):
            candidate_path = path + [action]
            if not invariant(candidate):
                return False, "counterexample: " + " -> ".join(candidate_path)
            if candidate not in seen:
                seen.add(candidate)
                queue.append((candidate, candidate_path))
    return True, f"checked {len(seen)} reachable manager states"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mutation-test", action="store_true")
    args = parser.parse_args()
    try:
        passed, message = check(mutated=args.mutation_test)
    except RuntimeError as exc:
        print(f"MODEL ERROR: {exc}")
        return 2
    if args.mutation_test:
        if passed:
            print("MUTATION TEST FAILED: unsafe manager transition was not detected")
            return 1
        print(f"MUTATION TEST PASSED: {message}")
        return 0
    print(("PASS: " if passed else "FAIL: ") + message)
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
