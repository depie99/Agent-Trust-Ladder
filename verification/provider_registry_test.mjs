import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { buildInvocation } from "../runtime/lib/worker.mjs";
import { discoverProvider, providerForRole, providerNames, providerProfile, providerSpec } from "../runtime/lib/providers.mjs";
import { PROVIDER_TEMPLATES, providerChoices, requireReadyProvider, stageCodexHome, upsertProvider, wireMismatches } from "../runtime/lib/userProviders.mjs";

assert.deepEqual(
  PROVIDER_TEMPLATES.filter((template) => ["openai", "gemini", "zai", "anthropic", "custom"].includes(template.id)).map((template) => template.id),
  ["openai", "gemini", "zai", "anthropic", "custom"],
  "the provider catalog covers native and compatible endpoint families",
);
// Codex 0.149+ removed the chat-completions wire, so the GLM templates must
// default to the claude worker on Z.ai's Anthropic-compatible endpoint.
for (const glmId of ["zai", "bigmodel"]) {
  const glm = PROVIDER_TEMPLATES.find((template) => template.id === glmId);
  assert.equal(glm.worker, "claude", `${glmId} template defaults to the claude worker`);
  assert.equal(glm.protocol, "anthropic", `${glmId} template uses the Anthropic wire`);
}
const userRegistry = { version: 2, providers: {} };
upsertProvider(userRegistry, "zai-main", {
  label: "My GLM",
  protocol: "anthropic",
  worker: "claude",
  base_url: "https://api.z.ai/api/anthropic",
  api_key: "secret-value",
  model: "glm-5.3",
  models: ["glm-5.3", "glm-5.3-flash"],
  thinking_level: "high",
});
const choice = providerChoices(userRegistry)[0];
assert.deepEqual({ id: choice.id, protocol: choice.protocol, base_url: choice.base_url, model: choice.model, thinking_level: choice.thinking_level }, { id: "zai-main", protocol: "anthropic", base_url: "https://api.z.ai/api/anthropic", model: "glm-5.3", thinking_level: "high" }, "provider choices expose editable connection settings without key material");
assert.equal(Object.hasOwn(choice, "api_key"), false, "provider choices never expose API keys");
assert.equal(choice.ready, true, "claude worker on the Anthropic endpoint is a viable provider");

// Wire mismatches must be flagged BEFORE any spend: requireReadyProvider refuses.
const mismatched = { version: 2, providers: {} };
upsertProvider(mismatched, "codex-glm", {
  label: "GLM via codex", protocol: "openai", worker: "codex",
  base_url: "https://api.z.ai/api/coding/paas/v4", api_key: "secret-value", model: "glm-5.3-flash",
});
const flagged = providerChoices(mismatched)[0];
assert.equal(flagged.ready, false, "codex worker on a chat-only endpoint is refused as not ready");
assert.ok(flagged.problems.some((problem) => problem.includes("claude")), "the refusal names the fix: switch the worker to claude");
assert.throws(() => requireReadyProvider("codex-glm", { registry: mismatched }), /claude/, "model generation refuses a wire-mismatched provider before spending");

const claudeMismatch = wireMismatches("claude", "https://api.z.ai/api/coding/paas/v4");
assert.equal(claudeMismatch.length, 1, "claude worker on an OpenAI chat endpoint is flagged");
assert.deepEqual(wireMismatches("codex", "https://api.openai.com/v1"), [], "codex on a Responses-capable endpoint is clean");
assert.deepEqual(wireMismatches("claude", "https://api.z.ai/api/anthropic"), [], "claude on the Anthropic endpoint is clean");

// The staged codex home must declare the only wire current codex accepts.
const stagedHome = stageCodexHome({ id: "atl-wire-probe", label: "probe", worker: "codex", base_url: "https://api.openai.com/v1", api_key: "k", model: "gpt-5.6" });
const stagedConfig = fs.readFileSync(path.join(stagedHome, "config.toml"), "utf8");
assert.match(stagedConfig, /wire_api = "responses"/, "staged codex config declares the Responses wire (chat was removed in codex 0.149)");
assert.doesNotMatch(stagedConfig, /wire_api = "chat"/, "staged codex config never declares the removed chat wire");
fs.rmSync(stagedHome, { recursive: true, force: true });
assert.equal(fs.existsSync(path.join(os.homedir(), ".atl", "codex", "atl-wire-probe")), false, "the probe's staged codex home is cleaned up");

const config = {
  providers: {
    default: "glm",
    auth: "subscription",
    by_role: { sage: "claude" },
    catalog: {
      glm: {
        command: process.execPath,
        model: "glm-4.6",
        args: ["--version", "--task", "{task_id}", "--workspace", "{workspace}", "-"],
      },
    },
  },
};

const profile = providerProfile(config);
assert.deepEqual(providerForRole(profile, "rowan"), { worker: "glm", auth: "subscription", model: "glm-4.6", source: "project default" });
assert.deepEqual(providerForRole(profile, "sage"), { worker: "claude", auth: "subscription", model: null, source: "role-override" });
assert.ok(providerNames(config).includes("glm"), "custom catalog providers appear in discovery and UI lists");
assert.equal(providerSpec(profile, "glm").model, "glm-4.6");

const discovered = discoverProvider("glm", { command: process.execPath, env: { PATH: "" } });
assert.equal(discovered.available, true, "absolute custom commands can be preflighted without PATH");

const invocation = buildInvocation("glm", {
  root: "C:\\project",
  workspace: "C:\\project\\.trust\\manager\\workspaces\\T-001",
  role: "rowan",
  task: { id: "T-001", title: "custom provider", status: "assigned", completion_checks: [] },
  auth: "subscription",
  provider: providerSpec(profile, "glm"),
});
assert.equal(invocation.command, process.execPath);
assert.deepEqual(invocation.args.slice(0, 5), ["--version", "--task", "T-001", "--workspace", "C:\\project\\.trust\\manager\\workspaces\\T-001"]);
assert.equal(invocation.args.at(-1), "-", "custom provider receives its ATL prompt on stdin when configured with '-' ");

const codexProfile = providerProfile({ providers: { default: "codex", model: "gpt-5.6-terra" } });
const codexInvocation = buildInvocation("codex", {
  root: "C:\\project",
  workspace: "C:\\project\\.trust\\manager\\workspaces\\T-002",
  role: "rowan",
  task: { id: "T-002", title: "pinned model", status: "assigned", completion_checks: [] },
  auth: "subscription",
  provider: providerSpec(codexProfile, "codex"),
});
assert.deepEqual(codexInvocation.args.slice(0, 3), ["exec", "--model", "gpt-5.6-terra"], "built-in Codex receives the selected model flag");

console.log("PASS: configurable provider registry — GLM/ZCode-style command + model + argv expansion");
