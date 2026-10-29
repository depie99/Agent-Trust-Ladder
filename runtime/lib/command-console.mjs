import { buildLaunchPlan, queueDryRun } from "./launch.mjs";
import { renderBrief, renderTask, wakeActions, activeTasks } from "./render.mjs";
import { loadState, logEvent, saveState } from "./state.mjs";
import { renderFeed, post as feedPost } from "./feed.mjs";
import { explainTasks, unblockTask, approveTask } from "./recovery.mjs";
import { loadQueueBook, queueAdd, queueArchive, queueClear, queueCreate, queueIds, queueInspect, queueList, queuePause, queueRemove, queueRename, queueReorder, queueResume, queueSetActive } from "./queue.mjs";
import { submitFeedback } from "./feedback.mjs";
import { wrapLine } from './tui-layout.mjs';
import { listNotifications, snoozeNotification, updateNotification } from "./notifications.mjs";
import { archiveTask, createTaskInWorkspace, editTaskInWorkspace, restoreTask } from "./task-workspace.mjs";
import { addProposal, addProposalFeedback, approvePlanDraft, editProposal, frameIntent, generateLocalPlan, listPlanDrafts, loadPlanDraft, normalizeProposals, planDraftLabel, removeProposal, reorderProposals, savePlanDraft } from "./plan-studio.mjs";

export const TUI_COMMANDS = Object.freeze([
  { name: "help", usage: "help", kind: "read", summary: "list commands" },
  { name: "why", usage: "why [task-id]", kind: "read", summary: "explain blockers and next actions" },
  { name: "show", usage: "show [task-id]", kind: "read", summary: "inspect a task or active portfolio" },
  { name: "brief", usage: "brief", kind: "read", summary: "render the manager brief" },
  { name: "wake", usage: "wake", kind: "read", summary: "show the next role actions" },
  { name: "feed", usage: "feed [--task T-001]", kind: "read", summary: "read the team feed" },
  { name: "queue", usage: "queue list|create|use|rename|reorder|pause|resume|archive|inspect|dry-run|add|remove|clear", kind: "mutation", summary: "manage named execution queues" },
  { name: "task", usage: "task create|edit|archive|restore ...", kind: "mutation", summary: "manage task records safely" },
  { name: "plan", usage: "plan generate|list|show|frame|card|feedback|approve", kind: "mutation", summary: "generate, edit, and approve plan drafts with typed task cards" },
  { name: "unblock", usage: "unblock <task-id> [--to triaged|assigned] [--note text]", kind: "mutation", summary: "recover a blocked task" },
  { name: "approve", usage: "approve <task-id> [--note text]", kind: "confirm", summary: "record owner approval and queue" },
  { name: "feedback", usage: "feedback add <task-id> <text> [--mode checkpoint|interrupt]", kind: "mutation", summary: "send durable bot feedback" },
  { name: "notify", usage: "notify list|ack <id>|snooze <id> [minutes]", kind: "mutation", summary: "manage notifications" },
  { name: "launch", usage: "launch --dry-run|--confirm", kind: "confirm", summary: "open the bounded launch gate" },
]);

function tokenize(input) {
  const tokens = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let match;
  let consumed = 0;
  while ((match = pattern.exec(input)) !== null) {
    if (input.slice(consumed, match.index).trim()) throw new Error("command contains an unmatched quote or invalid spacing");
    tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\([\\"'])/g, "$1"));
    consumed = pattern.lastIndex;
  }
  if (input.slice(consumed).trim()) throw new Error("command contains an unmatched quote or invalid spacing");
  return tokens;
}

function options(tokens) {
  const args = [];
  const flags = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = tokens[i + 1];
    if (next && !next.startsWith("--")) flags[key] = tokens[++i];
    else flags[key] = true;
  }
  return { args, flags };
}

function result(lines, extra = {}) {
  const values = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  return { ok: true, lines: values.flatMap((line) => String(line ?? "").split(/\r?\n/)), refresh: false, ...extra };
}

function requireTask(root, id) {
  const state = loadState(root);
  const task = state.tasks[id];
  if (!task) throw new Error(`Unknown task ${id}`);
  return task;
}

function formatWhy(root, id) {
  const rows = explainTasks(root, id);
  if (id && rows.length === 0) {
    const task = requireTask(root, id);
    return [`${id} is ${task.status} — nothing is blocking it.`];
  }
  const lines = [`# Why — ${id || "every active task"}`, ""];
  for (const row of rows) {
    const task = row.task;
    lines.push(`${task.id} [${task.status}] (${task.priority}${task.risk === "risky" ? "/risky" : ""}) ${task.title}`);
    lines.push(`  why: ${row.why}`);
    if (row.since) lines.push(`  blocked ${row.since}${row.actor ? ` by ${row.actor}` : ""}`);
    if (row.fix) lines.push(`  fix: ${row.fix}`);
    lines.push("");
  }
  const gates = rows.filter((row) => row.kind === "owner-approval" || row.kind === "human-action").length;
  if (!id) lines.push(`${rows.length} active task(s), ${gates} waiting on a human-owned gate.`);
  return lines;
}

function formatQueue(root) {
  const queues = queueList(root, { includeArchived: false });
  const lines = [`Queues · active ${loadQueueBook(root).active_queue || "default"}`, ""];
  for (const queue of queues) {
    lines.push(`${queue.id} · ${queue.name} · ${queue.status} · ${queue.items.length} task(s) · budget ${queue.policy.maxMinutes}m/${queue.policy.maxSessions} sessions`);
    for (const item of queue.items) lines.push(`  ${item.id} · added by ${item.added_by || "manager"}`);
  }
  if (queues.every((queue) => !queue.items.length)) lines.push("No tasks are queued.");
  return lines;
}

function formatLaunchPlan(plan) {
  const lines = [`Launch preview · ${plan.items.length} queued · ${plan.readyCount} ready · ${plan.blockedCount} blocked`, `Budget ${plan.budget.maxMinutes}m / ${plan.budget.maxSessions} sessions · sequential`, ""];
  for (const item of plan.items) {
    lines.push(`${item.taskId} [${item.status}] → ${item.role || "-"} · ${item.provider.worker}/${item.provider.auth}`);
    lines.push(`  ${item.title}`);
    for (const blocker of item.blockers || []) lines.push(`  BLOCKED: ${blocker}`);
  }
  return lines;
}

function commandHelp() {
  const rows = TUI_COMMANDS.map((command) => {
    const usage = command.usage.length > 40 ? `${command.usage.slice(0, 39)}…` : command.usage.padEnd(40);
    return `${usage} ${command.summary}`.slice(0, 60);
  });
  return ["ATL command console — use `atl <command>` or `<command>`; no shell execution.".slice(0, 60), "", ...rows, "", "Mutation commands use the same state/recovery/queue modules; launch --confirm opens the gate.".slice(0, 60)];
}

export function commandCompletions(prefix = "") {
  const value = String(prefix).trim().toLowerCase();
  return TUI_COMMANDS.filter((command) => command.name.startsWith(value)).map((command) => command.name);
}

export function dispatchTuiCommand(root, input, { selectedTaskId = null } = {}) {
  const raw = String(input || "").trim();
  if (!raw) return result(["Enter an ATL command. Press ? for help."], { error: true });
  const tokens = tokenize(raw);
  // The in-TUI console is intentionally compatible with the installed CLI:
  // both `why T-001` and `atl why T-001` should be valid.  Without this
  // normalization, users who move between the shell and control room get an
  // unnecessary "Unknown command atl" failure.
  if (tokens[0]?.toLowerCase() === "atl") tokens.shift();
  const command = tokens.shift()?.toLowerCase() || "";
  const { args, flags } = options(tokens);
  try {
    if (command === "help" || command === "?") return result(commandHelp());
    if (command === "why") return result(formatWhy(root, args[0] || selectedTaskId));
    if (command === "show") {
      const state = loadState(root);
      if (args[0]) return result(renderTask(requireTask(root, args[0])));
      return result(activeTasks(state).map((task) => `${task.id} [${task.status}] ${task.title}`));
    }
    if (command === "brief") return result(renderBrief(loadState(root)));
    if (command === "wake") {
      const state = loadState(root);
      const actions = wakeActions(state, { budgets: {} });
      return result(actions.length ? actions.map((action) => `for ${action.for} · ${action.task}: ${action.what}`) : "No action is currently due.");
    }
    if (command === "feed") return result(renderFeed(root, { task: flags.task || args[0] || null, n: Number(flags.n || 100) }));
    if (command === "queue") {
      const sub = args[0] || "list";
      const taskId = args[1] || selectedTaskId;
      if (sub === "list") return result(formatQueue(root));
      if (sub === "add") {
        if (!taskId) throw new Error("queue add needs a task id");
        requireTask(root, taskId);
        const outcome = queueAdd(root, taskId, { by: "manager", queueId: flags.queue || null });
        return result(`${taskId} ${outcome.added ? "queued" : "was already queued"}.`, { refresh: true });
      }
      if (sub === "remove") {
        if (!taskId) throw new Error("queue remove needs a task id");
        const outcome = queueRemove(root, taskId, { queueId: flags.queue || null });
        return result(`${taskId} ${outcome.removed ? "removed from" : "was not in"} the queue.`, { refresh: true });
      }
      if (sub === "clear") return result(`Queue cleared (${queueClear(root, { queueId: flags.queue || null }).removed} item(s)).`, { refresh: true });
      if (sub === "create") {
        const id = args[1];
        if (!id) throw new Error("queue create needs an id");
        const queue = queueCreate(root, id, { name: flags.name || id });
        return result(`Queue ${queue.id} created.`, { refresh: true });
      }
      if (sub === "use" || sub === "select") {
        const id = args[1];
        if (!id) throw new Error("queue use needs an id");
        queueSetActive(root, id);
        return result(`Active queue → ${id}.`, { refresh: true });
      }
      if (sub === "archive") {
        const id = args[1];
        if (!id) throw new Error("queue archive needs an id");
        queueArchive(root, id);
        return result(`Queue ${id} archived.`, { refresh: true });
      }
      if (sub === "rename") {
        const id = args[1];
        const name = flags.name || args.slice(2).join(" ");
        if (!id || !name) throw new Error("queue rename needs an id and --name text");
        const queue = queueRename(root, id, name);
        return result(`Queue ${queue.id} renamed to "${queue.name}".`, { refresh: true });
      }
      if (sub === "reorder") {
        const taskId = args[1] || selectedTaskId;
        const position = Number(args[2] ?? flags.position ?? 0);
        if (!taskId || !Number.isFinite(position)) throw new Error("queue reorder needs a task id and a 0-based position");
        const queue = queueReorder(root, taskId, position, { queueId: flags.queue || null });
        return result([`Queue ${queue.queue_id} order:`, ...queue.items.map((item, index) => `  ${index + 1}. ${item.id}`)], { refresh: true });
      }
      if (sub === "pause") {
        const id = args[1] || loadQueueBook(root).active_queue;
        if (!id) throw new Error("queue pause needs an id");
        const queue = queuePause(root, id);
        return result(`Queue ${queue.id} paused — launches refuse it until resume.`, { refresh: true });
      }
      if (sub === "resume") {
        const id = args[1] || loadQueueBook(root).active_queue;
        if (!id) throw new Error("queue resume needs an id");
        const queue = queueResume(root, id);
        return result(`Queue ${queue.id} resumed.`, { refresh: true });
      }
      if (sub === "inspect") {
        const id = args[1] || flags.queue || null;
        const view = queueInspect(root, id);
        return result([
          `Queue ${view.queue.id} · ${view.queue.name} · ${view.queue.status} · budget ${view.queue.policy.maxMinutes}m/${view.queue.policy.maxSessions} sessions · concurrency ${view.queue.policy.maxConcurrent}`,
          ...view.tasks.map((task) => `  ${task.id} [${task.status}] (${task.priority}) ${task.title}`),
        ]);
      }
      if (sub === "dry-run") {
        const preview = queueDryRun(root, { queueId: args[1] || flags.queue || null });
        return result([
          `Dry run · queue ${preview.queueId} (${preview.queueStatus}) · ${preview.items.length} task(s) · ${preview.readyCount} ready · ${preview.blockedCount} blocked`,
          `Run gate: ${preview.runGate.active ? `ACTIVE (${preview.runGate.queueId})` : "free"} · global concurrency ${preview.globalMaxConcurrent} · budget ${preview.budget.maxMinutes}m/${preview.budget.maxSessions} sessions`,
          ...preview.items.map((item) => `  ${item.taskId} [${item.status}] → ${item.role || "-"} ${item.blockers.length ? `BLOCKED: ${item.blockers[0]}` : "ready"}`),
        ]);
      }
      throw new Error("queue expects list, create, use, rename, reorder, pause, resume, archive, inspect, dry-run, add, remove, or clear");
    }
    if (command === "task") {
      const sub = args.shift();
      const taskId = args.shift() || selectedTaskId;
      if (sub === "create") {
        const title = flags.title || args.join(" ");
        const task = createTaskInWorkspace(root, { title, priority: flags.priority, risk: flags.risk, labels: flags.label ? [flags.label] : [] });
        return result(`${task.id} created · ${task.title}`, { refresh: true, selectedTaskId: task.id });
      }
      if (!taskId) throw new Error(`task ${sub || "command"} needs a task id`);
      if (sub === "archive") return result(`${taskId} archived. History and evidence remain recoverable.`, { refresh: true, task: archiveTask(root, taskId, { note: flags.note || "archived from the TUI command console" }).task });
      if (sub === "restore") return result(`${taskId} restored to new intake.`, { refresh: true, task: restoreTask(root, taskId) });
      if (sub === "edit") {
        const fields = {};
        if (flags.title) fields.title = flags.title;
        if (flags.objective) fields.objective = flags.objective;
        if (flags.priority) fields.priority = flags.priority;
        if (flags.risk) fields.risk = flags.risk;
        if (flags.check) fields.completion_checks = [String(flags.check)];
        return result(`${taskId} edited (${Object.keys(fields).join(", ") || "no fields"}).`, { refresh: true, task: editTaskInWorkspace(root, taskId, fields) });
      }
      throw new Error("task expects create, edit, archive, or restore");
    }
    if (command === "plan") {
      const sub = args.shift();
      if (sub === "generate") {
        const intent = args.join(" ").trim();
        if (!intent) throw new Error("plan generate needs an intent");
        const artifact = generateLocalPlan(intent);
        // Persist normalized cards so each carries its generated-plan default
        // (worker/skills baseline) from the very first save.
        artifact.task_proposals = normalizeProposals(artifact);
        const draft = savePlanDraft(root, { intent, artifact, stage: "plan" });
        return result([`Local structural draft ${draft.id} generated (deterministic — not model output).`, "Task cards are editable in Plan Studio; model generation is a separate, explicitly confirmed mode."], { refresh: true, effect: "plan-preview", draft });
      }
      if (sub === "list") return result(listPlanDrafts(root).map((draft) => `${draft.id} [${draft.stage}] ${draft.artifact?.title || "Untitled"}`) || "No plan drafts.");
      if (sub === "show") {
        const id = args[0];
        if (!id) throw new Error("plan show needs a draft id");
        const draft = loadPlanDraft(root, id);
        return result([`${draft.id} [${draft.stage}]`, JSON.stringify(draft.artifact, null, 2)], { effect: "plan-preview", draft });
      }
      if (sub === "frame") {
        const intent = args.join(" ").trim();
        if (!intent) throw new Error("plan frame needs an intent");
        const artifact = frameIntent(intent, { skills: ["atl-frame", "atl-specify", "atl-plan", "atl-verify"] });
        const draft = savePlanDraft(root, { intent, artifact, stage: "frame" });
        return result([`Plan draft ${draft.id} saved at frame stage.`, "Provider planning is not invoked; confirm it explicitly in the provider-backed Plan Studio flow."], { refresh: true });
      }
      if (sub === "approve") {
        const id = args[0];
        if (!id) throw new Error("plan approve needs a draft id");
        const approved = approvePlanDraft(root, id);
        const label = planDraftLabel(approved.draft);
        const lines = approved.created
          ? [`Plan queue ${approved.queueId} created with ${approved.taskIds.length} ordered task(s) from ${label.mode === "model" ? `model plan (${label.label})` : label.label}.`, `Tasks: ${approved.taskIds.join(", ")}`, "Nothing is executing — preview the queue and confirm a run explicitly."]
          : [`Plan draft ${id} was already approved — no duplicates created.`, `Tasks: ${approved.taskIds.join(", ")}`];
        return result(lines, { refresh: true, selectedTaskId: approved.task?.id || null, queueId: approved.queueId, taskIds: approved.taskIds, created: approved.created });
      }
      if (sub === "card") {
        const cardAction = args.shift();
        const draftId = args.shift();
        if (!draftId) throw new Error("plan card needs a draft id");
        const proposalId = args.shift();
        if (cardAction === "edit") {
          if (!proposalId) throw new Error("plan card edit needs a proposal id");
          const rename = { worker: "proposed_worker", skills: "selected_skills", checks: "completion_checks", "depends-on": "depends_on" };
          const patch = {};
          for (const [key, value] of Object.entries(flags)) {
            if (value === true) continue;
            patch[rename[key] || key] = value;
          }
          const updated = editProposal(root, draftId, proposalId, patch);
          const card = updated.artifact.task_proposals.find((proposal) => proposal.id === proposalId);
          return result(`Card ${proposalId} edited — now rev ${card.revision} (${card.source}).`, { refresh: true, draft: updated });
        }
        if (cardAction === "add") {
          const updated = addProposal(root, draftId, { title: flags.title, objective: flags.objective, proposed_worker: flags.worker, selected_skills: flags.skills, completion_checks: flags.checks, verify: flags.verify });
          const card = updated.artifact.task_proposals.at(-1);
          return result(`Card ${card.id} added — now rev ${card.revision}.`, { refresh: true, draft: updated, selectedTaskId: null });
        }
        if (cardAction === "remove") {
          if (!proposalId) throw new Error("plan card remove needs a proposal id");
          const updated = removeProposal(root, draftId, proposalId);
          return result(`Card ${proposalId} removed; dangling dependencies cleaned.`, { refresh: true, draft: updated });
        }
        if (cardAction === "reorder") {
          if (!proposalId) throw new Error("plan card reorder needs a proposal id");
          const position = Number(args.shift() ?? flags.position ?? 0);
          const updated = reorderProposals(root, draftId, proposalId, position);
          const order = updated.artifact.task_proposals.map((proposal) => proposal.id).join(" → ");
          return result(`Card ${proposalId} moved. Order: ${order}`, { refresh: true, draft: updated });
        }
        throw new Error("plan card expects edit, add, remove, or reorder");
      }
      if (sub === "feedback") {
        const draftId = args.shift();
        const proposalId = args.shift();
        const prompt = args.join(" ").trim();
        if (!draftId || !proposalId || !prompt) throw new Error("plan feedback needs a draft id, a proposal id, and the correction text");
        const updated = addProposalFeedback(root, draftId, proposalId, prompt);
        return result(`Feedback recorded on card ${proposalId} — regenerate that card to apply it.`, { refresh: true, draft: updated });
      }
      throw new Error("plan expects generate, generate-model (browser/API), list, show, frame, card, feedback, or approve <draft-id>");
    }
    if (command === "unblock") {
      const taskId = args[0] || selectedTaskId;
      if (!taskId) throw new Error("unblock needs a task id");
      const recovered = unblockTask(root, taskId, { to: flags.to, note: flags.note || "blocker resolved in the TUI" });
      feedPost(root, { from: "mira", text: `${taskId} unblocked → ${recovered.to}.`, task: taskId, detail: flags.note || "" });
      return result(`${taskId} unblocked → ${recovered.to}. Next: queue it and open the launch gate.`, { refresh: true });
    }
    if (command === "approve") {
      const taskId = args[0] || selectedTaskId;
      if (!taskId) throw new Error("approve needs a task id");
      const approved = approveTask(root, taskId, { note: flags.note || "owner approval recorded in the TUI" });
      const state = loadState(root);
      logEvent(state, { task: taskId, actor: "manager", event: "approve", detail: approved.detail });
      saveState(root, state);
      return result(`${taskId} approved${approved.unblocked ? ` and unblocked → ${approved.task.status}` : ""}; ${approved.queued ? "queued" : "already queued"}.`, { refresh: true });
    }
    if (command === "feedback") {
      if (args[0] !== "add") throw new Error("feedback expects add <task-id> <text>");
      const taskId = args[1] || selectedTaskId;
      const prompt = args.slice(2).join(" ");
      if (!taskId || !prompt) throw new Error("feedback add needs a task id and prompt");
      const item = submitFeedback(root, { taskId, prompt, mode: flags.mode || "checkpoint", role: flags.role || null });
      return result(`Feedback ${item.id} queued for ${taskId} (${item.mode}).`, { refresh: true });
    }
    if (command === "notify") {
      const sub = args[0] || "list";
      if (sub === "list") {
        const rows = listNotifications(root, { limit: Number(flags.n || 20) });
        return result(rows.length
          ? rows.map((item) => `${item.id} [${item.severity}${item.count > 1 ? ` ×${item.count}` : ""}] ${item.state}${item.taskId ? ` → ${item.taskId}` : ""} ${item.title}`)
          : "No notifications are due.");
      }
      if (sub === "ack") {
        const id = args[1];
        if (!id) throw new Error("notify ack needs an id");
        const item = updateNotification(root, id, { state: "acknowledged" });
        return result(`${item.id} acknowledged.`, { refresh: true });
      }
      if (sub === "snooze") {
        const id = args[1];
        if (!id) throw new Error("notify snooze needs an id");
        const minutes = Number(args[2] || 30);
        const item = snoozeNotification(root, id, minutes);
        return result(`${item.id} snoozed until ${item.snoozed_until}.`, { refresh: true });
      }
      throw new Error("notify expects list, ack <id>, or snooze <id> [minutes]");
    }
    if (command === "launch") {
      const plan = flags.queue
        ? queueDryRun(root, { queueId: String(flags.queue) })
        : buildLaunchPlan(root, { taskIds: queueIds(root) });
      if (flags["dry-run"] || !flags.confirm) return result(formatLaunchPlan(plan), { effect: "launch-preview", launchPlan: plan });
      return result(["Launch confirmation remains in the existing launch screen.", "Press Enter/y there to start the bounded run."], { effect: "launch-preview", launchPlan: plan });
    }
    throw new Error(`Unknown command "${command}". Press ? for help.`);
  } catch (error) {
    // Direct CLI/TUI callers need a bounded diagnostic even before the screen
    // viewport wraps it. Full evidence remains available through `why` and
    // the logs; command errors stay one readable terminal row.
    return result(wrapLine(`Error: ${error.message}`.slice(0, 500), 60), { ok: false, error: true });
  }
}
