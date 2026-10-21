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

const REGISTRY_VERSION = 1;

// Ready-made endpoint presets. `baseUrl` is keyed by the worker CLI that will
// run the provider: claude speaks the Anthropic wire, codex the OpenAI one.
export const PROVIDER_TEMPLATES = [
  {
    id: "zai",
    label: "Z.ai GLM (international)",
    worker: "claude",
    models: ["glm-4.6", "glm-4.5", "glm-4.5-air"],
    baseUrl: {
      claude: "https://api.z.ai/api/anthropic",
      codex: "https://api.z.ai/api/coding/paas/v4",
    },
  },
  {
    id: "bigmodel",
    label: "Zhipu bigmodel.cn GLM (mainland China)",
    worker: "claude",
    models: ["glm-4.6", "glm-4.5", "glm-4.5-air"],
    baseUrl: {
      claude: "https://open.bigmodel.cn/api/anthropic",
      codex: "https://open.bigmodel.cn/api/coding/paas/v4",
    },
  },
  {
    id: "custom",
    label: "Custom endpoint (any Anthropic- or OpenAI-compatible API)",
    worker: "claude",
    models: [],
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
    base_url: String(fields.base_url ?? existing.base_url ?? ""),
    api_key: fields.api_key !== undefined ? String(fields.api_key) : String(existing.api_key || ""),
    model: fields.model ? String(fields.model) : String(existing.model || ""),
    models: Array.isArray(fields.models) ? fields.models.map(String) : (existing.models || []),
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  registry.providers[cleanId] = entry;
  return entry;
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

export function templateById(id) {
  return PROVIDER_TEMPLATES.find((t) => t.id === String(id || "").toLowerCase()) || null;
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
    `model_provider = ${JSON.stringify(providerId)}`,
    "",
    `[model_providers.${providerId}]`,
    `name = ${JSON.stringify(entry.label || entry.id)}`,
    `base_url = ${JSON.stringify(entry.base_url)}`,
    `env_key = "ATL_PROVIDER_API_KEY"`,
    `wire_api = "chat"`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(home, "config.toml"), config, "utf8");
  return home;
}
