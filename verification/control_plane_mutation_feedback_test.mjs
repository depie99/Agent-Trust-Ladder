import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../runtime/control-plane-client.js", import.meta.url), "utf8");
const start = source.indexOf("  async function mutation(");
const end = source.indexOf("\n  async function assistantRead(", start);
assert.ok(start >= 0 && end > start);
const events = [];
const scope = vm.createContext({
  page: "tasks", close: () => events.push("close"),
  apiCommand: async (command) => { events.push(command); },
  refresh: async () => events.push("refresh"), render: () => events.push("render"),
  popup: (title, body) => events.push({ title, body }),
  escapeHtml: (value) => value, btn: () => "",
});
vm.runInContext(source.slice(start, end), scope);
await scope.mutation("unblock T-001", "tasks");
assert.deepEqual(events, ["close", "unblock T-001", "refresh", "render"]);
events.length = 0;
scope.apiCommand = async () => { throw new Error("Run refused"); };
await scope.mutation("unblock T-001", "tasks");
assert.equal(events[1].title, "Action failed");
assert.match(events[1].body, /Run refused/);
assert.equal(events.length, 2, "failure stays visible and does not pretend to refresh a successful action");
console.log("PASS: UI actions avoid CLI dialogs and report failures");
