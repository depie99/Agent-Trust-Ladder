"""Fail when agent-authored staged files exceed the repository token budget.

Tokens are intentionally estimated as bytes / 4. The hook only inspects staged
files and ignores lockfiles, generated output, and vendored dependencies.
"""

from __future__ import annotations

import argparse
import fnmatch
import subprocess
import sys
from pathlib import Path


DEFAULT_LIMIT = 5_000
IGNORED = (
    "*lock*",
    "*.generated.*",
    "*.gen.*",
    "*/generated/*",
    "*/codegen/*",
    "vendor/*",
    "node_modules/*",
    "dist/*",
    "build/*",
    "coverage/*",
)


def staged_files() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def ignored(path: str) -> bool:
    normalized = path.replace("\\", "/")
    name = Path(normalized).name
    return any(fnmatch.fnmatch(normalized, pattern) or fnmatch.fnmatch(name, pattern) for pattern in IGNORED)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check staged agent-authored files are <= the token budget.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args()

    offenders: list[tuple[str, int, int]] = []
    for name in staged_files():
        if ignored(name):
            continue
        content = subprocess.run(["git", "show", f":{name}"], check=True, capture_output=True).stdout
        tokens = (len(content) + 3) // 4
        if tokens > args.limit:
            offenders.append((name, len(content), tokens))

    if not offenders:
        return 0

    print("Agent-authored staged files exceed the token budget:", file=sys.stderr)
    for name, byte_count, tokens in offenders:
        print(f"  {name}: {tokens:,} estimated tokens ({byte_count:,} bytes)", file=sys.stderr)
    print("", file=sys.stderr)
    print("Split each oversized file by responsibility: extract one cohesive module,", file=sys.stderr)
    print("move public contracts/types near their consumers, and keep each new file", file=sys.stderr)
    print("independently testable. Stage the split files and rerun the hook.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
