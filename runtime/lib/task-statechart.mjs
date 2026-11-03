import { STATE_CONTRACT } from "./state.mjs";

// Project recorded transitions only; never invent steps from the workflow contract.
export function taskStatechart(task, log = []) {
  const transitions = log.filter((entry) => entry.task === task.id).flatMap((entry) => {
    const match = /^([a-z_]+) -> ([a-z_]+)$/.exec(entry.event || "");
    return match ? [{ from: match[1], to: match[2], at: entry.at || null, actor: entry.actor || null, detail: entry.detail || "" }] : [];
  });
  const steps = [];
  for (const edge of transitions) {
    if (!steps.length || steps.at(-1).state !== edge.from) {
      steps.push({ state: edge.from, gap_before: steps.length > 0, at: null });
    }
    steps.push({ state: edge.to, at: edge.at, actor: edge.actor, detail: edge.detail });
  }
  if (!steps.length || steps.at(-1).state !== task.status) {
    steps.push({ state: task.status, at: null, gap_before: steps.length > 0, snapshot: true });
  }
  const mermaid = ["stateDiagram-v2", ...steps.map((step, index) => `    state "${step.state.replaceAll("_", " ").replace(/[^a-zA-Z0-9 ]/g, "")}" as s${index}`), ...steps.slice(1).map((step, index) => `    s${index} --> s${index + 1}: ${step.gap_before ? "history gap" : "recorded transition"}`)].join("\n");
  const workflowTransitions = Object.entries(STATE_CONTRACT.transitions).map(([key, rule]) => {
    const [from, to] = key.split("->");
    return { from, to, actors: [...rule.actors], requires: [...rule.requires] };
  });
  const workflowMermaid = [
    "stateDiagram-v2",
    "    direction LR",
    ...STATE_CONTRACT.statuses.map((name) => `    state "${name.replaceAll("_", " ")}" as s_${name}`),
    ...workflowTransitions.map((edge) => `    s_${edge.from} --> s_${edge.to}: ${edge.actors.join(", ")}${edge.requires.length ? ` [${edge.requires.join(", ")}]` : ""}`),
  ].join("\n");
  return { source: ".trust/manager/state.json log", current: task.status, evidence_level: transitions.length ? "recorded-history" : "snapshot-only", history_complete: false, steps, transitions, workflow_states: [...STATE_CONTRACT.statuses], workflow_transitions: workflowTransitions, workflow_mermaid: workflowMermaid, mermaid };
}
