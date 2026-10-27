import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { submitFeedback, listFeedback, pendingFeedback, markFeedback, feedbackPrompt } from "../runtime/lib/feedback.mjs";
import { emptyState, saveState, createTask } from "../runtime/lib/state.mjs";
import { buildInvocation } from "../runtime/lib/worker.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atl-feedback-"));
fs.mkdirSync(path.join(root, ".trust", "manager"), { recursive: true });
const state = emptyState();
const task = createTask(state, { title: "Feedback contract" });
saveState(root, state);

const queued = submitFeedback(root, { taskId: task.id, prompt: "Use the latest review findings.", mode: "checkpoint", role: "rowan" });
assert.equal(listFeedback(root, { taskId: task.id }).length, 1);
assert.equal(pendingFeedback(root, { taskId: task.id, role: "rowan" })[0].id, queued.id);
assert.match(feedbackPrompt([queued]), /latest review findings/);
const invocation = buildInvocation("codex", { root, workspace: root, role: "rowan", task, feedback: [queued] });
assert.match(invocation.prompt, /Human feedback to apply/);
assert.match(invocation.prompt, /latest review findings/);
markFeedback(root, queued.id, "applied", "session started");
assert.equal(pendingFeedback(root, { taskId: task.id, role: "rowan" }).length, 0);

const interrupt = submitFeedback(root, { taskId: task.id, prompt: "Stop and revisit the output.", mode: "interrupt" });
assert.equal(listFeedback(root, { taskId: task.id, status: "pending" })[0].id, interrupt.id);
fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: durable feedback journal and prompt delivery");
