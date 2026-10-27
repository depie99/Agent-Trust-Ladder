// Controller contract test in a small DOM double. This exercises async state,
// requests and rendered markup; it does not claim browser layout verification.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const listeners = {}, dialogListeners = {}, requests = [];
const mount = { isConnected: true, innerHTML: "", addEventListener: (name, fn) => { listeners[name] = fn; }, querySelectorAll: () => [], querySelector: () => null, contains: () => false, closest: () => dialog };
const dialog = { classList: { add() {} }, setAttribute() {}, addEventListener: (name, fn) => { dialogListeners[name] = fn; }, querySelectorAll: () => [] };
const data = { id: "capture-one", task_id: "T-001", status: "blocked", captured_at: "2026-10-27T07:10:00Z", baseline_revision: "base", output_revision: "output", source_kind: "inspection", packet_revision: 1, input_revisions: {}, total_files: 2, next_cursor: 1, files: [{ id: "file-one", path: "runtime/example.js", kind: "modified" }], revisions: [{ id: "capture-one", captured_at: "2026-10-27", output_revision: "output" }], evidence: [{ id: "evidence-one", freshness: "stale", kind: "review", result: "approve", actor: "sage", note: "<script>attack</script>" }], attention: [{ code: "blocked", reason: "Needs review" }] };
let hold = null;
const context = vm.createContext({ window: {}, URLSearchParams, setTimeout, document: { documentElement: { lang: "en-US" }, activeElement: null, querySelector: (selector) => selector === "#taskChangeReview" ? mount : { content: "test-csrf" }, getElementById: () => null }, fetch: async (url, init) => {
  requests.push({ url, init });
  if (hold) await hold;
  if (url.includes("task-change-diff")) return { ok: true, json: async () => ({ availability: "available", patch: "--- a/example\n+++ b/example\n-previous\n+<img src=x onerror=attack()>" }) };
  const result = structuredClone(data);
  if (url.includes("cursor=")) { result.files = [{ id: "file-two", path: "docs/فارسی.txt", kind: "added" }]; result.next_cursor = null; }
  return { ok: true, json: async () => result };
} });
vm.runInContext(fs.readFileSync(new URL("../runtime/control-plane-changes.js", import.meta.url), "utf8"), context);
const host = { popupWide() {}, btn: () => "" };
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const click = async (action) => { listeners.click({ target: { closest: () => ({ dataset: { reviewAction: action } }) } }); await flush(); };
await context.window.ATL_CHANGE_REVIEW.open({ id: "T-001" }, host);
assert.match(mount.innerHTML, /Needs review/); assert.match(mount.innerHTML, /blocked/);
assert.equal(requests.length, 1); assert.equal(requests[0].init.headers["x-atl-csrf"], "test-csrf");
await click("tab:files"); assert.match(mount.innerHTML, /runtime\//); assert.equal(requests.length, 1, "opening files does not eagerly load patches");
await click("file:file-one");
assert.match(requests.at(-1).url, /changeSetId=capture-one&fileId=file-one/);
assert.match(mount.innerHTML, /&lt;img src=x onerror=attack\(\)&gt;/); assert.doesNotMatch(mount.innerHTML, /<img src=x/);
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
console.log("PASS: review UI controller — lazy/pinned requests, pagination, selection, escaping and stale evidence (layout unverified)");
