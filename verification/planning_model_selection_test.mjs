import assert from "node:assert/strict";
import { planningModelChoices, resolvePlanningModel } from "../runtime/lib/providers.mjs";

const chatgptCodex = {
  id: "codex",
  label: "Codex CLI",
  method: "chatgpt",
  defaultModel: "gpt-6.1-terra",
  models: [
    { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  ],
};

assert.deepEqual(planningModelChoices(chatgptCodex), ["gpt-5.6-terra", "gpt-5.6-sol"], "the unavailable ChatGPT CLI model never reaches Plan Studio's picker");
assert.equal(resolvePlanningModel(chatgptCodex), "gpt-5.6-terra", "an unsupported global default falls back to the first compatible cached model");
assert.equal(resolvePlanningModel(chatgptCodex, "gpt-5.6-sol"), "gpt-5.6-sol", "an explicitly selected compatible model is preserved");
assert.throws(() => resolvePlanningModel(chatgptCodex, "gpt-6.1-terra"), /no provider request was sent/, "an incompatible direct API request is refused before spawning Codex");
assert.throws(() => resolvePlanningModel(chatgptCodex, "unknown-model"), /no provider request was sent/, "an uncached direct API request is refused before spawning Codex");

const apiCodex = { ...chatgptCodex, method: "api-key" };
assert.equal(resolvePlanningModel({ id: "claude", models: [] }), null, "Claude can use its CLI default without a model cache");
assert.equal(resolvePlanningModel({ id: "gapgpt", defaultModel: "configured-model", models: [] }), "configured-model", "configured providers retain their default even without a cache");
assert.equal(resolvePlanningModel(apiCodex, "gpt-6.1-terra"), "gpt-6.1-terra", "the guard is scoped to ChatGPT CLI authentication, not API providers");

console.log("PASS: Plan Studio selects a compatible Codex ChatGPT model before provider invocation");
