// Host approval surface (#61): /atl-approve consults ctx.approval.request
// when present; denials never reach the CLI, unknown shapes proceed to the
// ATL owner gate as before.
import assert from "node:assert/strict";
import { approveTask } from "../plugins/deepseek-host.mjs";

const registry = { workspaceRegistry: { list: async () => [{ path: "/tmp/proj-a" }] } };
const makeHost = (calls) => ({ call: async (name, payload) => { calls.push({ name, args: payload.args }); return { status: "completed", stdout: "approved" }; } });

for (const [label, decision] of [["false", false], ["approved:false", { approved: false }], ["decision:deny", { decision: "deny" }], ["decision:denied", { decision: "denied" }]]) {
  const calls = [];
  const result = await approveTask({ ...registry, approval: { request: async () => decision } }, makeHost(calls), "T-001", "ship it", undefined);
  assert.match(result, /Denied/, `a ${label} denial reports the refusal`);
  assert.equal(calls.length, 0, `a ${label} denial never invokes atl approve`);
}

const proceedCalls = [];
const proceed = await approveTask({ ...registry, approval: { request: async () => ({ approved: true }) } }, makeHost(proceedCalls), "T-001", "", undefined);
assert.ok(!/Denied/.test(proceed), "an approval decision proceeds to the CLI gate");
assert.equal(proceedCalls.length, 1, "the atl approve command runs");
assert.deepEqual(proceedCalls[0].args.slice(0, 2), ["approve", "T-001"], "the command targets the task");

const noSurfaceCalls = [];
const noSurface = await approveTask(registry, makeHost(noSurfaceCalls), "T-002", "", undefined);
assert.ok(!/Denied/.test(noSurface), "without a host approval surface the flow is unchanged");
assert.equal(noSurfaceCalls.length, 1, "the CLI owner gate runs directly");

console.log("PASS: host approval consultation, denial short-circuit and fallback behavior");
