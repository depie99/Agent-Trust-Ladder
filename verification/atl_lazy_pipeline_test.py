import importlib.util
import threading
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("lazy", Path(__file__).parents[1] / "skills/atl-lazy/scripts/lazy.py")
lazy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lazy)

class PipelineTest(unittest.TestCase):
    def test_separation_parallelism_and_selection(self):
        seen = []
        active = 0
        peak = 0
        lock = threading.Lock()
        def invoke(*, system, payload, **kwargs):
            nonlocal active, peak
            phase = next(x for x in ("GENERATOR", "CRITIC", "CLUSTERER", "FOCUS", "SYNTHESIZER") if x in system)
            with lock:
                seen.append((phase, payload))
                if phase == "GENERATOR":
                    active += 1
                    peak = max(peak, active)
            if phase == "GENERATOR":
                time.sleep(.03)
                with lock: active -= 1
                return '{"ideas":[{"approach":"idea"}]}'
            if phase == "CRITIC":
                ids = [x["id"] for x in payload["candidates"]]
                return lazy.json.dumps({"scores": [{"id": i, "feasibility": 8, "fit": 8, "verifiability": 8, "trap": j == 1, "reason": ""} for j, i in enumerate(ids)]})
            if phase == "CLUSTERER":
                return lazy.json.dumps({"clusters": [{"name": "approach", "ids": [x["id"] for x in payload["candidates"]]}]})
            if phase == "FOCUS": return '{"proposal":"testable proposal"}'
            return "# Plan\n- [ ] T1 Do the work."
        result = lazy.run("request", "known facts", {"frames": ["minimal", "failure"], "ideas": 1, "top": 2, "concurrency": 2}, invoke, Path.cwd())
        self.assertEqual(peak, 2)
        self.assertEqual(result["calls"], 6)
        self.assertEqual(len(result["proposals"]), 1)
        branches = [payload for phase, payload in seen if phase == "GENERATOR"]
        self.assertTrue(all("candidates" not in b for b in branches))
        self.assertEqual([phase for phase, _ in seen].count("CRITIC"), 1)
        self.assertNotIn("failure-1", [p["id"] for p in result["proposals"]])

    def test_invalid_and_failed_calls_stop(self):
        for value in ({"concurrency": 0}, {"frames": ["minimal", "minimal"]}, {"ideas": True}, {"unknown": 1}):
            with self.assertRaises(ValueError): lazy.configuration(value)
        with self.assertRaises(ValueError):
            lazy.run("request", "", {"frames": ["minimal"], "ideas": 1, "top": 1}, lambda **kwargs: "invalid json", Path.cwd())

    def test_critic_must_cover_every_candidate(self):
        def invoke(*, system, **kwargs):
            if "GENERATOR" in system: return '{"ideas":[{"approach":"one"}]}'
            if "CRITIC" in system: return '{"scores":[]}'
            return '{"clusters":[]}'
        with self.assertRaisesRegex(ValueError, "score every"):
            lazy.run("request", "", {"frames": ["minimal"], "ideas": 1, "top": 1}, invoke, Path.cwd())

if __name__ == "__main__": unittest.main()
