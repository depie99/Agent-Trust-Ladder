// User provider registry: named API providers (e.g. "zai" GLM) with their
// base URL, API key, and model, stored ONCE per machine in ~/.atl/providers.json.
//
// The registry lives outside every repository on purpose: API keys must never
// land in config/manager.json (committed) or .trust/manager state. ATL never
// echoes a key — everything user-facing shows maskKey() output — and the
// launch engine injects credentials into the worker's environment only at
// spawn time (see launch.mjs / credentialContext).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REGISTRY_VERSION = 2;

// Shared capability vocabulary. Providers may expose a subset, while
// `default` always means "let the provider decide".
export const THINKING_LEVELS = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
export const PROVIDER_PROTOCOLS = ["openai", "anthropic", "custom"];

// Ready-made endpoint presets. `baseUrl` is keyed by the worker CLI that will
// run the provider: claude speaks the Anthropic wire, codex the OpenAI one.
export const PROVIDER_TEMPLATES = [
  {
    id: "openai",
    label: "OpenAI GPT (OpenAI-compatible)",
    protocol: "openai",
    worker: "codex",
    models: ["gpt-5.6", "gpt-5.6-codex", "gpt-5.3-codex"],
    thinkingLevels: THINKING_LEVELS,
    baseUrl: { codex: "https://api.openai.com/v1", claude: "" },
  },
  {
    id: "gemini",
    label: "Google Gemini (OpenAI-compatible)",
    protocol: "openai",
    worker: "codex",
    models: ["gemini-3.8-pro", "gemini-3.8-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
    thinkingLevels: THINKING_LEVELS,
    baseUrl: { codex: "https://generativelanguage.googleapis.com/v1beta/openai/", claude: "" },
  },
  {
    id: "zai",
    label: "Z.ai GLM (international)",
    protocol: "anthropic",
    worker: "claude",
    models: ["glm-5.3", "glm-5.3-flash", "glm-4.6", "glm-4.5", "glm-4.5-air"],
    thinkingLevels: THINKING_LEVELS,
    baseUrl: {
      claude: "https://api.z.ai/api/anthropic",
      codex: "https://api.z.ai/api/coding/paas/v4",
    },
  },
  {
    id: "bigmodel",
    label: "Zhipu bigmodel.cn GLM (mainland China)",
    protocol: "anthropic",
    worker: "claude",
    models: ["glm-5.3", "glm-5.3-flash", "glm-4.6", "glm-4.5", "glm-4.5-air"],
    thinkingLevels: THINKING_LEVELS,
    baseUrl: {
      claude: "https://open.bigmodel.cn/api/anthropic",
      codex: "https://open.bigmodel.cn/api/coding/paas/v4",
    },
  },
  {
    id: "anthropic",
    label: "Anthropic Claude (Anthropic-compatible)",
    protocol: "anthropic",
    worker: "claude",
    models: ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6"],
    thinkingLevels: THINKING_LEVELS,
    baseUrl: { claude: "https://api.anthropic.com", codex: "" },
  },
  {
    id: "openrouter",
    label: "OpenRouter (OpenAI-compatible gateway)",
    protocol: "openai",
    worker: "codex",
    models: [],
    thinkingLevels: THINKING_LEVELS,
    baseUrl: { codex: "https://openrouter.ai/api/v1", claude: "" },
  },
  {
    id: "custom",
    label: "Custom endpoint (OpenAI / Anthropic / other)",
    protocol: "custom",
    worker: "codex",
    models: [],
    thinkingLevels: THINKING_LEVELS,
    baseUrl: { claude: "", codex: "" },
  },
];

export function registryPath() {
  return path.join(os.homedir(), ".atl", "providers.json");
}

export function loadUserProviders() {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    const providers = parsed && typeof parsed === "object" && parsed.providers && typeof parsed.providers === "object"
      ? parsed.providers
      : {};
    return { version: REGISTRY_VERSION, providers };
  } catch {
    return { version: REGISTRY_VERSION, providers: {} };
  }
}

export function saveUserProviders(registry) {
  const file = registryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean = {};
  for (const [id, entry] of Object.entries(registry.providers || {})) {
    if (entry && typeof entry === "object") clean[id] = entry;
  }
  fs.writeFileSync(file, `${JSON.stringify({ version: REGISTRY_VERSION, providers: clean }, null, 2)}\n`, "utf8");
  return file;
}

const ID_RE = /^[\w][\w.-]*$/;

export function assertProviderId(id) {
  const value = String(id || "").trim().toLowerCase();
  if (!ID_RE.test(value)) {
    throw new Error(`provider id "${id}" must start with a letter/digit and use only letters, digits, dot, dash, underscore`);
  }
  return value;
}

export function upsertProvider(registry, id, fields) {
  const cleanId = assertProviderId(id);
  const existing = registry.providers[cleanId] || {};
  const entry = {
    id: cleanId,
    label: String(fields.label || existing.label || cleanId),
    worker: String(fields.worker || existing.worker || "claude").toLowerCase(),
    protocol: String(fields.protocol || existing.protocol || "custom").toLowerCase(),
    base_url: String(fields.base_url ?? existing.base_url ?? ""),
    api_key: fields.api_key !== undefined ? String(fields.api_key) : String(existing.api_key || ""),
    model: fields.model ? String(fields.model) : String(existing.model || ""),
    models: Array.isArray(fields.models) ? fields.models.map(String) : (existing.models || []),
    thinking_level: normalizeThinkingLevel(fields.thinking_level ?? existing.thinking_level ?? ""),
    thinking_levels: Array.isArray(fields.thinking_levels) && fields.thinking_levels.length
      ? fields.thinking_levels.map(String)
      : (existing.thinking_levels || THINKING_LEVELS),
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  registry.providers[cleanId] = entry;
  return entry;
}

export function normalizeThinkingLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return !level || level === "default" ? "" : (THINKING_LEVELS.includes(level) ? level : level.slice(0, 32));
}

export function removeProvider(registry, id) {
  const cleanId = assertProviderId(id);
  const entry = registry.providers[cleanId];
  if (!entry) throw new Error(`no provider named "${cleanId}" in ~/.atl/providers.json`);
  delete registry.providers[cleanId];
  return entry;
}

export function getProvider(registry, id) {
  const cleanId = String(id || "").trim().toLowerCase();
  return registry.providers[cleanId] || null;
}

// `sk-abc123...wxyz` — enough to recognize a key, never enough to leak it.
export function maskKey(key) {
  const value = String(key || "");
  if (!value) return "(no key stored)";
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 5)}••••${value.slice(-4)}`;
}

// The browser-facing picker shape: configured providers only, never keys.
// `ready: false` entries stay visible with their problems so the manager can
// see WHY a provider cannot plan yet instead of a silently empty dropdown.
export function providerChoices(registry = loadUserProviders()) {
  return Object.values(registry.providers || {}).map((entry) => {
    const problems = validateProviderEntry(entry);
    return {
      id: entry.id,
      label: entry.label || entry.id,
      worker: entry.worker,
      protocol: entry.protocol || "custom",
      base_url: entry.base_url || "",
      model: entry.model || "",
      models: Array.isArray(entry.models) ? entry.models : [],
      thinking_level: entry.thinking_level || "",
      thinking_levels: Array.isArray(entry.thinking_levels) && entry.thinking_levels.length ? entry.thinking_levels : THINKING_LEVELS,
      ready: problems.length === 0,
      problems,
    };
  });
}

// Model work refuses BEFORE any spend when the provider is missing or
// unconfigured. The registry is injectable so callers (and tests) can pin
// exactly what is visible without touching the machine-wide ~/.atl state.
export function requireReadyProvider(id, { registry = loadUserProviders() } = {}) {
  const cleanId = String(id || "").trim().toLowerCase();
  if (!cleanId) throw new Error("a provider id is required for model generation");
  const entry = getProvider(registry, cleanId);
  if (!entry) {
    const known = Object.keys(registry.providers || {});
    throw new Error(`provider "${cleanId}" is not configured — add it with 'atl provider add ${cleanId}' or the provider screen${known.length ? ` (configured: ${known.join(", ")})` : "; no providers are configured yet"}`);
  }
  const problems = validateProviderEntry(entry);
  if (problems.length) throw new Error(`provider "${cleanId}" is not ready to plan: ${problems.join("; ")}`);
  const resolved = { ...entry };
  return {
    entry: resolved,
    withModel(model) {
      const requested = String(model || "").trim();
      if (requested) resolved.model = requested;
      return resolved;
    },
  };
}

export function templateById(id) {
  return PROVIDER_TEMPLATES.find((t) => t.id === String(id || "").toLowerCase()) || null;
}

// Wire mismatches the worker CLIs cannot survive. Codex 0.149+ speaks the
// Responses wire only (chat completions support was removed outright), and the
// claude CLI speaks only the Anthropic wire, so a worker pointed at the other
// wire's endpoint fails no matter what the config says. The markers cover the
// endpoint shapes we actually know: z.ai/bigmodel coding endpoints are
// chat-completions only, and "/anthropic" paths are the Anthropic wire.
export function wireMismatches(worker, baseUrl) {
  const url = String(baseUrl || "").toLowerCase();
  if (!url) return [];
  const mismatches = [];
  const chatOnly = url.includes("/api/coding/paas") || url.includes("chat/completions");
  const anthropicWire = url.includes("/anthropic");
  if (String(worker) === "codex" && anthropicWire) {
    mismatches.push(`base URL "${baseUrl}" is the Anthropic wire — set this provider's worker to claude (codex only speaks the OpenAI wire)`);
  }
  if (String(worker) === "codex" && chatOnly) {
    mismatches.push(`endpoint "${baseUrl}" speaks chat completions only — codex 0.149+ removed that wire, so set this provider's worker to claude`);
  }
  if (String(worker) === "claude" && chatOnly) {
    mismatches.push(`endpoint "${baseUrl}" is an OpenAI chat endpoint — set this provider's worker to codex (claude only speaks the Anthropic wire)`);
  }
  return mismatches;
}

export function validateProviderEntry(entry) {
  const problems = [];
  if (!entry) problems.push("provider does not exist in ~/.atl/providers.json");
  else {
    if (!entry.base_url) problems.push(`no base URL stored — set it with 'atl provider add ${entry.id} --base-url ...' or the TUI p screen`);
    if (!entry.api_key) problems.push(`no API key stored — set it with 'atl provider key ${entry.id} --key ...' or the TUI p screen`);
    if (!["claude", "codex"].includes(String(entry.worker || ""))) {
      problems.push(`worker "${entry.worker}" is not claude or codex`);
    }
    if (!PROVIDER_PROTOCOLS.includes(String(entry.protocol || "custom").toLowerCase())) {
      problems.push(`protocol "${entry.protocol}" is not openai, anthropic, or custom`);
    }
    problems.push(...wireMismatches(entry.worker, entry.base_url));
  }
  return problems;
}

// The exact environment a spawned worker needs to reach this provider.
//  - claude worker: point the Anthropic-compatible CLI at the endpoint and pin
//    every model slot (Claude Code routes "small/fast" background calls
//    separately — leaving them unset breaks against third-party endpoints).
//  - codex worker: stage an isolated CODEX_HOME whose config.toml defines the
//    provider with env_key; the key travels in ATL_PROVIDER_API_KEY.
export function credentialContext(entry) {
  const problems = validateProviderEntry(entry);
  if (problems.length) throw new Error(problems.join("; "));
  const model = entry.model || "";
  if (entry.worker === "claude") {
    return {
      worker: "claude",
      env: {
        ANTHROPIC_BASE_URL: entry.base_url,
        ANTHROPIC_AUTH_TOKEN: entry.api_key,
        ANTHROPIC_API_KEY: entry.api_key,
        ...(model ? {
          ANTHROPIC_MODEL: model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
          ANTHROPIC_DEFAULT_SONNET_MODEL: model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: model,
        } : {}),
      },
    };
  }
  const home = stageCodexHome(entry);
  return {
    worker: "codex",
    env: {
      CODEX_HOME: home,
      ATL_PROVIDER_API_KEY: entry.api_key,
    },
  };
}

// Managed per-provider Codex home: never touches the user's real
// ~/.codex/config.toml, and the staged home has no auth.json, so codex can
// only authenticate through the env_key we inject.
export function stageCodexHome(entry) {
  const home = path.join(os.homedir(), ".atl", "codex", entry.id);
  fs.mkdirSync(home, { recursive: true });
  const providerId = entry.id.replace(/[^\w-]/g, "-");
  const config = [
    `# Managed by ATL for user provider "${entry.id}" — safe to delete.`,
    `model = ${JSON.stringify(entry.model || "default")}`,
    ...(entry.thinking_level ? [`model_reasoning_effort = ${JSON.stringify(entry.thinking_level)}`] : []),
    `model_provider = ${JSON.stringify(providerId)}`,
    "",
    `[model_providers.${providerId}]`,
    `name = ${JSON.stringify(entry.label || entry.id)}`,
    `base_url = ${JSON.stringify(entry.base_url)}`,
    `env_key = "ATL_PROVIDER_API_KEY"`,
    // Codex 0.149+ hard-rejects wire_api = "chat" at config load (chat
    // completions support was removed), so the staged home always declares
    // codex's native Responses wire. Endpoints that never grew a /responses
    // route are rejected earlier by validateProviderEntry's wire checks.
    `wire_api = "responses"`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(home, "config.toml"), config, "utf8");
  return home;
}
