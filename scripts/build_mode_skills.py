"""Build standalone, discoverable Trust Ladder mode skills from canonical sources.

`build()` writes the generated skills. `build(check=True)` only reports drift,
so `--check` can run in review without touching the tree.
"""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skills" / "agent-trust-ladder"
SKILLS = ROOT / "skills"

MODES = {
    "bootstrap": "Inspect an existing project and create an honest project brief and conservative starting trust policy. Use for first contact, stale project context, or major architecture change.",
    "frame": "Turn a vague engineering request into a bounded brief with explicit unknowns, constraints, acceptance examples, rollback, and an appropriate process dose.",
    "specify": "Define observable software behavior and acceptance examples before implementation. Use when intent is bounded but behavior still needs an explicit human approval gate.",
    "plan": "Map an approved software specification onto the real codebase as an impact-aware, independently verifiable implementation plan.",
    "implement": "Execute an approved engineering plan with bounded diagnose-repair-reverify loops. Use when tasks and verifier commands are already defined.",
    "verify": "Verify implemented software with checks that actually run and produce a six-question evidence-backed trust verdict.",
    "audit": "Audit an existing diff, pull request, or agent session and report whether it is trustworthy, conditionally trustworthy, or not trustworthy. Read-only unless fixes are requested.",
    "trust": "Assess or change how much autonomy an engineering agent has earned for a specific task class using recorded project evidence.",
}

SHARED = """# Trust Ladder: {title}

This is the independently invocable `{mode}` workflow from Agent Trust Ladder. Run only this workflow for the current invocation.

## Shared contract

- Discover repository instructions, protected work, and real verification commands before acting; never invent a command.
- Preserve the user's scope and authority. Passing evidence cannot approve intent, expand scope, or authorize merge, deploy, publication, spending, production access, or irreversible actions.
- Mark consequential unknowns `OPEN` and unverified claims `ASSUMPTION (source)`; do not silently turn either into behavior.
- Never hide a failure, weaken a meaningful check for green, overwrite unrelated work, or claim a verifier ran when it did not.
- Use bounded loops with explicit stop conditions. Humans own ambiguous intent, risk acceptance, waivers, and irreversible decisions.
- Spend context deliberately: read metadata first, then only this mode and its relevant references; do not repeat unchanged evidence or load unrelated skills.
- End with the artifact or verdict produced, open items, and the next safe action. Do not silently run the next Trust Ladder workflow.

## Workflow

"""

# Modes live one directory below the skill root, so their relative links carry
# a `../` that is wrong once the text is copied into skills/atl-<mode>/SKILL.md.
BUNDLED_PREFIXES = ("../references/", "../scripts/")


def title(mode: str) -> str:
    return mode.replace("-", " ").title()


def mode_body(mode: str) -> str:
    body = (SOURCE / "modes" / f"{mode}.md").read_text(encoding="utf-8")
    for prefix in BUNDLED_PREFIXES:
        body = body.replace(prefix, prefix[3:])
    if any(prefix in body for prefix in BUNDLED_PREFIXES):
        raise SystemExit(f"mode {mode} still contains a skill-root-relative path")
    return body


def render() -> dict[str, bytes]:
    """Return every generated file, relative to the skills directory."""
    files: dict[str, bytes] = {}
    references = sorted((SOURCE / "references").glob("*.md"))
    for mode, description in MODES.items():
        content = (
            "---\n"
            f"name: atl-{mode}\n"
            f"description: {description}\n"
            "---\n\n"
            + SHARED.format(title=title(mode), mode=mode)
            + mode_body(mode)
        )
        files[f"atl-{mode}/SKILL.md"] = content.encode("utf-8")
        for source in references:
            files[f"atl-{mode}/references/{source.name}"] = source.read_bytes()
        files[f"atl-{mode}/agents/openai.yaml"] = (
            "interface:\n"
            f"  display_name: \"ATL {title(mode)}\"\n"
            f"  short_description: \"{description[:100]}\"\n"
            f"  default_prompt: \"Use $atl-{mode} for this request.\"\n"
        ).encode("utf-8")
    return files


def build(check: bool = False) -> list[str]:
    """Write the generated skills, or return drifted paths when checking."""
    files = render()
    drift = []
    for name, data in files.items():
        target = SKILLS / name
        if not target.is_file() or target.read_bytes() != data:
            drift.append((SKILLS / name).relative_to(ROOT).as_posix())
    if check:
        return sorted(drift)
    for name, data in files.items():
        target = SKILLS / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return []


def main(argv: list[str]) -> int:
    if "--check" in argv:
        drift = build(check=True)
        for name in drift:
            print(f"Stale generated skill: {name}")
        if drift:
            print(f"{len(drift)} generated skill file(s) need a rebuild")
            return 1
        print("Mode skills match their canonical sources.")
        return 0
    build()
    print("Mode skills rebuilt from their canonical sources.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
