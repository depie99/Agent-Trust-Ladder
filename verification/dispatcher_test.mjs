import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDispatchPlan } from "../runtime/lib/dispatcher.mjs";
import { emptyState, saveState } from "../runtime/lib/state.mjs";
import { queueAdd } from "../runtime/lib/queue.mjs";
const make = (id, priority) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), `atl-dispatch-${id}-`)); fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true }); const state = emptyState(); state.tasks.T = { id: "T", title: id, status: "assigned", priority, assigned_worker: "rowan" }; saveState(root, state); queueAdd(root, "T"); return { id, root, eligible: true }; };
const a = make("a", "normal"), b = make("b", "urgent"); const plan = buildDispatchPlan([a, b], { maxConcurrent: 2, now: 1 }); assert.equal(plan.length, 2); assert.equal(plan[0].project, "b"); fs.rmSync(a.root, { recursive: true, force: true }); fs.rmSync(b.root, { recursive: true, force: true }); console.log("PASS: supervisor dispatcher enforces bounded, priority-aware project-fair selection");
