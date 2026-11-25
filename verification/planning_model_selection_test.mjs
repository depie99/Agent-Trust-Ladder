import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readCodexModels } from "../runtime/lib/codex-models.mjs";
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

const requests = [];
const catalog = await readCodexModels("codex", {
  launch(_command, args) {
    assert.deepEqual(args, ["app-server"]);
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill() {},
    });
    child.stdin.on("data", (chunk) => {
      const message = JSON.parse(chunk);
      requests.push(message.method);
      if (message.id === 1) child.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\n");
      if (message.id === 2) child.stdout.write(JSON.stringify({
        id: 2,
        result: { data: [
          { model: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", isDefault: true },
          { model: "internal-review", hidden: true },
        ] },
      }) + "\n");
    });
    return child;
  },
});
assert.deepEqual(requests, ["initialize", "initialized", "model/list"]);
assert.deepEqual(catalog.models, [{ id: "gpt-5.6-terra", label: "GPT-5.6 Terra" }]);
const verified = { ...chatgptCodex, ...catalog, cliCatalog: true };
assert.equal(resolvePlanningModel(verified), "gpt-5.6-terra");
assert.throws(() => resolvePlanningModel(verified, "gpt-6.2-sol"), /not in this Codex CLI/);
assert.throws(() => resolvePlanningModel({ ...verified, models: [] }, "gpt-6.2-sol"), /Could not load models/);

console.log("PASS: Plan Studio selects a compatible Codex ChatGPT model before provider invocation");
