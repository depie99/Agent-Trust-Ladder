"""Build standalone, discoverable Trust Ladder mode skills from canonical sources."""

from pathlib import Path
import shutil


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


def title(mode: str) -> str:
    return mode.replace("-", " ").title()


def build() -> None:
    for mode, description in MODES.items():
        target = SKILLS / f"atl-{mode}"
        target.mkdir(parents=True, exist_ok=True)
        body = (SOURCE / "modes" / f"{mode}.md").read_text(encoding="utf-8")
        body = body.replace("../references/", "references/")
        content = (
            "---\n"
            f"name: atl-{mode}\n"
            f"description: {description}\n"
            "---\n\n"
            + SHARED.format(title=title(mode), mode=mode)
            + body
        )
        (target / "SKILL.md").write_text(content, encoding="utf-8", newline="\n")

        references = target / "references"
        references.mkdir(exist_ok=True)
        for source in (SOURCE / "references").glob("*.md"):
            shutil.copyfile(source, references / source.name)

        agents = target / "agents"
        agents.mkdir(exist_ok=True)
        (agents / "openai.yaml").write_text(
            "interface:\n"
            f"  display_name: \"ATL {title(mode)}\"\n"
            f"  short_description: \"{description[:100]}\"\n"
            f"  default_prompt: \"Use $atl-{mode} for this request.\"\n",
            encoding="utf-8",
            newline="\n",
        )


if __name__ == "__main__":
    build()
