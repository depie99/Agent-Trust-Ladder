"""Validate ATL's dependency-free model-routing policy."""

from __future__ import annotations

import json
from pathlib import Path
import sys


REQUIRED_ROLES = {"code", "judgment", "analysis", "ideas"}
REQUIRED_TOOL_NAMES = {"repo"}
REQUIRED_TEAM_NAMES = {"Mira", "Pip", "Rowan", "Sage", "Beacon"}


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("config/model-routing.json")
    try:
        policy = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"INVALID: {path}: {error}")
        return 1

    roles = policy.get("roles", {})
    missing = REQUIRED_ROLES - roles.keys()
    if missing:
        print(f"INVALID: missing roles: {', '.join(sorted(missing))}")
        return 1
    team = policy.get("team", {})
    roster_names = {member.get("name") for member in team.get("roster", [])}
    missing_team_names = REQUIRED_TEAM_NAMES - roster_names - {team.get("manager", {}).get("name")}
    if team.get("manager", {}).get("name") not in REQUIRED_TEAM_NAMES or missing_team_names:
        print("INVALID: team must define Mira, Pip, Rowan, Sage, and Beacon")
        return 1
    if not policy.get("default_review_required"):
        print("INVALID: default_review_required must be true")
        return 1
    review = policy.get("review", {})
    if review.get("must_differ_from_worker") is not True:
        print("INVALID: review.must_differ_from_worker must be true")
        return 1
    orchestration = policy.get("orchestration", {})
    if orchestration.get("default_topology") != "single_worker_then_review":
        print("INVALID: orchestration.default_topology must start with single_worker_then_review")
        return 1
    if not isinstance(orchestration.get("max_parallel_workers"), int) or not 1 <= orchestration["max_parallel_workers"] <= 8:
        print("INVALID: orchestration.max_parallel_workers must be between 1 and 8")
        return 1
    if orchestration.get("parallel_only_for_disjoint_write_sets") is not True:
        print("INVALID: parallel work must require disjoint write sets")
        return 1
    if orchestration.get("review_required") is not True:
        print("INVALID: orchestration.review_required must be true")
        return 1
    for role, config in roles.items():
        if not config.get("model") or not REQUIRED_TOOL_NAMES.issubset(config.get("tools", [])):
            print(f"INVALID: role {role!r} needs a model and repo tool")
            return 1
    print(f"PASS: validated team roster, {len(roles)} model roles, independent review, and bounded orchestration")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
