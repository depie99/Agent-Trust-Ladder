"""Maintain ATL's project-local verification skill and its executable evidence loop."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = (
    ROOT / "skills/verify-atl-manager-lifecycle/SKILL.md",
    ROOT / "verification/atl_manager_lifecycle_model.py",
    ROOT / "verification/atl_lifecycle_model.py",
    ROOT / "verification/jev_router_test.mjs",
    ROOT / "verification/learning_test.mjs",
    ROOT / "verification/README.md",
    ROOT / "config/manager-state-contract.json",
)


def run(command: list[str]) -> None:
    print(f"$ {' '.join(command)}")
    result = subprocess.run(command, cwd=ROOT, text=True)
    if result.returncode:
        raise RuntimeError(f"command failed with exit code {result.returncode}: {' '.join(command)}")


def main() -> int:
    missing = [str(path.relative_to(ROOT)) for path in REQUIRED_FILES if not path.is_file()]
    if missing:
        print("FAIL: missing verification skill assets:")
        for path in missing:
            print(f"- {path}")
        return 1

    skill = (ROOT / "skills/verify-atl-manager-lifecycle/SKILL.md").read_text(encoding="utf-8")
    if "CONTRACT DRIFT" not in skill or "--mutation-test" not in skill:
        print("FAIL: local verification skill is missing its drift or mutation protocol")
        return 1

    try:
        json.loads((ROOT / "config/manager-state-contract.json").read_text(encoding="utf-8"))
        run([sys.executable, "verification/atl_manager_lifecycle_model.py"])
        run([sys.executable, "verification/atl_manager_lifecycle_model.py", "--mutation-test"])
        run([sys.executable, "verification/atl_lifecycle_model.py"])
        run([sys.executable, "verification/atl_lifecycle_model.py", "--mutation-test"])
        run(["node", "verification/jev_router_test.mjs"])
        run(["node", "verification/learning_test.mjs"])
    except (OSError, json.JSONDecodeError, RuntimeError) as error:
        print(f"FAIL: {error}")
        return 1

    print("PASS: verification skill assets, contract, baseline, and mutation checks are healthy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
