"""Small exhaustive model for ATL's lifecycle gate invariants.

This is deliberately dependency-free. It checks that a route cannot implement
before a plan, verify before implementation, or advance trust without evidence.
The mutation mode proves the harness catches an unsafe transition.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import argparse


STAGES = ("raw", "brief", "spec", "plan", "implemented", "verified", "trusted")


@dataclass(frozen=True)
class State:
    stage: str = "raw"
    evidence: bool = False


def transitions(state: State, mutated: bool = False) -> list[State]:
    next_states: list[State] = []
    if state.stage == "raw":
        next_states.append(State("brief"))
    elif state.stage == "brief":
        next_states.append(State("spec"))
    elif state.stage == "spec":
        next_states.append(State("plan"))
    elif state.stage == "plan":
        next_states.append(State("implemented"))
    elif state.stage == "implemented":
        next_states.append(State("verified", evidence=True))
        if mutated:
            next_states.append(State("verified", evidence=False))
    elif state.stage == "verified" and state.evidence:
        next_states.append(State("trusted", evidence=True))
    return next_states


def invariant(state: State) -> bool:
    if state.stage in {"implemented", "verified", "trusted"} and state.stage != "implemented":
        return state.evidence
    return True


def check(mutated: bool = False) -> tuple[bool, str]:
    seen = {State()}
    queue = deque([State()])
    while queue:
        state = queue.popleft()
        if not invariant(state):
            return False, f"counterexample: reached {state} without verification evidence"
        for candidate in transitions(state, mutated=mutated):
            if candidate not in seen:
                seen.add(candidate)
                queue.append(candidate)
    return True, f"checked {len(seen)} reachable states"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mutation-test", action="store_true")
    args = parser.parse_args()
    if args.mutation_test:
        passed, message = check(mutated=True)
        if passed:
            print("MUTATION TEST FAILED: unsafe transition was not detected")
            return 1
        print(f"MUTATION TEST PASSED: {message}")
        return 0
    passed, message = check()
    print(("PASS: " if passed else "FAIL: ") + message)
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
