import assert from "node:assert/strict";
import { routeTaskWithJev } from "../runtime/lib/skill-router.mjs";

const root = new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1").replaceAll("/", "\\").replace(/\\$/, "");

const fallback = await routeTaskWithJev(root, { title: "Write a README", objective: "Update developer documentation" }, {
  config: { enabled: true, min_confidence: 0.75 },
  apiKey: "test-key",
  fetchImpl: async () => new Response(JSON.stringify({ answers: { skill: { choice: "atl-tech-docs", confidence: 0.61 } } }), { status: 200 }),
});
assert.equal(fallback.source, "skill-routing.json");
assert.equal(fallback.decision.accepted, false);

const accepted = await routeTaskWithJev(root, { title: "Write a README", objective: "Update developer documentation" }, {
  config: { enabled: true, min_confidence: 0.75 },
  apiKey: "test-key",
  fetchImpl: async () => new Response(JSON.stringify({
    model: "jev-test",
    answers: { skill: { choice: "atl-tech-docs", confidence: 0.94, probabilities: { "atl-tech-docs": 0.94 } } },
  }), { status: 200 }),
});
assert.equal(accepted.source, "jev");
assert.deepEqual(accepted.selected_skills, ["atl-tech-docs"]);
assert.equal(accepted.decision.accepted, true);

console.log("PASS: Jev route accepts high-confidence decisions and falls back below threshold");
