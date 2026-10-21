import assert from "node:assert/strict";
import process from "node:process";
import { buildInvocation } from "../runtime/lib/worker.mjs";
import { discoverProvider, providerForRole, providerNames, providerProfile, providerSpec } from "../runtime/lib/providers.mjs";

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
