import assert from "node:assert/strict";
import { windowsScheduledTaskPlan } from "../runtime/lib/overnight-hosts/windows-task-scheduler.mjs";

const plan = windowsScheduledTaskPlan({ managerPath: "C:/atl/runtime/atl-manager.mjs", projectRoot: "C:/work/project", at: "22:30" });
assert.equal(plan.platform, "win32");
assert.deepEqual(plan.schedule, { type: "daily", at: "22:30" });
assert.ok(plan.create.includes("schtasks.exe"), "the adapter identifies the Windows scheduler command without invoking it");
assert.match(plan.create.join(" "), /overnight recover --confirm/, "a scheduled recovery is still confirmation-gated by its durable record");
assert.throws(() => windowsScheduledTaskPlan({ managerPath: "a", projectRoot: "b", at: "tomorrow" }), /HH:MM/);
console.log("PASS: overnight host — Windows schedule commands are inspectable and never invoked by the adapter");
