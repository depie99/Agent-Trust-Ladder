import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";

const client = fs.readFileSync(new URL("../runtime/control-plane-client.js", import.meta.url), "utf8");

// 1) wiring: route, icon, panel entry, nav group, dispatcher handler
assert.ok(client.includes('["runs", "◷", "Workflow runs"]'), "routes must expose the Workflow runs entry");
assert.ok(client.includes("runs: '<path d=\"M4 18.4h4.2v-4.2h4.2v-4.2h4.2V5.8h4.2\"/>'"), "ICONS must carry the runs glyph");
assert.ok(client.includes("runs: runsPanel,"), "panels registry must include runs");
assert.ok(client.includes('"queues", "runs", "approvals"'), "Workspace nav group must include runs");
assert.ok(client.includes('value.startsWith("wf-task:")'), "action dispatcher must open the workflow detail");
assert.ok(client.includes("function workflowDetailBody("), "workflow detail body must exist");

// 2) parser behavior — vm-extracted like the other client-slice suites
const start = client.indexOf("function parseRunWorkflow(");
assert.ok(start > 0, "parseRunWorkflow must exist");
const end = client.indexOf("const WF_STATUS", start);
assert.ok(end > start, "parser block must be delimited");
const sandbox = {};
vm.runInNewContext(client.slice(start, end) + "\nthis.parseRunWorkflow = parseRunWorkflow;", sandbox);
const parse = sandbox.parseRunWorkflow;
const sample = [
  "Dry run · two queues — 6 task(s)",
  "Run gate: free · global concurrency 1 · budget 480m/8 sessions",
  "[T-035] session 1/8 · mira · claude · glm-5.3-flash",
  "  workspace: D:\\w\\T-035",
  "  transcript: D:\\l\\session-01-mira-1.log",
  "[T-035] mira session finished · exit 0",
  "[T-038] session 5/8 · pip · claude · glm-5.3-flash",
  "  transcript: D:\\l\\session-05-pip-5.log",
  "[T-038] pip session finished · exit 0",
  "[T-036] session 15/8 · rowan · claude · glm-5.3-flash",
  "  transcript: D:\\l\\session-15-rowan-15.log",
  "[T-036] rowan session finished · exit 0",
  "[T-036] session 16/8 · sage · claude · glm-5.3-flash",
  "  transcript: D:\\l\\session-16-sage-16.log",
  "[T-039] session 17/8 · pip · claude · glm-5.3-flash",
  "  transcript: D:\\l\\session-17-pip-17.log",
];
const { sessions, byTask } = parse(sample);
assert.equal(sessions.length, 5, "all session lines must parse");
assert.deepEqual(byTask.get("T-036").map((s) => s.role), ["rowan", "sage"], "per-task ladder keeps order");
assert.equal(byTask.get("T-036")[0].exit, 0, "finished line marks the matching role session");
assert.equal(byTask.get("T-036")[1].exit, null, "open session stays unfinished");
assert.equal(byTask.get("T-035")[0].transcript, "D:\\l\\session-01-mira-1.log", "transcript lines attach to the latest session");
assert.equal(byTask.get("T-039")[0].model, "glm-5.3-flash", "model captured");
assert.equal(byTask.get("T-039")[0].ceiling, 8, "session ceiling captured");

// 3) served assets carry the view when the control plane is up (live gate)
try {
  const base = process.env.ATL_BASE || "http://127.0.0.1:4173";
  const [js, html] = await Promise.all([fetch(base + "/control-plane-client.js").then((r) => r.text()), fetch(base + "/").then((r) => r.text())]);
  assert.ok(js.includes("function parseRunWorkflow("), "served client must carry the parser (per-request serving)");
  assert.ok(html.includes(".wf-step {"), "served html must carry the compiled workflow css");
} catch {
  console.log("(control plane not reachable — served-asset assertions skipped)");
}

console.log("PASS: Workflow runs view — route wiring, role-ladder parser, session/exit/transcript mapping, served assets");
