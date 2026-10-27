"""Bounded exhaustive model of runtime/lib/dependencies.mjs readiness.

The model is intentionally small and dependency-free. It replicates the
dependency-readiness semantics (satisfied = done|archived, cycle detection,
transitive stuck propagation, priority ordering) as a finite reference
model and checks the invariants over EVERY status assignment of a fixed
set of small dependency topologies. It is evidence for the readiness
contract, not a proof of the whole Node runtime.

Run from the repo root:
    python verification/dependencies_model.py
    python verification/dependencies_model.py --mutation-test
"""

from __future__ import annotations

import argparse
from itertools import product

STATUSES = (
    "new", "triaged", "assigned", "in_progress", "in_review",
    "verifying", "done", "blocked", "rejected", "escalated", "archived",
)
SATISFIED = {"done", "archived"}
TERMINAL = {"done", "rejected", "archived"}
PRIORITY_RANK = {"urgent": 0, "high": 1, "normal": 2, "low": 3}

# name -> (tasks [(id, priority)], edges {id: [dep ids]}) — "depends on"
TOPOLOGIES = {
    "single": (
        [("A", "high")],
        {},
    ),
    "chain": (
        [("A", "low"), ("B", "high")],
        {"B": ["A"]},
    ),
    "diamond": (
        [("A", "normal"), ("B", "high"), ("C", "urgent")],
        {"B": ["A"], "C": ["A", "B"]},
    ),
    "cycle-with-dependent": (
        [("A", "normal"), ("B", "normal"), ("C", "urgent")],
        {"A": ["B"], "B": ["A"], "C": ["A"]},
    ),
    "missing-dep": (
        [("A", "high")],
        {"A": ["Z"]},
    ),
    "rejected-dep": (
        [("A", "normal"), ("B", "urgent")],
        {"B": ["A"]},
    ),
}


def ready_set(statuses: dict, edges: dict, mutated: bool = False) -> set:
    """The readiness rule mirrored from dependencies.mjs."""
    satisfied_mut = SATISFIED | {"blocked"} if mutated else SATISFIED
    out = set()
    for tid in statuses:
        if statuses[tid] in TERMINAL:
            continue
        deps = edges.get(tid, [])
        if all(statuses[d] in satisfied_mut for d in deps if d in statuses):
            out.add(tid)
    return out


def waiting_set(statuses: dict, edges: dict, ready: set, stuck: set) -> set:
    """Spec: open, not ready, not stuck, with a known unsatisfied dep."""
    out = set()
    for tid in statuses:
        if statuses[tid] in TERMINAL or tid in ready or tid in stuck:
            continue
        if any(statuses[d] not in SATISFIED for d in edges.get(tid, []) if d in statuses):
            out.add(tid)
    return out


def stuck_set(statuses: dict, edges: dict, propagate: bool = True) -> set:
    """Cycle members (over unsatisfied edges) plus their transitive dependents."""
    unsat = {
        tid: [d for d in edges.get(tid, []) if d in statuses and statuses[d] not in SATISFIED]
        for tid in statuses
    }
    stuck: set = set()

    def reaches_self(start: str, current: str, seen: frozenset) -> bool:
        for d in unsat.get(current, []):
            if d == start:
                return True
            if d in seen:
                continue
            if reaches_self(start, d, seen | {d}):
                return True
        return False

    for tid in statuses:
        if reaches_self(tid, tid, frozenset({tid})):
            stuck.add(tid)
    # A dependency that already ended unsatisfied (rejected) can never be
    # satisfied either — its dependents are stuck from the start.
    for tid in statuses:
        if statuses[tid] in TERMINAL:
            continue
        if any(statuses[d] == "rejected" for d in edges.get(tid, []) if d in statuses):
            stuck.add(tid)
    if not propagate:
        return stuck
    grew = True
    while grew:
        grew = False
        for tid in statuses:
            if tid in stuck or statuses[tid] in TERMINAL:
                continue
            if any(d in stuck for d in edges.get(tid, []) if d in statuses):
                stuck.add(tid)
                grew = True
    return stuck


def ordered_ready(priorities: dict, ready: set, mutated_order: bool = False) -> list:
    def key(tid: str):
        if mutated_order:
            return tid  # MUTATION: id order only, priorities ignored
        return (PRIORITY_RANK.get(priorities[tid], 9), tid)

    return sorted(ready, key=key)


def invariants(priorities: dict, edges: dict, statuses: dict, result: dict) -> str | None:
    ready = set(result["ready"])
    waiting = set(result["waiting"])
    stuck = set(result["stuck"])
    # I1: the views are disjoint
    if ready & waiting or ready & stuck or waiting & stuck:
        return f"views overlap for {statuses}"
    # I2: terminal tasks never appear in any view
    for tid in statuses:
        if statuses[tid] in TERMINAL and (tid in ready or tid in waiting or tid in stuck):
            return f"terminal task {tid}={statuses[tid]} appears in a view"
    # I3: completeness — every open, unstuck, fully-satisfied task is ready
    for tid in statuses:
        if statuses[tid] in TERMINAL or tid in stuck:
            continue
        deps = [d for d in edges.get(tid, []) if d in statuses]
        all_sat = all(statuses[d] in SATISFIED for d in deps)
        if all_sat and tid not in ready:
            return f"task {tid} ({statuses[tid]}) with all deps satisfied is not ready"
    # I4: waiting means a known unsatisfied dep, and every such task waits
    for tid in statuses:
        if statuses[tid] in TERMINAL or tid in stuck:
            continue
        has_unsat = any(statuses[d] not in SATISFIED for d in edges.get(tid, []) if d in statuses)
        if has_unsat and tid not in waiting:
            return f"task {tid} ({statuses[tid]}) has an unsatisfied dep but is not waiting"
        if not has_unsat and tid in waiting:
            return f"task {tid} ({statuses[tid]}) waits with nothing unsatisfied"
    # I5: no ready/waiting task depends on a stuck or rejected task
    for tid in ready | waiting:
        for d in edges.get(tid, []):
            if d in statuses and statuses[d] not in SATISFIED and (d in stuck or statuses[d] == "rejected"):
                return f"task {tid} is launchable while depending on stuck/rejected {d}"
    # I6: the ready list is ordered by (priority rank, id)
    rank_seq = [PRIORITY_RANK.get(priorities[tid], 9) for tid in result["ready"]]
    if rank_seq != sorted(rank_seq):
        return f"ready list not priority-ordered: {result['ready']}"
    groups: dict[int, list] = {}
    for tid in result["ready"]:
        groups.setdefault(PRIORITY_RANK.get(priorities[tid], 9), []).append(tid)
    for members in groups.values():
        if members != sorted(members):
            return f"ready list not id-ordered within a priority: {members}"
    return None


def analyze(priorities: dict, edges: dict, statuses: dict, mutate: str | None = None) -> dict:
    stuck = stuck_set(statuses, edges, propagate=(mutate != "no-propagation"))
    ready = ready_set(statuses, edges, mutated=(mutate == "blocked-satisfied"))
    waiting = waiting_set(statuses, edges, ready, stuck)
    ready = ordered_ready(priorities, ready, mutated_order=(mutate == "id-order"))
    # The scheduling views describe open work only — terminal tasks (even
    # ones structurally inside a cycle) never appear in them.
    return {
        "ready": ready,
        "waiting": waiting,
        "stuck": {tid for tid in stuck if statuses[tid] not in TERMINAL},
    }


def check(mutate: str | None = None) -> tuple[bool, str]:
    assignments = 0
    for name, (task_list, edges) in TOPOLOGIES.items():
        ids = [tid for tid, _ in task_list]
        priorities = {tid: pr for tid, pr in task_list}
        for combo in product(STATUSES, repeat=len(ids)):
            statuses = dict(zip(ids, combo))
            result = analyze(priorities, edges, statuses, mutate=mutate)
            assignments += 1
            problem = invariants(priorities, edges, statuses, result)
            if problem:
                return False, f"{name} {statuses}: {problem}"
    return True, f"checked {assignments} status assignments across {len(TOPOLOGIES)} topologies"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mutation-test", action="store_true")
    args = parser.parse_args()
    if args.mutation_test:
        for mutate in ("blocked-satisfied", "no-propagation", "id-order"):
            caught = False
            if mutate == "no-propagation":
                # Targeted counterexample: cycle A<->B with C depending on A.
                priorities = {"A": "normal", "B": "normal", "C": "urgent"}
                edges = {"A": ["B"], "B": ["A"], "C": ["A"]}
                statuses = {"A": "new", "B": "new", "C": "new"}
                result = analyze(priorities, edges, statuses, mutate=mutate)
                caught = invariants(priorities, edges, statuses, result) is not None
            else:
                passed, _ = check(mutate=mutate)
                caught = not passed
            if not caught:
                print(f"MUTATION NOT CAUGHT: {mutate}")
                return 1
            print(f"mutation caught: {mutate}")
        print("MUTATION TEST PASSED: all seeded readiness mutations detected")
        return 0
    passed, message = check()
    print(("PASS: " if passed else "FAIL: ") + message)
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
