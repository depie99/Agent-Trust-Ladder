import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildMyTasksWiql, fetchProjectMyWorkItems, mergeProjectRecords, myTasksConnectionKey,
  normalizeMyWorkItem, normalizeStateCategory, readMyTasksSettings, runMyTasksCheck, sanitizeWorkItemHtml,
  saveMyTasksSettings, stripWorkItemHtml, workItemKey, emptyMyTasksStore, writeMyTasksStore, readMyTasksStore,
} from "../runtime/lib/my-tasks.mjs";

// Spec 021: fetch/classification/sanitize/merge contract on a mock transport.
// No network, no real PAT, no Azure write anywhere in this suite.

const cfg = { org_url: "https://devops.example.invalid:32678/Collection", project: "Main", tls_allow_untrusted: true };
const ME = { id: "aaaaaaaa-1111-2222-3333-444444444444", displayName: "Owner Account" };
const OPEN_FIELDS = (id, over = {}) => ({
  id,
  fields: {
    "System.Id": id, "System.Rev": 3, "System.Title": `Item ${id}`, "System.State": "New",
    "System.WorkItemType": "Task", "System.AssignedTo": { id: ME.id, displayName: ME.displayName },
    "Microsoft.VSTS.Common.Priority": 2, "System.IterationPath": "Main\\Sprint 74",
    "System.AreaPath": "Main\\Area A", "System.Description": "<p>Plain <b>text</b> توضیح</p><script>alert(1)</script>",
    "Microsoft.VSTS.Common.AcceptanceCriteria": "<ul><li>first</li><li>second</li></ul>",
    "System.Tags": "a; b ;; c", "System.ChangedDate": "2026-11-11T10:00:00Z",
    ...over,
  },
});

function mockTransport({ total = 130, batchLog = [], statesFor, relationsFor, rejectExpandWithFields = false, failRelations = false } = {}) {
  return async (url, options = {}) => {
    const rawBody = options.body;
    const body = rawBody == null ? null : typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    if (url.endsWith("/_apis/ConnectionData")) return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
    if (url.includes("/_apis/wit/wiql")) {
      batchLog.push({ kind: "wiql", url, query: body.query });
      return { data: { workItems: Array.from({ length: total }, (_, index) => ({ id: 5000 + index })) }, headers: {}, status: 200 };
    }
    if (url.includes("/_apis/wit/workitemsbatch")) {
      const expand = Boolean(body.$expand);
      batchLog.push({ kind: "batch", size: body.ids.length, expand, withFields: Array.isArray(body.fields) });
      // Spec 022 baseline: the owner's Azure Server rejects fields+$expand with
      // HTTP 400. The mock enforces the same contract when asked.
      if (rejectExpandWithFields && expand && Array.isArray(body.fields)) {
        const error = new Error("HTTP 400 from devops.example.invalid: The expand parameter can not be used with the fields parameter.");
        error.status = 400;
        throw error;
      }
      if (expand) {
        if (failRelations) { const error = new Error("HTTP 400 relations phase refused"); error.status = 400; throw error; }
        return { data: { value: body.ids.map((id) => ({ id, relations: relationsFor ? relationsFor(id) : [{ rel: "System.LinkTypes.Dependency-Forward", url: `https://devops.example.invalid/Collection/Main/_apis/wit/workItems/${id + 9000}` }] })) }, headers: {}, status: 200 };
      }
      return { data: { value: body.ids.map((id) => OPEN_FIELDS(id)) }, headers: {}, status: 200 };
    }
    if (url.includes("/states")) {
      const type = decodeURIComponent(url.split("/workitemtypes/")[1].split("/states")[0]);
      return { data: { value: (statesFor || (() => [{ name: "New", category: "Proposed" }, { name: "Done", category: "Complete" }, { name: "Removed", category: "Removed" }, { name: "Doing", category: "InProgress" }]))(type) }, headers: {}, status: 200 };
    }
    throw new Error(`unexpected transport call: ${url}`);
  };
}

// 1. WIQL is per-project, @Me-scoped, and quote-safe.
assert.match(buildMyTasksWiql("Team's Portal"), /Team''s Portal/);
assert.match(buildMyTasksWiql("Main"), /\[System\.AssignedTo\] = @Me/);
assert.ok(!buildMyTasksWiql("Main").includes("IterationPath"), "fetch is sprint-independent");

// 2. No 100-item silent drop: 130 ids → 200-cap chunks (1 batch here), all items fetched.
{
  const log = [];
  const result = await fetchProjectMyWorkItems(cfg, "Main", { token: "t", requestImpl: mockTransport({ total: 130, batchLog: log }) });
  assert.equal(log.filter((call) => call.kind === "wiql").length, 1);
  assert.equal(log.filter((call) => call.kind === "batch" && !call.expand).length, 1, "130 ids fit one 200-cap fields batch");
  assert.equal(result.records.length, 130, "all 130 items fetched — no 100-item slice");
  assert.equal(result.records[0].key, workItemKey(myTasksConnectionKey(cfg), "Main", 5000), "key = connection|project|id");
}

// 3. Chunking across the 200-id batch ceiling.
{
  const log = [];
  await fetchProjectMyWorkItems(cfg, "Main", { token: "t", requestImpl: mockTransport({ total: 450, batchLog: log }) });
  const sizes = log.filter((call) => call.kind === "batch" && !call.expand).map((call) => call.size);
  assert.deepEqual(sizes, [200, 200, 50], "batches chunk at 200 with a remainder");
}

// 4. Closed/removed classification uses the project's state categories —
//    a state literally named "Done" that maps to Proposed stays OPEN.
{
  const states = [{ name: "New", category: "Proposed" }, { name: "Done", category: "Proposed" }, { name: "Closed", category: "Complete" }, { name: "Cut", category: "Removed" }, { name: "Doing", category: "InProgress" }];
  const names = ["New", "Done", "Closed", "Cut"];
  const transport = async (url, options = {}) => {
    if (url.includes("workitemsbatch")) {
      const ids = typeof options.body === "string" ? JSON.parse(options.body).ids : options.body.ids;
      return { data: { value: ids.map((id, index) => OPEN_FIELDS(id, { "System.State": names[index % names.length] })) }, headers: {}, status: 200 };
    }
    if (url.includes("wiql")) return { data: { workItems: names.map((_, index) => ({ id: 7000 + index })) }, headers: {}, status: 200 };
    if (url.includes("states")) return { data: { value: states }, headers: {}, status: 200 };
    return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
  };
  const result = await fetchProjectMyWorkItems(cfg, "Main", { token: "t", requestImpl: transport });
  assert.equal(result.records.length, 3, "Proposed and Complete items remain visible; Removed items are excluded");
  assert.equal(result.records.filter((record) => record.state_category === "proposed").length, 2);
  assert.equal(result.records.filter((record) => record.state_category === "complete").length, 1);
  assert.equal(result.excluded, 1, "only Removed is excluded by category");
}

// 5. Assignment compares by Azure identity id, not display name.
{
  const transport = async (url, options = {}) => {
    if (url.includes("workitemsbatch")) return { data: { value: [OPEN_FIELDS(1, { "System.AssignedTo": { id: "other-id", displayName: ME.displayName } })] }, headers: {}, status: 200 };
    if (url.includes("wiql")) return { data: { workItems: [{ id: 1 }] }, headers: {}, status: 200 };
    if (url.includes("states")) return { data: { value: [{ name: "New", category: "Proposed" }] }, headers: {}, status: 200 };
    return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
  };
  const result = await fetchProjectMyWorkItems(cfg, "Main", { token: "t", requestImpl: transport, identity: ME });
  assert.equal(result.records.length, 0, "same display name, different identity id → excluded");
  assert.equal(result.excluded, 1);
}

// 6. Optional missing fields never fail the item; sanitizer strips scripts.
{
  const record = normalizeMyWorkItem({ id: 9, fields: { "System.Title": "  ", "System.WorkItemType": "Bug" } }, { connection: "c", project: "p", stateCategory: "proposed" });
  assert.equal(record.title, "Work item 9");
  assert.equal(record.state, "");
  assert.equal(record.priority, null);
  assert.equal(record.area_path, null);
  assert.equal(record.description_html, "");
  assert.equal(record.description_text, "");
  assert.deepEqual(record.tags, []);
  const sanitized = sanitizeWorkItemHtml('<p onclick="x()">سلام <script>alert(1)</script><style>*{}</style><img src=x onerror=y><a href="javascript:evil()">x</a><a href="https://ok.invalid">ok</a></p>');
  assert.ok(!/alert|onerror|javascript:|<img/i.test(sanitized), `dangerous content stripped: ${sanitized}`);
  assert.ok(sanitized.includes("سلام") && sanitized.includes('href="https://ok.invalid"'));
  assert.match(stripWorkItemHtml("<ul><li>one</li><li>two</li></ul>"), /one[\s\S]*two/);
}

// 7. Merge: revision upsert keeps one record; removal only for fully-fetched project.
{
  const store = emptyMyTasksStore();
  const iso = (offset) => new Date(Date.parse("2026-11-11T10:00:00Z") + offset).toISOString();
  const rec = (id, rev, title = "t") => ({ key: workItemKey("c", "P", id), connection: "c", project: "P", id, rev, title, state: "New", state_category: "proposed", priority: 1, area_path: "A", iteration_path: null, description_html: "", description_text: "", acceptance_criteria: "", assignee_id: ME.id, assignee_name: ME.displayName, tags: [], changed_at: iso(0), url: "" });
  const first = mergeProjectRecords(store, "P", [rec(1, 1), rec(2, 1)], { connection: "c", now: iso(0) });
  assert.deepEqual([first.added, first.updated, first.removed], [2, 0, 0]);
  const second = mergeProjectRecords(store, "P", [rec(1, 2, "renamed"), rec(3, 1)], { connection: "c", now: iso(60_000) });
  assert.deepEqual([second.added, second.updated, second.removed], [1, 1, 1], "rev/title change updates in place; missing-after-full-fetch is removed");
  const kept = store.records[workItemKey("c", "P", 1)];
  assert.equal(kept.rev, 2);
  assert.equal(kept.title, "renamed");
  assert.equal(kept.first_seen_at, iso(0), "first_seen survives updates (new-badge window)");
  // A project whose successful fetch returns zero items empties its active list…
  const emptied = mergeProjectRecords(store, "P", [], { connection: "c", now: iso(120_000) });
  assert.equal(emptied.removed, 2);
  // …but a DIFFERENT project's records are never touched.
  const other = mergeProjectRecords(store, "Q", [rec(9, 1)], { connection: "c", now: iso(0) });
  assert.deepEqual([other.added, other.removed], [1, 0]);
}

// 8. Run orchestration: per-project isolation + store persistence.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-run-"));
  saveMyTasksSettings(root, { enabled: true, projects: ["Alpha", "Beta"] });
  const calls = [];
  const transport = async (url, options = {}) => {
    calls.push(url);
    const project = decodeURIComponent(url.split("/Collection/")[1]?.split("/_apis")[0] || "");
    if (url.includes("workitemsbatch")) {
      if (project === "Beta") { const error = new Error("HTTP 500 boom"); error.status = 500; throw error; }
      return { data: { value: [OPEN_FIELDS(1)] }, headers: {}, status: 200 };
    }
    if (url.includes("wiql")) return { data: { workItems: [{ id: 1 }] }, headers: {}, status: 200 };
    if (url.includes("states")) return { data: { value: [{ name: "New", category: "Proposed" }] }, headers: {}, status: 200 };
    return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
  };
  const result = await runMyTasksCheck(root, { settings: readMyTasksSettings(root), token: "t", cfg, requestImpl: transport, now: new Date("2026-11-11T10:00:00Z"), reason: "schedule" });
  assert.equal(result.status, "partial");
  assert.equal(result.summary.Alpha.status, "fresh");
  assert.equal(result.summary.Beta.status, "error");
  const store = readMyTasksStore(root);
  assert.equal(store.projects.Alpha.status, "fresh");
  assert.equal(store.projects.Beta.status, "error", "never-successful project is error, not stale");
  assert.ok(store.records[workItemKey(myTasksConnectionKey(cfg), "Alpha", 1)], "Alpha record stored");
  assert.ok(!store.records[workItemKey(myTasksConnectionKey(cfg), "Beta", 1)], "failed project stores nothing new");
  // Second run: Beta still failing but now has a prior success → stale badge keeps data.
  store.projects.Beta.last_success_at = "2026-11-11T09:00:00Z";
  writeMyTasksStore(root, store);
  await runMyTasksCheck(root, { settings: readMyTasksSettings(root), token: "t", cfg, requestImpl: transport, now: new Date("2026-11-11T10:16:00Z"), reason: "schedule" });
  const after = readMyTasksStore(root);
  assert.equal(after.projects.Beta.status, "stale");
  assert.equal(after.runs.last.status, "partial");
  assert.equal(after.identity.display_name, ME.displayName);
}

// 9. Auth failure pauses the run record (401), forbidden is per-project (403).
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-auth-"));
  saveMyTasksSettings(root, { enabled: true, projects: ["Alpha"] });
  const failing = async (url) => { const error = new Error("no access"); error.status = 401; throw error; };
  await assert.rejects(() => runMyTasksCheck(root, { settings: readMyTasksSettings(root), token: "bad", cfg, requestImpl: failing, now: new Date(), reason: "manual" }), /no access/);
  const store = readMyTasksStore(root);
  assert.equal(store.runs.paused.reason, "auth");
  const root403 = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-403-"));
  saveMyTasksSettings(root403, { enabled: true, projects: ["Alpha"] });
  const store403 = emptyMyTasksStore();
  const forbidden = async (url, options = {}) => {
    if (url.includes("wiql")) { const error = new Error("denied"); error.status = 403; throw error; }
    return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
  };
  const result = await runMyTasksCheck(root403, { settings: readMyTasksSettings(root403), token: "t", cfg, requestImpl: forbidden, now: new Date(), reason: "manual" });
  assert.equal(result.summary.Alpha.error, "ATL_MYTASKS_FORBIDDEN");
  assert.equal(readMyTasksStore(root403).runs.paused, null, "403 never pauses the whole scheduler");
  assert.equal(result.summary.Alpha.status, "error");
  assert.ok(store403);
}

// 10. Spec 022 baseline repair: fields and $expand are never combined on
//     workitemsbatch (Azure Server 400s that combo); relations arrive in a
//     second pass and land in dependencies.
{
  const log = [];
  const transport = mockTransport({
    total: 3, batchLog: log, rejectExpandWithFields: true,
    relationsFor: (id) => [{ rel: "System.LinkTypes.Dependency-Forward", url: `https://devops.example.invalid/Collection/Main/_apis/wit/workItems/${id + 100}` }],
  });
  const result = await fetchProjectMyWorkItems(cfg, "Main", { token: "t", requestImpl: transport });
  assert.ok(log.every((call) => call.kind !== "batch" || !(call.expand && call.withFields)), "no workitemsbatch call combines fields with $expand");
  assert.equal(result.relations.ok, true);
  assert.equal(result.records[0].dependencies.length, 1, "dependency link attached by the relations pass");
  assert.equal(result.records[0].dependencies[0].id, "5100");
}

// 11. A failing relations pass degrades instead of failing the project read;
//     the run summary surfaces the warning.
{
  const transport = mockTransport({ total: 2, failRelations: true });
  const result = await fetchProjectMyWorkItems(cfg, "Main", { token: "t", requestImpl: transport });
  assert.equal(result.records.length, 2, "fields fetch is unaffected by the relations failure");
  assert.equal(result.relations.ok, false);
  assert.deepEqual(result.records[0].dependencies, [], "dependencies degrade to empty");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-mytasks-rel-"));
  saveMyTasksSettings(root, { enabled: true, projects: ["Alpha"] });
  const runTransport = async (url, options = {}) => {
    const body = options.body == null ? null : typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    if (url.includes("workitemsbatch")) {
      if (body?.$expand) { const error = new Error("HTTP 400 from devops.example.invalid: The expand parameter can not be used with the fields parameter."); error.status = 400; throw error; }
      return { data: { value: body.ids.map((id) => OPEN_FIELDS(id)) }, headers: {}, status: 200 };
    }
    if (url.includes("wiql")) return { data: { workItems: [{ id: 1 }] }, headers: {}, status: 200 };
    if (url.includes("states")) return { data: { value: [{ name: "New", category: "Proposed" }] }, headers: {}, status: 200 };
    return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
  };
  const run = await runMyTasksCheck(root, { settings: readMyTasksSettings(root), token: "t", cfg, requestImpl: runTransport, now: new Date("2026-11-14T10:00:00Z"), reason: "manual" });
  assert.equal(run.status, "complete");
  assert.ok(run.summary.Alpha.relations_warning, "relations warning surfaced in the run summary");
  assert.equal(run.summary.Alpha.status, "fresh", "project read still succeeds");
}

// 12. Spec 022 baseline repair: category aliases absorb server spelling drift
//     ("Completed"), a missing category falls back to terminal names only, and
//     stale cached mappings are re-derived instead of trusted.
{
  assert.equal(normalizeStateCategory("Completed", "Done"), "complete");
  assert.equal(normalizeStateCategory("Completed", "Task"), "complete");
  assert.equal(normalizeStateCategory("Proposed", "Done"), "proposed", "the API category wins over the name");
  assert.equal(normalizeStateCategory("", "Doing"), "inprogress");
  assert.equal(normalizeStateCategory("", "Done"), "complete");
  assert.equal(normalizeStateCategory(null, "Closed"), "complete");
  assert.equal(normalizeStateCategory("InProgress", "X"), "inprogress");
  assert.equal(normalizeStateCategory("Removed", "X"), "removed");
  const states = [{ name: "New", category: "Proposed" }, { name: "Done", category: "Completed" }, { name: "Doing", category: "" }];
  const names = ["New", "Done", "Doing"];
  const transport = async (url, options = {}) => {
    if (url.includes("workitemsbatch")) {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      if (body.$expand) return { data: { value: body.ids.map((id) => ({ id })) }, headers: {}, status: 200 };
      return { data: { value: body.ids.map((id, index) => OPEN_FIELDS(id, { "System.State": names[index % names.length] })) }, headers: {}, status: 200 };
    }
    if (url.includes("wiql")) return { data: { workItems: names.map((_, index) => ({ id: 8000 + index })) }, headers: {}, status: 200 };
    if (url.includes("states")) return { data: { value: states }, headers: {}, status: 200 };
    return { data: { authenticatedUser: ME }, headers: {}, status: 200 };
  };
  const staleCache = { Task: { New: "proposed", Done: "inprogress", Doing: "inprogress" } };
  const result = await fetchProjectMyWorkItems(cfg, "Main", { token: "t", requestImpl: transport, statesCache: staleCache });
  const byState = Object.fromEntries(result.records.map((record) => [record.state, record.state_category]));
  assert.equal(byState.Done, "complete", "alias 'Completed' + stale cached inprogress are re-derived to complete");
  assert.equal(byState.Doing, "inprogress", "non-terminal names without a category stay open");
}

console.log("PASS: My Tasks fetch — 130+ items without the 100 cap, 200-chunk batching, category-based close detection, identity-id matching, sanitized HTML, revision upsert + full-fetch removal, per-project isolation, auth/forbidden split, fields/relations two-phase fetch, category alias re-derivation");
