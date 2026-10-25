// One bounded model planning call against a configured user provider.
//
// The Studio's model mode spends at most ONE confirmed planning session per
// generate/regenerate action. The provider entry comes from the user registry
// (~/.atl/providers.json); credentials are injected into the worker's
// environment at spawn time only and the raw prompt/response transcript lands
// in the draft's provider.log for audit.

import { runInvocation, workerEnvPolicy } from "./worker.mjs";
import { credentialContext } from "./userProviders.mjs";

export const PLANNING_TIMEOUT_MS = 15 * 60 * 1000;

function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

const BOUNDARY = `
Hard boundaries:
- Return JSON only. No prose before or after, no markdown fences.
- Do not claim any check passed. Do not run commands or change files.
- Keep every proposal bounded to the stated intent; never invent extra stages.
`;

// The prompt travels on stdin: long intents must never depend on argv or
// cmd.exe quoting limits on Windows.
export function planningPrompt(request) {
  const regenerate = request?.current_proposal != null;
  const payload = regenerate
    ? {
        task: request.task,
        intent: request.intent,
        manager_feedback: request.feedback || [],
        current_proposal: request.current_proposal,
        required_fields: request.required,
        rule: request.rule,
      }
    : {
        task: request.task,
        intent: request.intent,
        required_fields: request.required,
        rule: request.rule,
      };
  return `${regenerate
    ? "Regenerate exactly one ATL task proposal from the manager feedback. Every other task stays untouched."
    : "Convert the intent into an evidence-gated ATL SDD/TDD plan."}

${JSON.stringify(payload, null, 2)}
${BOUNDARY}`;
}

export async function invokePlanningProvider(root, entry, { request, logPath, timeoutMs = PLANNING_TIMEOUT_MS } = {}) {
  // credentialContext refuses to spawn with an actionable problem list when
  // the provider entry is missing its base URL, key, or worker.
  const credentials = credentialContext(entry);
  const envPolicy = workerEnvPolicy(credentials.worker, "api");
  const invocation = credentials.worker === "claude"
    ? { command: executable("claude"), args: ["-p", "--output-format", "text"], cwd: root }
    : { command: executable("codex"), args: ["exec", "-"], cwd: root };
  const outcome = await runInvocation(invocation, {
    env: credentials.env,
    unsetEnv: envPolicy.unset,
    logPath,
    timeoutMs,
    captureStdout: true,
    stdinText: planningPrompt(request),
  });
  if (outcome.timedOut) return { ...outcome, code: 124, text: "" };
  return outcome;
}
