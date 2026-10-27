import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { builtinAuthStatus, builtinProviderStatus } from "../runtime/lib/providers.mjs";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// Auth-status detection reads the worker CLIs' own files under the user home.
// Every case pins a scratch home through USERPROFILE so the real machine's
// sign-in state can never flip a test.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-builtin-home-"));
const env = { USERPROFILE: fakeHome, PATH: "" };

function writeHome(relative, content) {
  const file = path.join(fakeHome, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
}

// codex: ChatGPT subscription sign-in (auth_mode chatgpt + token set)
writeHome(".codex/auth.json", { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: "x", access_token: "x", refresh_token: "x", account_id: "x" }, last_refresh: "2026-10-25T04:50:03Z" });
assert.deepEqual(
  (({ signedIn, method, ...rest }) => ({ signedIn, method, detail: Boolean(rest.detail) }))(builtinAuthStatus("codex", { env })),
  { signedIn: true, method: "chatgpt", detail: true },
  "codex auth.json with chatgpt mode reports a ChatGPT subscription sign-in",
);
assert.ok(!JSON.stringify(builtinAuthStatus("codex", { env })).includes("access_token"), "the status never echoes token material");

// codex: legacy token shape without auth_mode still counts as signed in
writeHome(".codex/auth.json", { OPENAI_API_KEY: null, tokens: { id_token: "x" } });
assert.equal(builtinAuthStatus("codex", { env }).method, "chatgpt", "a token-only auth.json is treated as ChatGPT sign-in");

// codex: API-key sign-in is visible but flagged as the wrong mode for plans
writeHome(".codex/auth.json", { OPENAI_API_KEY: "sk-paid-credits" });
const apiKeyState = builtinAuthStatus("codex", { env });
assert.equal(apiKeyState.signedIn, true, "an API-key auth.json is signed in");
assert.equal(apiKeyState.method, "api-key", "API-key sign-in is labeled api-key");
assert.match(apiKeyState.detail, /Sign in with ChatGPT/, "API-key sign-in points at the ChatGPT-plan rerun");
assert.ok(!JSON.stringify(apiKeyState).includes("sk-paid-credits"), "the stored API key never appears in the status");

// codex: signed out — file missing, and file present but empty
fs.rmSync(path.join(fakeHome, ".codex"), { recursive: true, force: true });
assert.deepEqual(
  (({ signedIn, method }) => ({ signedIn, method }))(builtinAuthStatus("codex", { env })),
  { signedIn: false, method: null },
  "a missing auth.json is signed out",
);
writeHome(".codex/auth.json", {});
assert.equal(builtinAuthStatus("codex", { env }).signedIn, false, "an auth.json with no tokens and no key is signed out");

// claude: subscription credentials, then signed out
writeHome(".claude/.credentials.json", { claudeAiOauth: { accessToken: "x", scopes: ["x"] } });
assert.deepEqual(
  (({ signedIn, method }) => ({ signedIn, method }))(builtinAuthStatus("claude", { env })),
  { signedIn: true, method: "subscription" },
  "claude credentials with an OAuth block report a subscription sign-in",
);
fs.rmSync(path.join(fakeHome, ".claude"), { recursive: true, force: true });
writeHome(".claude.json", { oauthAccount: { account: {} } });
assert.equal(builtinAuthStatus("claude", { env }).method, "subscription", "claude fallback reads the oauth account in .claude.json");
fs.rmSync(path.join(fakeHome, ".claude.json"), { force: true });
assert.equal(builtinAuthStatus("claude", { env }).signedIn, false, "claude with no credential files is signed out");

// Aggregate browser view: shape, honest install state, no secrets.
const status = builtinProviderStatus({}, { env });
assert.deepEqual(status.map((worker) => worker.id), ["codex", "claude", "gapgpt"], "all built-in workers are reported");
for (const worker of status) {
  assert.equal(worker.auth, "subscription", "built-in workers default to subscription auth");
  assert.equal(worker.installed, false, "an empty PATH means the CLI is reported not installed");
  assert.equal(typeof worker.loginCommand, "string", "each worker carries its login command");
  assert.ok(worker.loginNote.length > 10, "each worker explains how to sign in");
  assert.ok(worker.installHint, "an uninstalled worker carries its install hint");
}
assert.equal(status[0].loginCommand, "codex login", "codex connects with codex login");
assert.match(status[0].loginNote, /Sign in with ChatGPT/, "codex guidance steers to the ChatGPT flow, not API-key sign-in");

// Installed + signed-in codex with a pinned model reads as ready.
writeHome(".codex/auth.json", { auth_mode: "chatgpt", tokens: { id_token: "x" } });
const codexBinDir = path.join(fakeHome, "bin");
fs.mkdirSync(codexBinDir, { recursive: true });
fs.writeFileSync(path.join(codexBinDir, "codex.cmd"), "@echo off\r\n", "utf8");
writeHome(".codex/config.toml", 'model = "gpt-5.6-codex"\n');
const ready = builtinProviderStatus({}, { env: { ...env, PATH: codexBinDir } })[0];
assert.equal(ready.installed, true, "a codex.cmd on PATH is discovered");
assert.equal(ready.signedIn, true, "the signed-in codex is connected");
assert.equal(ready.defaultModel, "gpt-5.6-codex", "the CLI's pinned default model is surfaced");

// The served /api/providers payload exposes builtin status to the browser.
const realHome = process.env.USERPROFILE;
process.env.USERPROFILE = fakeHome;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-builtin-root-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());
const running = await startControlPlaneServer(root);
try {
  const payload = await fetch(`${running.url}api/providers`).then((response) => response.json());
  assert.ok(Array.isArray(payload.builtin), "GET /api/providers carries the builtin array");
  assert.deepEqual(payload.builtin.map((worker) => worker.id), ["codex", "claude", "gapgpt"], "the browser sees all built-in workers");
  assert.ok(payload.builtin.every((worker) => !JSON.stringify(worker).includes("access_token")), "no token material ships to the browser");
  assert.ok(!JSON.stringify(payload).includes("sk-paid-credits"), "no API-key material ships to the browser");
  const codex = payload.builtin.find((worker) => worker.id === "codex");
  assert.equal(codex.signedIn, true, "the served codex status matches the filesystem evidence");
  assert.equal(codex.method, "chatgpt", "the served codex method is chatgpt");
} finally {
  running.server.close();
  process.env.USERPROFILE = realHome;
}

console.log("builtin_provider_status_test: all assertions passed");
