// Host model routing as a first-class provider (#56): detection contracts and
// the atl_command registration call, including skip-if-registered and the
// no-secret-in-argv rule.
import assert from "node:assert/strict";
import { detectHostRelay, ensureHostProvider } from "../plugins/deepseek-host.mjs";

const workspace = { workspaceRegistry: { list: async () => [{ path: "/tmp/proj-a" }] } };
const hostCalling = (handler) => ({ call: async (name, payload) => { assert.equal(name, "atl_command"); return handler(payload); } });

// Detection: ctx surface first, env fallback, none.
assert.deepEqual(
  detectHostRelay({ modelRouting: { list: () => ({ endpoint: "http://127.0.0.1:9/v1", models: ["m1", "m2"] }) } }),
  { endpoint: "http://127.0.0.1:9/v1", models: ["m1", "m2"], source: "host" },
  "a ctx.modelRouting surface with an endpoint is detected",
);
assert.deepEqual(
  detectHostRelay({}, { ATL_HOST_RELAY_URL: " http://relay/v1 ", ATL_HOST_RELAY_MODELS: "a, b,,c" }),
  { endpoint: "http://relay/v1", models: ["a", "b", "c"], source: "env" },
  "the env contract is the fallback and parses the model list",
);
assert.equal(detectHostRelay({}, {}), null, "no surface and no env means no relay");
assert.equal(detectHostRelay({ modelRouting: { list: () => { throw new Error("boom"); } } }, {}), null, "a throwing ctx surface falls through to env");

// Registration: CLI add with --key-env (never the key material in argv).
const calls = [];
const host = hostCalling(async (payload) => {
  calls.push(payload.args);
  if (calls.length === 1) return { status: "completed", stdout: JSON.stringify({ providers: [] }) };
  return { status: "completed", stdout: "Saved provider \"host\"" };
});
const report = await ensureHostProvider(workspace, host, { env: { ATL_HOST_RELAY_URL: "http://relay/v1", ATL_HOST_RELAY_KEY: "host-secret", ATL_HOST_RELAY_MODELS: "glm-5.3" } });
assert.equal(report.hostProvider, "registered", "registration reports success");
assert.equal(calls.length, 2, "list then add");
assert.deepEqual(calls[1].slice(0, 6), ["provider", "add", "host", "--worker", "openai-http", "--base-url"], "the add call registers the host provider");
assert.ok(calls[1].includes("--key-env") && calls[1][calls[1].indexOf("--key-env") + 1] === "ATL_HOST_RELAY_KEY", "the key comes from the environment variable");
assert.ok(!JSON.stringify(calls).includes("host-secret"), "the key material never appears in argv");

// Skip: an existing host entry with the same endpoint is left untouched.
const skipCalls = [];
const skipHost = hostCalling(async (payload) => {
  skipCalls.push(payload.args);
  return { status: "completed", stdout: JSON.stringify({ providers: [{ id: "host", worker: "openai-http", base_url: "http://relay/v1", ready: true }] }) };
});
const skipReport = await ensureHostProvider(workspace, skipHost, { env: { ATL_HOST_RELAY_URL: "http://relay/v1", ATL_HOST_RELAY_KEY: "k" } });
assert.equal(skipReport.hostProvider, "registered", "an identical registered host is a no-op success");
assert.equal(skipCalls.length, 1, "only the inventory call runs; no second registration");

// Different endpoint is reported, still not re-registered over user edits.
const diffCalls = [];
const diffHost = hostCalling(async (payload) => {
  diffCalls.push(payload.args);
  return { status: "completed", stdout: JSON.stringify({ providers: [{ id: "host", base_url: "http://other/v1" }] }) };
});
const diffReport = await ensureHostProvider(workspace, diffHost, { env: { ATL_HOST_RELAY_URL: "http://relay/v1", ATL_HOST_RELAY_KEY: "k" } });
assert.match(diffReport.hostProvider, /different endpoint/, "a user-modified host entry is reported, not overwritten");
assert.equal(diffCalls.length, 1, "no add call runs over a user-modified entry");

// Unavailable: env URL without a key names the missing variable.
const noKey = await ensureHostProvider(workspace, hostCalling(async () => ({ status: "completed", stdout: "{}" })), { env: { ATL_HOST_RELAY_URL: "http://relay/v1" } });
assert.match(noKey.hostProvider, /ATL_HOST_RELAY_KEY/, "a missing key is named");

// No relay at all is reported, not thrown.
const none = await ensureHostProvider(workspace, hostCalling(async () => ({ status: "completed", stdout: "{}" })), { env: {} });
assert.match(none.hostProvider, /unavailable/, "absence is reported");

console.log("PASS: host relay detection, registration, skip-if-present and limitation reporting");
