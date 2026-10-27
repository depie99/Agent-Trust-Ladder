// Optional Jev decision helper. ATL stays dependency-free and deterministic by default.

const DEFAULT_BASE_URL = "https://api.typesafe.ai";

function envFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function compactState({ title = "", objective = "", labels = [] } = {}) {
  return {
    title: String(title).slice(0, 240),
    objective: String(objective).slice(0, 500),
    labels: labels.slice(0, 12).map((label) => String(label).slice(0, 60)),
  };
}

export function jevConfig(root, overrides = {}) {
  const configured = overrides.config || {};
  return {
    enabled: overrides.enabled ?? (envFlag(process.env.ATL_JEV_ENABLED) || configured.enabled === true),
    model: overrides.model || process.env.TYPESAFE_DEFAULT_MODEL || configured.model || "jev-latest",
    minConfidence: Number(overrides.minConfidence ?? process.env.ATL_JEV_MIN_CONFIDENCE ?? configured.min_confidence ?? 0.75),
    timeoutMs: Number(overrides.timeoutMs ?? process.env.ATL_JEV_TIMEOUT_MS ?? configured.timeout_ms ?? 2500),
    apiKey: overrides.apiKey || process.env.TYPESAFE_API_KEY || "",
    baseURL: overrides.baseURL || process.env.TYPESAFE_BASE_URL || DEFAULT_BASE_URL,
  };
}

export async function askJev({ state, options, config, fetchImpl = globalThis.fetch } = {}) {
  if (!config?.enabled) return { enabled: false, reason: "disabled" };
  if (!config.apiKey) return { enabled: false, reason: "TYPESAFE_API_KEY is not set" };
  if (!Array.isArray(options) || options.length === 0) return { enabled: false, reason: "no route options" };
  if (typeof fetchImpl !== "function") return { enabled: false, reason: "fetch is unavailable" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseURL.replace(/\/$/, "")}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        state: compactState(state),
        questions: {
          skill: {
            type: "choice",
            instructions: "Which available specialist is the best first route for this engineering task? Choose only one.",
            criteria: Object.fromEntries(options.map((option) => [option.id, option.description])),
          },
        },
      }),
    });
    if (!response.ok) return { enabled: true, error: `Jev HTTP ${response.status}` };
    const payload = await response.json();
    const answer = payload?.answers?.skill;
    return {
      enabled: true,
      choice: answer?.choice || null,
      confidence: Number.isFinite(answer?.confidence) ? answer.confidence : null,
      probabilities: answer?.probabilities || {},
      model: payload?.model || config.model,
    };
  } catch (error) {
    return { enabled: true, error: error?.name === "AbortError" ? "Jev request timed out" : `Jev request failed: ${error.message}` };
  } finally {
    clearTimeout(timer);
  }
}
