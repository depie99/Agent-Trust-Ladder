"""Exercise drift detection and prove check mode does not mutate artifacts."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mode_builder", PROJECT / "scripts/build_mode_skills.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildModeSkillsTest(unittest.TestCase):
    def test_detect_repair_and_read_only_check(self):
        with tempfile.TemporaryDirectory(prefix="atl-mode-builder-") as temp:
            old = builder.ROOT, builder.SOURCE, builder.SKILLS
            try:
                builder.ROOT = Path(temp)
                builder.SKILLS = Path(temp) / "skills"
                builder.SOURCE = builder.SKILLS / "agent-trust-ladder"
                (builder.SOURCE / "modes").mkdir(parents=True)
                (builder.SOURCE / "references").mkdir()
                (builder.SOURCE / "references/evidence.md").write_text("Evidence\n", encoding="utf-8")
                for mode in builder.MODES:
                    (builder.SOURCE / "modes" / f"{mode}.md").write_text("# Contract\n", encoding="utf-8")
                missing = builder.build(check=True)
                self.assertGreater(len(missing), 0)
                self.assertFalse((builder.SKILLS / "atl-verify").exists())
                builder.build()
                self.assertEqual(builder.build(check=True), [])
                artifact = builder.SKILLS / "atl-verify/SKILL.md"
                original = artifact.read_bytes()
                artifact.write_text("drift\n", encoding="utf-8")
                before = {p: p.read_bytes() for p in builder.SKILLS.rglob("*") if p.is_file()}
                self.assertEqual(builder.build(check=True), ["skills/atl-verify/SKILL.md"])
                self.assertEqual(before, {p: p.read_bytes() for p in builder.SKILLS.rglob("*") if p.is_file()})
                builder.build()
                self.assertEqual(artifact.read_bytes(), original)
            finally:
                builder.ROOT, builder.SOURCE, builder.SKILLS = old


if __name__ == "__main__":
    unittest.main()
