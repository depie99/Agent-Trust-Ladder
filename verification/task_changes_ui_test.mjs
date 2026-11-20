// Controller contract test in a small DOM double. This exercises async state,
// requests and rendered markup; it does not claim browser layout verification.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const listeners = {}, dialogListeners = {}, requests = [];
const mount = { isConnected: true, innerHTML: "", addEventListener: (name, fn) => { listeners[name] = fn; }, querySelectorAll: () => [], querySelector: () => null, contains: () => false, closest: () => dialog };
const dialog = { classList: { add() {} }, setAttribute() {}, addEventListener: (name, fn) => { dialogListeners[name] = fn; }, querySelectorAll: () => [] };
const data = { id: "capture-one", task_id: "T-001", status: "blocked", captured_at: "2026-10-27T07:10:00Z", baseline_revision: "base", output_revision: "output", source_kind: "inspection", packet_revision: 1, input_revisions: {}, total_files: 2, next_cursor: 1, repository: "S2HStoreFrontend2", workspace: "D:\\ws\\storefront", additions: 3, deletions: 1, stats_complete: false, files: [{ id: "file-one", path: "runtime/example.js", kind: "modified", additions: 3, deletions: 1 }], revisions: [{ id: "capture-one", captured_at: "2026-10-27", output_revision: "output" }], evidence: [{ id: "evidence-one", freshness: "stale", kind: "review", result: "approve", actor: "sage", note: "<script>attack</script>" }], attention: [{ code: "blocked", reason: "Needs review" }] };
let hold = null;
let reviewState = { revision: 0, comments: [], reviewed_files: [] };
const context = vm.createContext({ window: {}, URLSearchParams, setTimeout, document: { documentElement: { lang: "en-US" }, activeElement: null, querySelector: (selector) => selector === "#taskChangeReview" ? mount : { content: "test-csrf" }, getElementById: () => null }, fetch: async (url, init) => {
  requests.push({ url, init });
  if (hold) await hold;
  if (url.includes("task-review-state")) {
    if (init?.method === "PUT") { const payload = JSON.parse(init.body); reviewState = { ...reviewState, revision: reviewState.revision + 1 }; if (payload.action === "comment") reviewState.comments.push({ id: "note-one", change_set_id: payload.change_set_id, file_id: payload.file_id, side: payload.side, line: payload.line, text: payload.text, resolved: false }); if (payload.action === "reviewed") reviewState.reviewed_files.push({ key: `${payload.change_set_id}:${payload.file_id}` }); if (payload.action === "resolve") reviewState.comments[0].resolved = true; return { ok: true, json: async () => structuredClone(reviewState) }; }
    return { ok: true, json: async () => structuredClone(reviewState) };
  }
  if (url.includes("task-change-diff")) return { ok: true, json: async () => ({ availability: "available", patch: "--- a/example\n+++ b/example\n@@ -1,1 +1,1 @@\n-previous\n+<img src=x onerror=attack()>" }) };
  const result = structuredClone(data);
  if (url.includes("cursor=")) { result.files = [{ id: "file-two", path: "docs/فارسی.txt", kind: "added" }]; result.next_cursor = null; }
  return { ok: true, json: async () => result };
} });
vm.runInContext(fs.readFileSync(new URL("../runtime/control-plane-changes.js", import.meta.url), "utf8"), context);
const host = { popupWide() {}, btn: () => "" };
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const click = async (action) => { listeners.click({ target: { closest: () => ({ dataset: { reviewAction: action } }) } }); await flush(); };
await context.window.ATL_CHANGE_REVIEW.open({ id: "T-001" }, host);
await click("tab:overview");
assert.match(mount.innerHTML, /Needs review/); assert.match(mount.innerHTML, /blocked/);
// Change profile chart: per-file bars, totals and repository context replace the status statechart.
assert.match(mount.innerHTML, /Change profile/);
assert.match(mount.innerHTML, /S2HStoreFrontend2/);
assert.match(mount.innerHTML, /D:\\ws\\storefront/);
assert.match(mount.innerHTML, /review-chart-row/);
assert.match(mount.innerHTML, /\+3 \/ −1/);
assert.match(mount.innerHTML, /counts for loaded files/);
assert.doesNotMatch(mount.innerHTML, /Statechart/, "the status statechart is gone from the change review");
assert.equal(requests.length, 2); assert.equal(requests[0].init.headers["x-atl-csrf"], "test-csrf");
await click("tab:files"); assert.match(mount.innerHTML, /runtime\//); assert.equal(requests.length, 2, "opening files does not eagerly load patches");
await click("file:file-one");
assert.match(requests.at(-1).url, /changeSetId=capture-one&fileId=file-one/);
assert.match(mount.innerHTML, /&lt;img src=x onerror=attack\(\)&gt;/); assert.doesNotMatch(mount.innerHTML, /<img src=x/);
await click("comment-file"); listeners.input({ target: { id: "reviewDraft", value: "Local reviewer note" } }); await click("comment-save");
assert.match(mount.innerHTML, /Local reviewer note/); await click("file-reviewed"); assert.match(mount.innerHTML, /Reviewed/);
await click("split-toggle"); assert.match(mount.innerHTML, /diff-split/); assert.match(mount.innerHTML, /after|&lt;img/);
await click("comment-at:new:1"); assert.match(mount.innerHTML, /Comment on new line 1/);
listeners.input({ target: { id: "reviewDraft", value: "Line-specific note" } }); await click("comment-save");
assert.match(mount.innerHTML, /Line-specific note/); assert.match(mount.innerHTML, /new line 1/);
await click("more"); assert.match(mount.innerHTML, /فارسی/); assert.match(mount.innerHTML, /2 \/ 2/);
await click("refresh"); assert.match(mount.innerHTML, /2 \/ 2/, "refresh keeps the loaded file page and selection");
assert.match(mount.innerHTML, /&lt;img/);
await click("tab:evidence"); assert.match(mount.innerHTML, /stale/); assert.match(mount.innerHTML, /Result: approve/); assert.doesNotMatch(mount.innerHTML, /<script>attack/);
data.evidence.push({ id: "note-one", kind: "note", actor: "pip", freshness: "unknown", detail: "A note" });
await click("refresh"); assert.match(mount.innerHTML, /Revision link missing/); assert.match(mount.innerHTML, /code revision, packet revision/); assert.doesNotMatch(mount.innerHTML, /note · pip · unknown/);
await click("tab:relationships"); assert.match(mount.innerHTML, /Recorded relationships/); assert.match(mount.innerHTML, /capture-one/); assert.match(mount.innerHTML, /Run link/);
assert.match(mount.innerHTML, /Starting point before changes/); assert.match(mount.innerHTML, /Result after changes/);
await click("node:Baseline:base"); assert.match(mount.innerHTML, /aria-pressed="true"/); assert.match(mount.innerHTML, /Recorded data/); assert.match(mount.innerHTML, /&quot;revision&quot;: &quot;base&quot;/);
let release;
hold = new Promise((resolve) => { release = resolve; });
listeners.click({ target: { closest: () => ({ dataset: { reviewAction: "refresh" } }) } });
mount.isConnected = false; const abandoned = mount.innerHTML;
release(); await flush(); assert.equal(mount.innerHTML, abandoned, "a late request cannot overwrite a closed dialog");

const unavailableData = { availability: "capture_required", message: "Capture the task workspace to inspect its current changes.", repository: "S2HStoreFrontend2", workspace: "D:\\ws\\storefront", files: [], total_files: null };
const unavailableMount = { ...mount, isConnected: true, innerHTML: "", addEventListener: (name, fn) => { listeners[name] = fn; } };
context.document.querySelector = (selector) => selector === "#taskChangeReview" ? unavailableMount : { content: "test-csrf" };
context.fetch = async () => ({ ok: true, json: async () => structuredClone(unavailableData) });
await context.window.ATL_CHANGE_REVIEW.open({ id: "T-024" }, host);
assert.match(unavailableMount.innerHTML, /Capture the task workspace/);
assert.match(unavailableMount.innerHTML, /S2HStoreFrontend2/, "the empty state names the repository");
assert.doesNotMatch(unavailableMount.innerHTML, /Loading changes/);
await click("refresh");
assert.match(unavailableMount.innerHTML, /Capture the task workspace/, "uncaptured review remains usable after refresh");
console.log("PASS: review UI controller — lazy/pinned requests, pagination, selection, escaping and stale evidence (layout unverified)");
