import assert from "node:assert/strict";
import http from "node:http";
import { validateProviderEntry } from "../runtime/lib/userProviders.mjs";
import { invokePlanningProvider } from "../runtime/lib/plan-model.mjs";

let seen = null;
let delayResponse = false;
const server = http.createServer(async (request, response) => {
  if (request.url === "/redirect/chat/completions") { response.writeHead(302, { location: "/v1/chat/completions" }).end(); return; }
  if (delayResponse) { await new Promise(resolve => setTimeout(resolve, 100)); }
  let body = "";
  try { for await (const chunk of request) body += chunk; } catch { return; }
  seen = { url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) };
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ choices: [{ message: { content: "{\"summary\":\"ok\"}" } }] }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;
const entry = { id: "relay", worker: "openai-http", protocol: "openai", base_url: base, api_key: "test-secret-do-not-log", model: "relay-model" };
try {
  assert.deepEqual(validateProviderEntry(entry), []);
  assert.ok(validateProviderEntry({ ...entry, base_url: "http://example.com/v1" }).some(problem => /HTTPS|loopback/.test(problem)));
  assert.ok(validateProviderEntry({ ...entry, base_url: "http://user:password@127.0.0.1/v1" }).some(problem => /credentials/.test(problem)));
  assert.ok(validateProviderEntry({ ...entry, model: "" }).some(problem => /model/.test(problem)));

  const result = await invokePlanningProvider(process.cwd(), entry, { request: { intent: "bounded test" }, timeoutMs: 1000 });
  assert.equal(result.code, 0);
  assert.match(result.text, /summary/);
  assert.equal(seen.url, "/v1/chat/completions");
  assert.equal(seen.authorization, "Bearer test-secret-do-not-log");
  assert.equal(seen.body.model, "relay-model");
  assert.equal(seen.body.stream, false);
  assert.equal(seen.body.messages.length, 1);
  assert.match(seen.body.messages[0].content, /bounded test/);

  await assert.rejects(invokePlanningProvider(process.cwd(), { ...entry, base_url: base.replace("/v1", "/redirect") }, { request: {}, timeoutMs: 1000 }), /request failed|fetch failed/i);
  delayResponse = true;
  await assert.rejects(invokePlanningProvider(process.cwd(), entry, { request: {}, timeoutMs: 20 }), /timed out or was cancelled/);
  console.log("PASS: direct OpenAI-compatible provider validates transport, uses chat completions, bounds requests, rejects redirects, and does not expose credentials");
} finally {
  delayResponse = false;
  await new Promise(resolve => server.close(resolve));
}
