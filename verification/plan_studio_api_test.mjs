import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { loadPlanDraft } from "../runtime/lib/plan-studio.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";

// The provider registry lives in the machine home; this test pins USERPROFILE
// to a scratch home so the configured-provider contract is tested without
// touching (or depending on) the real ~/.atl/providers.json.
const realHome = process.env.USERPROFILE;
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-home-"));
process.env.USERPROFILE = fakeHome;
fs.mkdirSync(path.join(fakeHome, ".atl"), { recursive: true });
fs.writeFileSync(path.join(fakeHome, ".atl", "providers.json"), JSON.stringify({
  providers: {
    testprov: { id: "testprov", label: "Test Provider", worker: "claude", base_url: "https://example.test/api", api_key: "sk-secret-value", model: "m-1", models: ["m-1", "m-2"] },
  },
}, null, 2));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-api-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
saveState(root, emptyState());

let planningCalls = 0;
const validPlan = {
  title: "Model-planned feature",
  objective: "Plan the bounded feature end to end",
  completion_checks: ["the feature is observable"],
  acceptance_examples: [{ given: "g", when: "w", then: "t" }],
  implementation_steps: [{ step: "Implement it", files: ["src/"], verify: "node verification/plan_studio_api_test.mjs" }],
  verifier_commands: ["node verification/plan_studio_api_test.mjs"],
};
const fakeInvoke = async ({ request }) => {
  planningCalls += 1;
  if (request.current_proposal) {
    return { code: 0, text: JSON.stringify({ title: "Regenerated card", objective: "Regenerated objective", completion_checks: ["regen check"] }), provider: "testprov", model: "m-2" };
  }
  return { code: 0, text: JSON.stringify(validPlan), provider: "testprov", model: "m-1" };
};

const running = await startControlPlaneServer(root, { planningInvoke: fakeInvoke });
const post = async (pathname, body) => fetch(`${running.url}${pathname.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, body: await response.json() }));
const command = (text) => post("/api/command", { command: text });

try {
  const client = await fetch(`${running.url}control-plane-client.js`).then((response) => response.text());
  assert.match(client, /\/api\/providers/, "the studio fetches configured providers from the registry bridge");
  assert.match(client, /data-pfield/, "task cards expose editable fields");
  assert.match(client, /data-card-worker/, "task cards offer a worker selector");
  assert.match(client, /card-reset-defaults/, "cards offer a snap-back-to-default control");
  assert.match(client, /queue-delete:/, "the queues tab exposes a delete action");
  assert.match(client, /provider-manager/, "the studio links to the provider manager modal");
  assert.match(client, /CURRENTLY CONNECTED/, "provider manager leads with the currently connected model");
  assert.match(client, /pm-edit:/, "provider manager keeps connected providers compact until edit is requested");
  assert.match(client, /pm-save:/, "provider manager exposes one save path inside edit mode");
  assert.match(client, /Already saved in the provider connection/, "provider manager labels the current model as already persisted");
  assert.match(client, /Unsaved model change/, "provider manager exposes dirty state before saving a changed model");
  assert.match(client, /pm-add/, "providers can be added from the browser");
  assert.match(client, /run-preview-multi/, "the browser exposes multi-queue previews");
  assert.match(client, /Generate with model/, "the browser exposes the model generation mode");
  assert.match(client, /data-studio-status/, "model generation exposes an announced, visible pending state");
  assert.match(client, /data-studio-elapsed/, "the pending state reports elapsed time during a provider call");
  assert.match(client, /aria-busy/, "the plan output marks itself busy while model generation is pending");
  assert.match(client, /data-rejected-plan-preview/, "a rejected model response renders in Card 03 as a review-only full-plan preview");
  assert.match(client, /if \(studioBusy\) return/, "a pending request cannot spend a second model-planning session");
  assert.match(client, /disabled aria-disabled/, "the visible generate control is semantically disabled while pending");

  const providers = await fetch(`${running.url}api/providers`).then((response) => response.json());
  assert.equal(providers.providers.length, 1, "the picker lists configured providers only");
  assert.equal(providers.providers[0].id, "testprov");
  assert.equal(providers.providers[0].ready, true, "a fully configured provider is marked ready");
  assert.ok(!("api_key" in providers.providers[0]), "the picker never exposes API keys");
  assert.ok(providers.templates.some((template) => template.id === "zai"), "the endpoint presets ship to the browser");

  // browser provider management: add → key → use → remove; keys never echo
  const addedProvider = await post("/api/providers", { action: "add", id: "webprov", template: "zai", model: "glm-4.6" });
  assert.equal(addedProvider.status, 200, "a provider can be added from the browser");
  assert.ok(addedProvider.body.providers.some((provider) => provider.id === "webprov"), "the added provider appears in the list");
  const webEntry = addedProvider.body.providers.find((provider) => provider.id === "webprov");
  assert.equal(webEntry.ready, false, "a newly added provider is not ready yet");
  assert.ok(webEntry.problems.some((problem) => /API key/.test(problem)), "the added provider waits for its key");
  assert.ok(!webEntry.problems.some((problem) => /base URL/.test(problem)), "the zai template prefilled the endpoint");
  const keyed = await post("/api/providers", { action: "key", id: "webprov", key: "sk-web-secret-value" });
  assert.equal(keyed.body.providers.find((provider) => provider.id === "webprov").ready, true, "storing the key readies the provider");
  assert.ok(!JSON.stringify(keyed.body).includes("sk-web-secret-value"), "the raw key is never echoed back");
  const used = await post("/api/providers", { action: "use", id: "webprov" });
  assert.equal(used.body.defaultProvider, "webprov", "use marks the project default");
  const projectConfig = JSON.parse(fs.readFileSync(path.join(root, "config", "manager.json"), "utf8"));
  assert.equal(projectConfig.providers.use, "webprov", "the project config records the default provider");
  const switched = await post("/api/providers", { action: "update", id: "webprov", model: "glm-5.3-flash" });
  assert.equal(switched.body.providers.find((provider) => provider.id === "webprov").model, "glm-5.3-flash", "the manager can persist a selected model for the active provider");
  const removed = await post("/api/providers", { action: "remove", id: "webprov" });
  assert.ok(!removed.body.providers.some((provider) => provider.id === "webprov"), "remove drops the provider from the registry");
  assert.equal(removed.body.defaultProvider, null, "removing the default clears the project pointer");
  const badProviderAction = await post("/api/providers", { action: "nonsense" });
  assert.equal(badProviderAction.status, 400, "unknown provider actions are refused");

  const missingProvider = await post("/api/plan/generate", { intent: "build it", confirm: true });
  assert.equal(missingProvider.status, 400, "model generation without a provider is refused");
  assert.match(missingProvider.body.error, /provider id is required/);

  const unknownProvider = await post("/api/plan/generate", { intent: "build it", provider: "ghost", confirm: true });
  assert.equal(unknownProvider.status, 400, "an unconfigured provider is refused");
  assert.match(unknownProvider.body.error, /not configured/);
  assert.equal(planningCalls, 0, "refusals happen before any provider call");

  const unconfirmed = await post("/api/plan/generate", { intent: "build it", provider: "testprov", confirm: false });
  assert.equal(unconfirmed.status, 400, "model generation needs the explicit confirmation flag");
  assert.match(unconfirmed.body.error, /explicit confirmation/);
  assert.equal(planningCalls, 0, "an unconfirmed call never reaches the provider");

  const generated = await post("/api/plan/generate", { intent: "Plan the bounded feature end to end", provider: "testprov", confirm: true });
  assert.equal(generated.status, 200, "a ready provider generates the plan");
  assert.equal(planningCalls, 1, "exactly one planning call is spent");
  assert.equal(generated.body.draft.label.mode, "model", "the draft is labelled as model output");
  assert.match(generated.body.draft.label.label, /testprov \/ m-1/, "the label names the provider and model");
  assert.equal(generated.body.draft.artifact.task_proposals.length, 1, "model output gets typed task cards");
  const draftId = generated.body.draft.id;

  const cardEdit = await post("/api/plan/card", { draftId, action: "edit", proposalId: "p1", patch: { title: "Renamed card", checks: ["renamed check"] } });
  assert.equal(cardEdit.status, 200, "card edits persist through the API");
  assert.equal(cardEdit.body.draft.artifact.task_proposals[0].title, "Renamed card");
  assert.equal(cardEdit.body.draft.artifact.task_proposals[0].revision, 2, "an API edit bumps the revision");

  const feedback = await post("/api/plan/card", { draftId, action: "feedback", proposalId: "p1", text: "Tighten the scope" });
  assert.equal(feedback.body.draft.artifact.task_proposals[0].feedback.length, 1, "feedback records through the API");

  const regenServer = await startControlPlaneServer(root, { planningInvoke: fakeInvoke });
  const regen = await fetch(`${regenServer.url}api/plan/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId, proposalId: "p1", confirm: true }) }).then(async (response) => ({ status: response.status, body: await response.json() }));
  await new Promise((resolve) => regenServer.server.close(resolve));
  assert.equal(regen.status, 200, "one-card regeneration works through the API");
  assert.equal(regen.body.draft.artifact.task_proposals[0].title, "Regenerated card");
  assert.equal(regen.body.draft.artifact.task_proposals[0].revision, 3, "regeneration bumps the revision");
  assert.ok(regen.body.draft.artifact.task_proposals[0].revisions.length >= 2, "regeneration keeps prior versions");

  const approved = await command(`plan approve ${draftId}`);
  assert.equal(approved.body.ok, true, "approval works through the command bridge");
  assert.equal(approved.body.created, true, "approval reports creation");
  assert.ok(String(approved.body.queueId || "").startsWith("plan-"), "approval returns the plan queue id");
  assert.equal(approved.body.taskIds.length, 1, "approval returns the generated task ids");
  const reapproved = await command(`plan approve ${draftId}`);
  assert.equal(reapproved.body.created, false, "browser re-approval creates no duplicates");
  assert.deepEqual(reapproved.body.taskIds, approved.body.taskIds, "re-approval returns the same ids");

  const paused = await command("queue create sidequeue --name Side");
  assert.equal(paused.body.ok, true, "a second queue can be created for the multi-queue flow");
  await command("queue pause sidequeue");
  const multiPreview = await post("/api/run/preview", { queueIds: [approved.body.queueId, "sidequeue"] });
  assert.equal(multiPreview.status, 200, "the multi-queue preview works");
  assert.ok(multiPreview.body.lines.some((line) => /queue sidequeue: paused/.test(line)), "a paused selected queue is narrated as skipped");
  assert.equal(multiPreview.body.preview.roundRobin, true, "the multi preview is labelled round-robin");
  const badQueue = await post("/api/run/preview", { queueIds: ["ghost-queue"] });
  assert.equal(badQueue.status, 400, "an unknown-only selection refuses the preview");
  const unconfirmedRun = await post("/api/run", { queueIds: [approved.body.queueId] });
  assert.equal(unconfirmedRun.status, 400, "multi-queue execution still requires explicit confirmation");

  // queue delete = archive: leaves the board, tasks untouched, default protected
  const tmpQueue = await command("queue create deleteme --name Delete me");
  assert.equal(tmpQueue.body.ok, true, "a disposable queue can be created");
  const deleted = await command("queue archive deleteme");
  assert.equal(deleted.body.ok, true, "queue delete works through the command bridge");
  const afterDelete = await fetch(`${running.url}api/snapshot`).then((response) => response.json());
  assert.ok(!afterDelete.queues.items.some((queue) => queue.id === "deleteme"), "a deleted queue leaves the board");
  const delDefault = await command("queue archive default");
  assert.equal(delDefault.body.ok, false, "the default queue refuses deletion");
} finally {
  await new Promise((resolve) => running.server.close(resolve));
  if (realHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realHome;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

// malformed model output preserves the last valid draft (fresh isolated project)
{
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-api-malformed-"));
  fs.mkdirSync(path.join(root2, ".trust", "manager"), { recursive: true });
  saveState(root2, emptyState());
  process.env.USERPROFILE = fakeHome;
  fs.mkdirSync(path.join(fakeHome, ".atl"), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, ".atl", "providers.json"), JSON.stringify({ providers: { testprov: { id: "testprov", label: "T", worker: "claude", base_url: "https://example.test", api_key: "sk", model: "m" } } }));
  let calls = 0;
  let answer = JSON.stringify(validPlan);
  const server = await startControlPlaneServer(root2, { planningInvoke: async ({ logPath }) => {
    calls += 1;
    if (calls > 1) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, "RAW MODEL OUTPUT LINE 1\nRAW MODEL OUTPUT LINE 2\n");
    }
    return { code: 0, text: answer, provider: "testprov", model: "m" };
  } });
  try {
    const post2 = async (pathname, body) => fetch(`${server.url}${pathname.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const first = await post2("/api/plan/generate", { intent: "valid plan please", provider: "testprov", confirm: true });
    assert.equal(first.status, 200, "the first valid generation lands");
    const before = JSON.stringify(loadPlanDraft(root2, first.body.draft.id).artifact);
    answer = "{\"title\": \"truncated";
    const broken = await post2("/api/plan/generate", { intent: "valid plan please", provider: "testprov", confirm: true });
    assert.equal(broken.status, 400, "malformed model output is refused with a 400");
    assert.match(broken.body.error, /valid JSON/);
    assert.equal(broken.body.providerResponse, "{\"title\": \"truncated", "the complete rejected provider response is returned for the Card 03 review-only preview");
    assert.deepEqual(broken.body.providerLogLines, ["RAW MODEL OUTPUT LINE 1", "RAW MODEL OUTPUT LINE 2"], "the failed call ships the raw response tail for the Show-raw-response view");
    assert.equal(JSON.stringify(loadPlanDraft(root2, first.body.draft.id).artifact), before, "the last valid preview survives the failed model call untouched");
    assert.equal(calls, 2, "each generation attempt spent exactly one bounded call");
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
    if (realHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = realHome;
    fs.rmSync(root2, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
}

// provider update + endpoint model discovery (9router-style load)
{
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), "atl-plan-api-models-"));
  fs.mkdirSync(path.join(root3, ".trust", "manager"), { recursive: true });
  saveState(root3, emptyState());
  process.env.USERPROFILE = fakeHome;
  fs.mkdirSync(path.join(fakeHome, ".atl"), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, ".atl", "providers.json"), JSON.stringify({ providers: { testprov: { id: "testprov", label: "T", worker: "claude", protocol: "anthropic", base_url: "https://example.test", api_key: "sk", model: "m" } } }));
  // a throwaway endpoint that answers the anthropic model-list shape
  const { createServer: createHttpServer } = await import("node:http");
  const endpoint = createHttpServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "glm-9" }, { id: "glm-2" }] }));
  });
  await new Promise((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  const endpointPort = endpoint.address().port;
  const server = await startControlPlaneServer(root3, { planningInvoke: async () => ({ code: 0, text: JSON.stringify(validPlan), provider: "testprov", model: "m" }) });
  try {
    const post3 = async (pathname, body) => fetch(`${server.url}${pathname.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const renamed = await post3("/api/providers", { action: "update", id: "testprov", label: "Renamed Provider", base_url: `http://127.0.0.1:${endpointPort}` });
    assert.equal(renamed.status, 200, "an existing provider can be edited from the browser");
    assert.equal(renamed.body.providers.find((provider) => provider.id === "testprov").label, "Renamed Provider", "the label edit persists");
    const models = await post3("/api/providers", { action: "models", id: "testprov" });
    assert.equal(models.status, 200, "model discovery queries the configured endpoint");
    assert.deepEqual(models.body.models, ["glm-2", "glm-9"], "the fetched model ids are returned sorted");
    assert.ok(String(models.body.source).includes(String(endpointPort)), "the model list came from the configured endpoint");
    const persisted = await post3("/api/providers", { action: "update", id: "testprov", models: models.body.models });
    assert.deepEqual(persisted.body.providers.find((provider) => provider.id === "testprov").models, ["glm-2", "glm-9"], "the loaded model list persists on the provider");
    await post3("/api/providers", { action: "add", id: "keyless", label: "Keyless", worker: "claude", base_url: "https://example.test" });
    const refused = await post3("/api/providers", { action: "models", id: "keyless" });
    assert.equal(refused.status, 400, "model discovery without a stored key is refused");
    assert.match(refused.body.error, /no API key/);
  } finally {
    await new Promise((resolve) => { endpoint.close(resolve); server.server.close(resolve); });
    if (realHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = realHome;
    fs.rmSync(root3, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
}

console.log("PASS: Plan Studio API — provider picker, refusals before spend, card ops, regeneration, Plan Queue approval, multi-queue preview");
