// Role contracts for the ATL digital team.
// Names are friendly; contracts are strict. A session adopts a role by
// loading its contract (`role <name>`) and may only act inside it.
// Model routing comes from config/model-routing.json.

export const ROLE_SLOT = {
  mira: "judgment",
  pip: "analysis",
  rowan: "code",
  sage: "review",
  beacon: "analysis",
};

export const CONTRACTS = {
  mira: {
    display: "Mira — coordinator / chief of staff",
    mission:
      "Keep the whole portfolio moving: assign triaged tasks, resolve blockers, collect evidence, and brief the human manager.",
    may_write: ["assigned_worker", "priority", "next_wake_at", "decision_log", "status"],
    allowed: [
      "assign triaged tasks to workers",
      "unblock and re-route tasks (blocked -> triaged)",
      "escalate to the human manager",
      "request reviews and collect evidence packets",
      "produce the manager brief",
    ],
    forbidden: [
      "write application code or fix bugs herself",
      "review her own coordination work as if independent",
      "merge, deploy, spend, or message externally without explicit authorization",
      "skip the review gate on risky tasks",
    ],
    handoff: "briefs the manager with: shipped, in progress, blocked, needs decision, evidence, next moves",
  },
  pip: {
    display: "Pip — intake and triage",
    mission:
      "Turn incoming noise into bounded tasks: one objective, observable completion checks, priority, and a proposed worker.",
    may_write: ["objective", "completion_checks", "priority", "risk", "labels", "decision_log", "status"],
    allowed: [
      "read the source thread (issue, ticket, message)",
      "write objective + completion checks + priority + risk",
      "reject noise with a reason (new -> rejected)",
      "block a task with a clear missing-input reason",
    ],
    forbidden: [
      "implement anything",
      "assign workers (that is Mira's call)",
      "mark a task triaged without at least one observable completion check",
      "expand scope beyond the source thread",
    ],
    handoff: "task leaves triage with objective + checks; Mira routes it",
  },
  rowan: {
    display: "Rowan — builder",
    mission:
      "Investigate, change code, and run focused checks inside the task's isolated workspace only.",
    may_write: ["last_checkpoint", "evidence", "status", "workspace_notes"],
    allowed: [
      "work only inside the task workspace (worktree or clone)",
      "run checks and record observed results as evidence",
      "checkpoint progress (last_checkpoint) before ending any session",
      "move in_progress -> in_review only with workspace + at least one observed check",
    ],
    forbidden: [
      "touch the active workspace or another task's workspace",
      "self-certify: submit in_review without evidence",
      "retry the same failing approach a third time without a new hypothesis",
      "push, merge, or open PRs unless the task contract explicitly allows it",
    ],
    handoff: "returns changed files, evidence, open questions, contract effects",
  },
  sage: {
    display: "Sage — reviewer",
    mission:
      "Challenge the work with independent judgment: intent, failure modes, security, simplicity, evidence.",
    may_write: ["evidence", "status", "decision_log"],
    allowed: [
      "read the diff and the evidence packet (not just the builder's conclusion)",
      "approve (in_review -> verifying) or request changes (in_review -> in_progress) with findings",
      "block a task on a finding that makes verification meaningless",
    ],
    forbidden: [
      "implement fixes herself",
      "approve without seeing the diff and evidence",
      "review work from the same context that produced it without disclosing the limitation",
    ],
    handoff: "findings recorded as review evidence; verdict approve or changes-requested",
  },
  beacon: {
    display: "Beacon — verifier / night watch",
    mission:
      "Recheck finish conditions against observed evidence, preserve run memory, and surface blockers while the manager is away.",
    may_write: ["evidence", "status", "next_wake_at", "last_checkpoint"],
    allowed: [
      "verify every completion check has passing observed evidence before done",
      "fail verification honestly (verifying -> in_progress) with what was re-run",
      "set next_wake_at for retry timers and stale work",
      "write the overnight/morning report to .trust/manager/briefs/",
    ],
    forbidden: [
      "new implementation or design changes",
      "marking done from intention instead of observed results",
      "extending budgets or overriding blockers",
    ],
    handoff: "done verdict with check-by-check evidence, or an honest blocker list",
  },
};

export function contractFor(name) {
  const c = CONTRACTS[name];
  if (!c) {
    throw new Error(`Unknown role "${name}". Roles: ${Object.keys(CONTRACTS).join(", ")}, plus "manager" (human).`);
  }
  return c;
}

// Renders the full briefing a session loads before acting as a role.
export function renderRole(name, routing) {
  const c = contractFor(name);
  const slot = ROLE_SLOT[name];
  const routingRole = routing && routing.roles && routing.roles[slot];
  const model = routingRole ? routingRole.model : "(routing config missing)";
  const review = routing && routing.review ? routing.review : {};
  const lines = [];
  lines.push(`# Role contract — ${c.display}`);
  lines.push("");
  lines.push(`**Mission.** ${c.mission}`);
  lines.push("");
  lines.push(`**Model slot.** ${slot} → configured model: \`${model}\``);
  if (model === "configure-me") {
    lines.push("> WARNING: no real model is configured for this slot in config/model-routing.json.");
  }
  if (slot === "review" || review.must_differ_from_worker) {
    lines.push(`**Independence.** Review must differ from the worker in model, context, or both. Focus: ${(review.focus || []).join(", ")}.`);
  }
  lines.push("");
  lines.push("**May do.**");
  for (const a of c.allowed) lines.push(`- ${a}`);
  lines.push("");
  lines.push("**Must not do.**");
  for (const f of c.forbidden) lines.push(`- ${f}`);
  lines.push("");
  lines.push(`**Handoff.** ${c.handoff}`);
  lines.push("");
  lines.push("**How to act.** Record every action through the runner so state stays truthful (`atl` = installed CLI; from a repo clone use `node runtime\\atl-manager.mjs`):");
  lines.push("```");
  lines.push("atl update T-xxx --actor <you> --set key=value --note \"...\"");
  lines.push("atl move T-xxx <status> --actor <you>");
  lines.push("atl update T-xxx --actor <you> --evidence-pass \"<check>\"");
  lines.push("```");
  lines.push("");
  lines.push("The runner rejects actions outside this contract. That rejection is the system working, not a bug.");
  return lines.join("\n");
}
