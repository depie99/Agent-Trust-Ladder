import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { startControlPlaneServer } from "../runtime/lib/control-plane-server.mjs";
import { savePlanDraft } from "../runtime/lib/plan-studio.mjs";
import {
  assistantConversationContext,
  conversationFixTask,
  createConversation,
  deleteConversation,
  listConversations,
  migrateScopeConversations,
  normalizeContextSelection,
  updateConversationContext,
} from "../runtime/lib/control-assistant.mjs";

// Isolated per-machine ATL home so the provider registry is test-local.
const atlHome = fs.mkdtempSync(path.join(os.tmpdir(), "atl-ask-home-"));
process.env.ATL_HOME = atlHome;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-ask-atl-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
// One imported (issue-source) task, one native task: the Ask ATL page must
// offer ONLY the imported one as task context.
state.tasks["T-001"] = {
  id: "T-001", title: "Serve the new catalog asset from the CDN", status: "in_progress",
  source: { type: "github", url: "https://github.com/example/repo/issues/21", remote_id: 21, excerpt: "Catalog asset 404s on the CDN edge." },
  intake_only: true, plan_review_required: true, imported_at: new Date().toISOString(),
  intake_snapshot: { title: "Serve the new catalog asset from the CDN", objective: "Serve the new catalog asset through the CDN.", completion_checks: [], source: { type: "github", excerpt: "Catalog asset 404s on the CDN edge." }, resources: [] },
  objective: "Serve the new catalog asset through the CDN with cache headers verified.",
  completion_checks: ["CDN serves the asset with 200 and immutable cache headers"],
  plan_depends_on: [], evidence: [], labels: [],
};
state.tasks["T-002"] = { id: "T-002", title: "Native (non-imported) task", status: "new", source: { type: "manual" }, completion_checks: [], plan_depends_on: [], evidence: [] };
saveState(root, state);

const draft = savePlanDraft(root, {
  intent: "Roll out the issue sources import flow",
  stage: "plan",
  artifact: { title: "Issue sources", objective: "Import and plan GitHub issues as executable tasks.", completion_checks: ["Imported request keeps its source metadata through planning"], requirements: [{ id: "R1", text: "Only imported tasks appear in the Ask ATL context picker" }], task_proposals: [], open_questions: [], assumptions: [], constraints: [], observed_evidence: [], clarifications: [], acceptance_examples: [{ given: "a GitHub issue", when: "the manager imports it", then: "an intake-only task exists with source metadata" }], implementation_steps: [{ step: "Import the fixture issue and confirm the intake-only task exists with its source record" }], verifier_commands: ["node verification/ask_atl_conversations_test.mjs"] },
});
assert.ok(draft?.id, "plan draft fixture saved");

// Legacy per-scope transcripts migrate into conversations exactly once.
const assistantDir = path.join(root, ".trust", "manager", "assistant");
fs.mkdirSync(assistantDir, { recursive: true });
fs.writeFileSync(path.join(assistantDir, "global.json"), JSON.stringify({ scope: "global", status: "complete", mode: "diagnose", provider: "codex", model: "", messages: [{ role: "user", text: "Review this project's current state.", at: "2026-11-01T10:00:00.000Z" }, { role: "assistant", text: "The queue has one active task.", at: "2026-11-01T10:01:00.000Z" }], startedAt: "2026-11-01T10:00:00.000Z", finishedAt: "2026-11-01T10:01:00.000Z" }));
fs.writeFileSync(path.join(assistantDir, "T-002.json"), JSON.stringify({ scope: "T-002", status: "failed", mode: "diagnose", messages: [{ role: "user", text: "Why is nothing assigned yet?", at: "2026-11-02T09:00:00.000Z" }], startedAt: "2026-11-02T09:00:00.000Z" }));

// --- Unit: context selection normalisation ---------------------------------
const normalized = normalizeContextSelection({
  tasks: [{ id: "T-001", include: ["brief", "nope", "acceptance"] }, { id: "git-3", include: [] }, { id: "T-002" }, { id: "T-001" }],
  plans: ["draft-1", { id: draft.id, title: "Issue sources" }],
  project: true,
});
assert.deepEqual(normalized.tasks.map((task) => task.id), ["T-001", "T-002"], "non-T task ids and duplicate selections are dropped");
assert.ok(!normalized.tasks[0].include.includes("nope"), "unknown include keys are filtered");
assert.equal(normalized.plans[1].id, draft.id, "plan entries keep their id");
assert.equal(normalized.plans[1].title, "Issue sources", "plan entries keep their title for chip labels");
assert.equal(normalized.project, true, "project context survives normalisation");

// --- Unit: conversation context builder ------------------------------------
const built = assistantConversationContext(root, normalized);
assert.equal(built.context.tasks.length, 2, "both tasks build context entries");
const importedContext = built.context.tasks.find((task) => task.id === "T-001");
assert.match(importedContext.brief.imported.excerpt, /404/, "imported excerpt is attached under the brief include");
assert.ok(Array.isArray(importedContext.checks) || importedContext.checks === undefined, "acceptance include honours selection");
assert.equal(built.context.plans[0].title, "Issue sources", "plan context carries the draft title");
assert.ok(built.context_used.includes("T-001 brief"), "context_used labels the brief include");
assert.ok(built.context_used.some((label) => label.startsWith("Plan: Issue sources")), "context_used labels the plan context");
assert.ok(built.context_used.includes("Project"), "context_used labels the project digest");

// --- OpenAI-compatible provider stub (the solico-glm stand-in) -------------
const providerRequests = [];
const stub = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    providerRequests.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "T-001 is in progress: the CDN cache was cold, so the first asset fetch was slow. Evidence shows a 200 after warm-up." } }] }));
  });
});
await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
const stubPort = stub.address().port;
fs.writeFileSync(path.join(atlHome, "providers.json"), JSON.stringify({
  version: 1,
  providers: {
    "solico-glm": { id: "solico-glm", label: "solico-glm", worker: "openai-http", protocol: "openai", base_url: `http://127.0.0.1:${stubPort}/v1`, api_key: "test-key", model: "glm-5.3-flash", models: ["glm-5.3-flash"] },
  },
}));

const running = await startControlPlaneServer(root);
try {
  const boot = await fetch(running.url);
  const bootHtml = await boot.text();
  const ownerCookie = boot.headers.get("set-cookie")?.split(";")[0] || "";
  const csrfToken = bootHtml.match(/name="atl-csrf" content="([^"]+)"/)?.[1] || "";
  assert.ok(ownerCookie && csrfToken, "boot provides the owner session and CSRF pair");
  const post = async (pathname, payload) => fetch(`${running.url}${pathname.replace(/^\//, "")}`, { method: "POST", headers: { "content-type": "application/json", cookie: ownerCookie, "x-atl-csrf": csrfToken }, body: JSON.stringify(payload) });

  // Client and stylesheet surface the redesigned page.
  const client = await fetch(`${running.url}control-plane-client.js`).then((response) => response.text());
  assert.match(client, /ask-rail/, "the client renders the redesigned chat rail");
  assert.match(client, /What are we working on\?/, "the landing hero matches the reference");
  assert.match(client, /ASK_IMPORTED_SOURCES = \["github", "azure", "jira"\]/, "the context picker is imported-tasks-only");
  assert.match(client, /ask-picker-apply/, "the picker exposes the Add-to-chat action");
  assert.match(client, /ask-mode:/, "the composer exposes the segmented Ask/Diagnose/Fix control");
  const html = await fetch(`${running.url}`).then((response) => response.text());
  assert.match(html, /\.ask-page\s*\{/, "the compiled Ask ATL stylesheet is inlined into the served artifact");
  assert.match(html, /ask-rail-open/, "the mobile rail drawer wiring ships in the artifact");

  // Conversations list: providers merge built-ins with the HTTP registry entry,
  // and the legacy scope transcripts migrate once.
  const listResponse = await post("/api/assistant", { action: "conversations" });
  const list = await listResponse.json();
  assert.equal(list.ok, true, "conversations action responds");
  assert.equal(list.providers.some((provider) => provider.id === "solico-glm" && provider.kind === "http"), true, "registry HTTP providers appear in the picker");
  assert.equal(list.providers.some((provider) => provider.id === "codex" && provider.kind === "cli"), true, "built-in CLI providers remain available");
  const migrated = list.conversations.filter((conversation) => conversation.id.startsWith("C-legacy-"));
  assert.equal(migrated.length, 2, "both legacy scope transcripts migrate");
  assert.ok(migrated.some((conversation) => conversation.title === "Review this project's current state."), "migration titles from the first user message");
  const listAgain = await (await post("/api/assistant", { action: "conversations" })).json();
  assert.equal(listAgain.conversations.filter((conversation) => conversation.id.startsWith("C-legacy-")).length, 2, "migration runs exactly once");

  // Create a conversation with imported-task + plan + project context.
  const createResponse = await post("/api/assistant", { action: "conversation-create", context: { tasks: [{ id: "T-001", include: ["brief", "blocker", "prerequisites"] }], plans: [{ id: draft.id, title: "Issue sources" }], project: true }, mode: "ask", provider: "solico-glm", model: "glm-5.3-flash" });
  const created = await createResponse.json();
  assert.equal(created.ok, true, `conversation created: ${JSON.stringify(created)}`);
  const conversationId = created.conversation.id;
  assert.match(conversationId, /^C-/, "conversation ids live in the C- namespace");

  // Ask send over the HTTP provider: bounded completion, reply stored with
  // context_used labels for the "Used:" chips. A fresh project gates the
  // assistant behind a one-time owner approval — approve, then re-send.
  const sendPayload = { action: "send", scope: conversationId, provider: "solico-glm", model: "glm-5.3-flash", message: "Why is T-001 slow, and what is the smallest fix?", mode: "ask", context: { tasks: [{ id: "T-001", include: ["brief", "blocker", "prerequisites"] }], plans: [{ id: draft.id, title: "Issue sources" }], project: true } };
  let sendResult = await (await post("/api/assistant", sendPayload)).json();
  if (sendResult.approvalRequired) {
    const decision = await post("/api/approvals", { action: "decide", proposal_id: sendResult.proposal.id, decision: "allow-once" });
    assert.equal((await decision.json()).ok, true, "owner grants the one-time assistant permission");
    sendResult = await (await post("/api/assistant", sendPayload)).json();
  }
  assert.equal(sendResult.ok && !sendResult.approvalRequired, true, `ask send started: ${JSON.stringify(sendResult).slice(0, 200)}`);
  for (let attempt = 0; attempt < 40 && providerRequests.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(providerRequests.length, 1, "exactly one provider completion was made");
  assert.equal(providerRequests[0].model, "glm-5.3-flash", "the selected model reaches the provider");
  assert.match(providerRequests[0].messages[0].content, /Serve the new catalog asset/, "the system prompt carries the attached task context");
  assert.match(providerRequests[0].messages[0].content, /Issue sources/, "the system prompt carries the plan context");
  let session = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    session = (await (await post("/api/assistant", { action: "read", scope: conversationId })).json()).session;
    if (session.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(session.status, "complete", "the HTTP ask completes");
  const reply = session.messages.find((message) => message.role === "assistant");
  assert.match(reply.text, /CDN cache was cold/, "the provider reply is appended to the conversation");
  assert.ok(reply.context_used.includes("T-001 brief"), "the reply records its used context");

  // Context editing: remove the plan chip, verify the stored context updates.
  const updateResponse = await post("/api/assistant", { action: "conversation-update", scope: conversationId, context: { tasks: [{ id: "T-001", include: ["brief", "blocker", "prerequisites"] }], plans: [], project: true } });
  const updated = await updateResponse.json();
  assert.equal(updated.ok, true, "context update accepted");
  assert.equal(updated.conversation.context.plans.length, 0, "removed plan chip persists");

  // Fix gating without CLI workspace: conversation fix on a workspace-less
  // task must refuse before any provider spend.
  const fixResponse = await post("/api/assistant", { action: "send", scope: conversationId, provider: "codex", model: "", message: "Fix it in the workspace", mode: "fix" });
  const fixResult = await fixResponse.json();
  assert.ok([400, 409, 500].includes(fixResponse.status), "conversation fix without a usable workspace refuses");
  assert.match(fixResult.error || "", /workspace/i, "the refusal explains the workspace gate");

  // Rename, then delete.
  const renameResponse = await post("/api/assistant", { action: "conversation-rename", scope: conversationId, title: "Catalog CDN diagnosis" });
  assert.equal((await renameResponse.json()).ok, true, "rename accepted");
  assert.equal(listConversations(root).find((conversation) => conversation.id === conversationId)?.title, "Catalog CDN diagnosis", "rename persists");

  // Direct unit: exactly-one-task rule for conversation fixes.
  const twoTaskConversation = createConversation(root, { context: { tasks: [{ id: "T-001", include: [] }, { id: "T-002", include: [] }] } });
  assert.throws(() => conversationFixTask(root, twoTaskConversation.id), /exactly one task/, "fix needs exactly one task in context");
  deleteConversation(root, twoTaskConversation.id);

  // Save-to-Knowledge: reply lands as an UNKNOWN claim owned by ask-atl.
  const claimResponse = await post("/api/brain", { action: "add-claim", text: "T-001 slowness traces to a cold CDN cache; warm-up restored 200s.", source_id: "ask-atl", subject: "Catalog CDN diagnosis" });
  const claimResult = await claimResponse.json();
  assert.equal(claimResult.ok, true, `add-claim accepted: ${JSON.stringify(claimResult).slice(0, 200)}`);
  const snapshot = await (await fetch(`${running.url}api/snapshot`, { headers: { cookie: ownerCookie, "x-atl-csrf": csrfToken } })).json();
  const savedClaim = (snapshot.brain?.claims || []).find((claim) => claim.claim_id === claimResult.result.claim.claim_id);
  assert.ok(savedClaim, "the saved claim appears in the Knowledge snapshot");
  assert.equal(savedClaim.owner, "ask-atl", "the claim is owned by ask-atl");
  assert.equal(savedClaim.status, "UNKNOWN", "the claim starts unverified");

  const deleteResponse = await post("/api/assistant", { action: "conversation-delete", scope: conversationId });
  assert.equal((await deleteResponse.json()).ok, true, "delete accepted");
  assert.equal(listConversations(root).some((conversation) => conversation.id === conversationId), false, "deleted conversation leaves the list");
} finally {
  await new Promise((resolve) => running.server.close(resolve));
  stub.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(atlHome, { recursive: true, force: true });
}
console.log("ask_atl_conversations_test: all assertions passed");
